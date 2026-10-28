import type { CommandGateway, CommandOutcome } from '../actions/gateway';
import { errorMessage, RpcError } from '../moonraker/client';
import type { ServerInfo } from '../moonraker/types';
import type { PrinterConnection } from '../printer/source';
import type { Ui } from '../ui.svelte';
import {
  isSpoolmanAbsentError,
  parseActiveSpool,
  parseSpoolmanProxy,
  parseSpoolmanStatus,
  SPOOL_LIST_LIMIT,
  spoolmanListParams,
} from './api';
import { emptySpoolmanFacts, shouldClearAfterUnload, type SpoolmanFacts, type SpoolmanNotice, type SpoolmanPhase, type SpoolmanService, type SpoolSummary, type UnloadOutcome } from './types';

export type { SpoolmanNotice };

const OFFLINE_MESSAGE = 'Moonraker cannot reach Spoolman. Printing does not need it. Weights stay hidden until the link returns.';
const STALE_MESSAGE = 'Spoolman readings are hidden until this printer is connected.';
const ABSENT_MESSAGE = 'Spoolman is not set up on this Moonraker. Printing does not need it. Add it in Moonraker’s own configuration, then restart Moonraker there. LAYR does not edit that file.';

/**
 * Spool catalogue for the connected printer. Dropped when the socket drops or the printer id changes,
 * so one printer's spools are never shown as another's. Refreshes on connect and on Moonraker's
 * Spoolman notifications. It does not poll.
 */
export class SpoolmanStore implements SpoolmanService {
  facts = $state<SpoolmanFacts>(emptySpoolmanFacts(''));
  spools = $state<SpoolSummary[]>([]);
  refreshing = $state(false);

  readonly printerId: string;
  readonly #connection: PrinterConnection | null;
  readonly #gateway: CommandGateway;
  readonly #ui: Ui;
  readonly #onFacts: (facts: SpoolmanFacts) => void;
  #generation = 0;
  #seen = '';
  readonly #unsubscribe: () => void;

  constructor(printerId: string, connection: PrinterConnection | null, gateway: CommandGateway, ui: Ui, onFacts: (facts: SpoolmanFacts) => void) {
    this.printerId = printerId;
    this.#connection = connection;
    this.#gateway = gateway;
    this.#ui = ui;
    this.#onFacts = onFacts;
    this.facts = emptySpoolmanFacts(printerId);
    this.#onFacts(this.facts);
    this.#unsubscribe = connection?.onSpoolman((notice) => this.#onNotice(notice)) ?? (() => {});
  }

  get navVisible(): boolean {
    return this.facts.phase === 'ready' || this.facts.phase === 'offline' || this.facts.phase === 'error';
  }

  dispose(): void {
    this.#unsubscribe();
  }

  /** Called when printer transport changes. Ignores ordinary status ticks. */
  observe(transport: string, klippy: string, printerId: string, attempt: number): void {
    if (printerId !== this.printerId) {
      this.#invalidate('stale', STALE_MESSAGE);
      return;
    }
    const ready = transport === 'connected' && klippy === 'ready';
    const token = ready ? `up:${attempt}` : `down:${transport}:${klippy}`;
    if (token === this.#seen) return;
    this.#seen = token;
    if (!ready) {
      this.#invalidate('stale', STALE_MESSAGE);
      return;
    }
    void this.refresh();
  }

  async listSpools(printerId: string): Promise<SpoolSummary[]> {
    this.#assertPrinter(printerId);
    if (this.facts.phase !== 'ready') return [];
    return this.spools;
  }

  async getActiveSpool(printerId: string): Promise<SpoolSummary | null> {
    this.#assertPrinter(printerId);
    return activeSummary(this.spools, this.facts);
  }

  async setActiveSpool(printerId: string, spoolId: number): Promise<void> {
    this.#assertPrinter(printerId);
    const outcome = await this.#ui.run({ kind: 'set_active_spool', spoolId });
    if (outcome.status === 'ok') {
      this.#publish({ ...this.facts, activeKnown: true, activeId: spoolId });
      void this.refresh();
    }
    throwIfFailed(outcome);
  }

  async clearActiveSpool(printerId: string): Promise<void> {
    this.#assertPrinter(printerId);
    const outcome = await this.#ui.run({ kind: 'clear_active_spool' });
    if (outcome.status === 'ok') {
      this.#publish({ ...this.facts, activeKnown: true, activeId: null });
      void this.refresh();
    }
    throwIfFailed(outcome);
  }

  async clearActiveSpoolAfterUnload(printerId: string, outcome: UnloadOutcome): Promise<void> {
    this.#assertPrinter(printerId);
    if (!shouldClearAfterUnload(outcome)) return;
    const result = await this.#gateway.execute({ kind: 'clear_active_spool', authorized: true }, { confirmed: true });
    if (result.status === 'ok') {
      this.#publish({ ...this.facts, activeKnown: true, activeId: null });
      void this.refresh();
      return;
    }
    if (result.status === 'failed' || result.status === 'unconfirmed' || result.status === 'blocked') {
      throw new Error('message' in result ? result.message : 'The active spool was kept');
    }
  }

  async unloadAndClear(printerId: string, macro: string): Promise<void> {
    this.#assertPrinter(printerId);
    const outcome = await this.#ui.run({ kind: 'unload_for_spool_clear', macro });
    if (outcome.status === 'needs_confirmation' || outcome.status === 'busy' || outcome.status === 'blocked') return;
    if (outcome.status !== 'ok') {
      this.#ui.toast('warn', 'Active spool kept', 'The unload did not finish, so the spool is still active.');
      return;
    }
    try {
      await this.clearActiveSpoolAfterUnload(printerId, { kind: 'confirmed-success' });
      this.#ui.toast('ok', 'Active spool cleared');
    } catch (error) {
      this.#ui.toast('warn', 'Active spool kept', errorMessage(error));
    }
  }

  async refresh(): Promise<void> {
    const connection = this.#connection;
    if (!connection?.connected) {
      this.#invalidate('stale', STALE_MESSAGE);
      return;
    }
    const generation = ++this.#generation;
    if (this.facts.phase !== 'ready') this.#publish(emptySpoolmanFacts(this.printerId, 'loading'));
    this.refreshing = true;
    try {
      const info = await connection.call<ServerInfo>('server.info');
      if (!this.#current(generation)) return;
      if (Array.isArray(info.components) && !info.components.includes('spoolman')) {
        this.#invalidate('absent', null);
        return;
      }
      let status: unknown;
      try {
        status = await connection.call('server.spoolman.status');
      } catch (error) {
        if (!this.#current(generation)) return;
        if (isSpoolmanAbsentError(error)) this.#invalidate('absent', null);
        else this.#invalidate('error', errorMessage(error));
        return;
      }
      if (!this.#current(generation)) return;
      const parsed = parseSpoolmanStatus(status);
      if (!parsed.ok) {
        this.#invalidate('error', parsed.error);
        return;
      }
      if (!parsed.connected) {
        this.#invalidate('offline', OFFLINE_MESSAGE);
        return;
      }
      const activeResult = await connection.call('server.spoolman.get_spool_id');
      if (!this.#current(generation)) return;
      const active = parseActiveSpool(activeResult);
      const listed = await this.#listAll(connection, generation);
      if (!listed) return;
      const activeKnown = active.ok || parsed.activeKnown;
      const spoolId = active.ok ? active.spoolId : parsed.spoolId;
      const names: Record<number, string> = {};
      for (const spool of listed) names[spool.id] = spool.name;
      this.spools = listed;
      this.#publish({
        printerId: this.printerId,
        phase: 'ready',
        activeKnown,
        activeId: activeKnown ? spoolId : null,
        ids: listed.map((spool) => spool.id),
        names,
        archived: listed.filter((spool) => spool.archived).map((spool) => spool.id),
        message: null,
      });
    } catch (error) {
      if (!this.#current(generation)) return;
      if (isSpoolmanAbsentError(error)) this.#invalidate('absent', null);
      else this.#invalidate('error', errorMessage(error));
    } finally {
      if (generation === this.#generation) this.refreshing = false;
    }
  }

  async #listAll(connection: PrinterConnection, generation: number): Promise<SpoolSummary[] | null> {
    const spools: SpoolSummary[] = [];
    for (let offset = 0; offset <= 400; offset += SPOOL_LIST_LIMIT) {
      let result: unknown;
      try {
        result = await connection.call('server.spoolman.proxy', spoolmanListParams(offset));
      } catch (error) {
        if (!this.#current(generation)) return null;
        if (error instanceof RpcError && (error.code === 503 || error.message.toLowerCase().includes('not available'))) {
          this.#invalidate('offline', OFFLINE_MESSAGE);
        } else {
          this.#invalidate('error', errorMessage(error));
        }
        return null;
      }
      if (!this.#current(generation)) return null;
      const parsed = parseSpoolmanProxy(result);
      if (!parsed.ok) {
        this.#invalidate(parsed.offline ? 'offline' : 'error', parsed.offline ? OFFLINE_MESSAGE : parsed.error);
        return null;
      }
      spools.push(...parsed.spools);
      if (parsed.received < SPOOL_LIST_LIMIT) break;
    }
    return spools;
  }

  #onNotice(notice: SpoolmanNotice): void {
    if (this.facts.phase === 'unknown' || this.facts.phase === 'absent' || this.facts.phase === 'stale') return;
    if (notice.kind === 'link') {
      if (notice.connected === false) this.#invalidate('offline', OFFLINE_MESSAGE);
      else if (this.#connection?.connected) void this.refresh();
      return;
    }
    if (this.facts.phase !== 'ready') return;
    this.#publish({ ...this.facts, activeKnown: true, activeId: notice.spoolId });
  }

  #invalidate(phase: SpoolmanPhase, message: string | null): void {
    this.#generation += 1;
    this.refreshing = false;
    this.spools = [];
    this.#publish(emptySpoolmanFacts(this.printerId, phase, message));
  }

  #publish(facts: SpoolmanFacts): void {
    this.facts = facts;
    this.#onFacts(facts);
  }

  #current(generation: number): boolean {
    return generation === this.#generation;
  }

  #assertPrinter(printerId: string): void {
    if (printerId !== this.printerId) throw new Error('Spoolman is for a different printer');
  }
}

export function activeSummary(spools: readonly SpoolSummary[], facts: SpoolmanFacts): SpoolSummary | null {
  if (facts.phase !== 'ready' || !facts.activeKnown || facts.activeId === null) return null;
  const found = spools.find((spool) => spool.id === facts.activeId);
  if (found) return found;
  return {
    id: facts.activeId,
    name: facts.names[facts.activeId] || `Spool ${facts.activeId}`,
    material: null,
    vendor: null,
    colorHex: null,
    colors: [],
    remainingWeightG: null,
    remainingLengthMm: null,
    usedWeightG: null,
    spoolWeightG: null,
    archived: facts.archived.includes(facts.activeId),
    location: null,
    lot: null,
  };
}

export function spoolInCatalogue(spools: readonly SpoolSummary[], id: number): boolean {
  return spools.some((spool) => spool.id === id);
}

export function absentHelp(): string {
  return ABSENT_MESSAGE;
}

function throwIfFailed(outcome: CommandOutcome): void {
  if (outcome.status === 'failed' || outcome.status === 'unconfirmed') throw new Error(outcome.message);
}
