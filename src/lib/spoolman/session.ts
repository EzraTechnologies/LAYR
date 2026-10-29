import type { Confirmation, PrinterCommand } from '../actions/commands';
import type { CommandOutcome } from '../actions/gateway';
import type { ServerInfo } from '../moonraker/types';
import {
  belongsTo,
  classifyRpcFailure,
  detailProxyParams,
  emptySnapshot,
  listProxyParams,
  LIST_LIMIT,
  MAX_LIST_OFFSET,
  parseActive,
  parseProxy,
  parseStatus,
  spoolIdValue,
  type SpoolmanNotice,
  type SpoolmanSnapshot,
} from './api';
import type { SpoolSummary, SpoolmanService, UnloadOutcome } from './types';

const OFFLINE_MSG = 'Spoolman is not reachable from Moonraker. Weights stay hidden until the link returns. Printing does not need Spoolman.';
const UNAUTHORIZED_MSG = "Spoolman refused this connection. Check the API key in Moonraker's own configuration. LAYR does not change that file.";
const FAILED_MSG = 'Moonraker reported that Spoolman failed to start. Printing continues without spool tracking.';
const ERROR_MSG = 'Spoolman did not return a usable catalogue. No weights are shown.';
const HIDDEN_MSG = 'Spoolman readings are hidden until this printer is connected. No weights are shown.';

export class SpoolmanCancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'SpoolmanCancelled';
  }
}

export interface SpoolmanIo {
  printerId: string;
  endpoint: string;
  call: ((method: string, params?: Record<string, unknown>) => Promise<unknown>) | null;
  execute: ((command: PrinterCommand, options?: { confirmed?: boolean }) => Promise<CommandOutcome>) | null;
  /** Shows the existing confirmation dialog. Required before a spool write. */
  confirm: ((confirm: Confirmation) => Promise<boolean>) | null;
}

type Call = NonNullable<SpoolmanIo['call']>;

/**
 * One printer's Spoolman catalogue. A response is applied only when its printer, endpoint,
 * and request generation still match, so a slow page cannot paint another printer's spools.
 */
export class SpoolmanSession implements SpoolmanService {
  snapshot: SpoolmanSnapshot;
  #io: SpoolmanIo;
  #epoch = 0;
  #generation = 0;
  #probed = false;
  #seen = false;
  /** False after Settings turns Spoolman off, until `activate` runs again. */
  #active = true;
  readonly #onChange: (snapshot: SpoolmanSnapshot) => void;

  constructor(io: SpoolmanIo, onChange: (snapshot: SpoolmanSnapshot) => void = () => {}) {
    this.#io = io;
    this.#onChange = onChange;
    this.snapshot = emptySnapshot(io.printerId, io.endpoint);
  }

  get endpoint(): string {
    return this.#io.endpoint;
  }

  /** Lets status and catalogue reads run. Settings calls this when Spoolman is switched on. */
  activate(): void {
    this.#active = true;
  }

  /**
   * Stops catalogue reads and hides Spoolman. Used when the Settings switch is off.
   * In-flight replies are dropped and do not move filament.
   */
  suspend(): void {
    this.#active = false;
    this.#epoch += 1;
    this.#generation += 1;
    this.#probed = false;
    this.#seen = false;
    this.#publish(emptySnapshot(this.#io.printerId, this.#io.endpoint));
  }

  /** Drops the catalogue. Used when Moonraker disconnects or the printer URL changes. */
  dropConnection(): void {
    this.#epoch += 1;
    this.#generation += 1;
    this.#probed = false;
    if (!this.#seen) {
      this.#publish(emptySnapshot(this.#io.printerId, this.#io.endpoint));
      return;
    }
    this.#publish({
      printerId: this.#io.printerId,
      endpoint: this.#io.endpoint,
      phase: 'offline',
      tracked: true,
      message: HIDDEN_MSG,
      activeId: null,
      activeKnown: false,
      spools: [],
    });
  }

  /** Associates this session with a different Moonraker URL and forgets the previous catalogue. */
  retarget(endpoint: string): void {
    if (endpoint === this.#io.endpoint) return;
    this.#io = { ...this.#io, endpoint };
    this.#seen = false;
    this.dropConnection();
  }

  async onServerInfo(info: ServerInfo): Promise<void> {
    if (!this.#active || this.#probed) return;
    this.#probed = true;
    const failed = Array.isArray(info.failed_components) && info.failed_components.includes('spoolman');
    if (failed) {
      this.#publish(this.#blank('failed', true, FAILED_MSG));
      return;
    }
    if (Array.isArray(info.components) && !info.components.includes('spoolman')) {
      this.#seen = false;
      this.#publish(this.#blank('absent', false, ''));
      return;
    }
    await this.refresh();
  }

  onNotice(notice: SpoolmanNotice): void {
    if (!this.#active || !this.snapshot.tracked || this.snapshot.phase === 'absent' || this.snapshot.phase === 'failed') return;
    if (notice.kind === 'link') {
      if (!notice.connected) {
        this.#generation += 1;
        this.#publish(this.#blank('offline', true, OFFLINE_MSG));
        return;
      }
      void this.refresh();
      return;
    }
    if (this.snapshot.phase !== 'ready' || !notice.known) return;
    const inList = notice.spoolId != null && this.snapshot.spools.some((spool) => spool.id === notice.spoolId);
    this.#publish({
      ...this.snapshot,
      activeId: notice.spoolId,
      activeKnown: true,
      message: notice.spoolId == null ? 'No active spool.' : inList ? '' : `Active spool ${notice.spoolId} is not in the loaded catalogue. Quantity is not shown.`,
    });
  }

  async refresh(): Promise<void> {
    if (!this.#active) return;
    const call = this.#io.call;
    if (!call) return;
    const epoch = this.#epoch;
    const gen = ++this.#generation;
    this.#publish({ ...this.#blank('loading', true, 'Reading Spoolman…'), spools: [] });
    try {
      const status = parseStatus(await call('server.spoolman.status'));
      if (!this.#current(epoch, gen)) return;
      if (!status.ok) {
        this.#fail(epoch, gen, 'error', ERROR_MSG);
        return;
      }
      if (!status.connected) {
        this.#fail(epoch, gen, 'offline', OFFLINE_MSG);
        return;
      }
      const active = parseActive(await call('server.spoolman.get_spool_id'));
      if (!this.#current(epoch, gen)) return;
      if (!active.ok) {
        this.#fail(epoch, gen, 'error', active.error || ERROR_MSG);
        return;
      }
      const spools = await this.#loadSpools(call, epoch, gen);
      if (!spools || !this.#current(epoch, gen)) return;
      let catalogue = spools;
      if (active.spoolId != null && !catalogue.some((spool) => spool.id === active.spoolId)) {
        const extra = await this.#loadOne(call, epoch, gen, active.spoolId);
        if (extra === undefined || !this.#current(epoch, gen)) return;
        if (extra) catalogue = [extra, ...catalogue.filter((spool) => spool.id !== extra.id)];
      }
      const known = active.spoolId != null && catalogue.some((spool) => spool.id === active.spoolId);
      const message =
        active.spoolId == null
          ? 'No active spool.'
          : known
            ? ''
            : `Active spool ${active.spoolId} is not in the loaded catalogue. Quantity is not shown.`;
      this.#publish({
        printerId: this.#io.printerId,
        endpoint: this.#io.endpoint,
        phase: 'ready',
        tracked: true,
        message,
        activeId: active.spoolId,
        activeKnown: true,
        spools: catalogue,
      });
    } catch (error) {
      if (!this.#current(epoch, gen)) return;
      const failure = rpcFailure(error);
      if (failure === 'absent') {
        this.#seen = false;
        this.#publish(this.#blank('absent', false, ''));
        return;
      }
      const message = failure === 'unauthorized' ? UNAUTHORIZED_MSG : failure === 'offline' ? OFFLINE_MSG : ERROR_MSG;
      this.#fail(epoch, gen, failure === 'unauthorized' ? 'unauthorized' : failure === 'offline' ? 'offline' : 'error', message);
    }
  }

  async listSpools(printerId: string): Promise<SpoolSummary[]> {
    this.#assertPrinter(printerId);
    if (this.snapshot.phase !== 'ready') await this.refresh();
    this.#assertPrinter(printerId);
    if (!belongsTo(this.snapshot, printerId, this.#io.endpoint) || this.snapshot.phase !== 'ready') {
      throw new Error(this.snapshot.message || 'Spoolman is not available for this printer');
    }
    return this.snapshot.spools.map((spool) => ({ ...spool }));
  }

  async getActiveSpool(printerId: string): Promise<SpoolSummary | null> {
    const spools = await this.listSpools(printerId);
    if (!this.snapshot.activeKnown || this.snapshot.activeId == null) return null;
    return spools.find((spool) => spool.id === this.snapshot.activeId) ?? {
      id: this.snapshot.activeId,
      name: `Spool ${this.snapshot.activeId}`,
      material: null,
      vendor: null,
      colorHex: null,
      remainingWeightG: null,
      remainingLengthMm: null,
      archived: false,
    };
  }

  /**
   * Sets the active spool only after the gateway asks for confirmation and `confirm` accepts it.
   * A preview that is already `ok` is refused, so a missing confirmation cannot write.
   */
  async setActiveSpool(printerId: string, spoolId: number): Promise<void> {
    this.#assertPrinter(printerId);
    const id = spoolIdValue(spoolId);
    if (id === null) throw new Error('That spool id cannot be used');
    const execute = this.#io.execute;
    const confirm = this.#io.confirm;
    if (!execute || !confirm) throw new Error('Not connected to Moonraker');
    const command: PrinterCommand = { kind: 'set_active_spool', spoolId: id, name: this.#label(id) };
    const preview = await execute(command);
    if (preview.status === 'ok') throw new Error('Refusing a spool write that skipped confirmation');
    if (preview.status === 'needs_confirmation') {
      if (!(await confirm(preview.confirm))) throw new SpoolmanCancelled();
      const outcome = await execute(command, { confirmed: true });
      if (outcome.status !== 'ok') throw new Error(outcomeMessage(outcome));
      return;
    }
    throw new Error(outcomeMessage(preview));
  }

  async clearActiveSpoolAfterUnload(printerId: string, outcome: UnloadOutcome): Promise<void> {
    await this.clearAfterUnload(printerId, outcome);
  }

  /** Clears only after a confirmed unload. Returns whether the active spool changed. */
  async clearAfterUnload(printerId: string, outcome: UnloadOutcome): Promise<'cleared' | 'kept' | 'skipped'> {
    this.#assertPrinter(printerId);
    if (outcome.kind === 'cancelled') return 'skipped';
    if (outcome.kind !== 'confirmed-success') {
      const message =
        outcome.kind === 'unconfirmed'
          ? 'Unload result unknown. The active spool was kept. Check the printer before changing it.'
          : 'Unload did not finish. The active spool was kept.';
      this.#publish({ ...this.snapshot, message });
      return 'kept';
    }
    const execute = this.#io.execute;
    if (!execute) throw new Error('Not connected to Moonraker');
    const result = await execute({ kind: 'clear_active_spool' }, { confirmed: true });
    if (result.status !== 'ok') {
      this.#publish({
        ...this.snapshot,
        message: `Unload finished. The active spool was kept. ${outcomeMessage(result)}`,
      });
      return 'kept';
    }
    this.#publish({ ...this.snapshot, activeId: null, activeKnown: true, message: 'No active spool.' });
    return 'cleared';
  }

  #label(id: number): string {
    return this.snapshot.spools.find((spool) => spool.id === id)?.name ?? `Spool ${id}`;
  }

  #assertPrinter(printerId: string): void {
    if (printerId !== this.#io.printerId) throw new Error(`Spoolman is not associated with printer ${printerId}`);
  }

  async #loadSpools(call: Call, epoch: number, gen: number): Promise<SpoolSummary[] | null> {
    const all: SpoolSummary[] = [];
    const seen = new Set<number>();
    for (let offset = 0; offset <= MAX_LIST_OFFSET; offset += LIST_LIMIT) {
      const page = parseProxy(await call('server.spoolman.proxy', listProxyParams(offset)));
      if (!this.#current(epoch, gen)) return null;
      if (!page.ok) throw new SpoolmanRpcError(page.failure ?? 'error', page.error);
      for (const spool of page.spools) {
        if (seen.has(spool.id)) continue;
        seen.add(spool.id);
        all.push(spool);
      }
      if (page.received < LIST_LIMIT) break;
    }
    return all;
  }

  /** `undefined` means this request is stale. `null` means the spool was not in the response. */
  async #loadOne(call: Call, epoch: number, gen: number, spoolId: number): Promise<SpoolSummary | null | undefined> {
    try {
      const page = parseProxy(await call('server.spoolman.proxy', detailProxyParams(spoolId)));
      if (!this.#current(epoch, gen)) return undefined;
      if (!page.ok) throw new SpoolmanRpcError(page.failure ?? 'error', page.error);
      return page.spools.find((spool) => spool.id === spoolId) ?? null;
    } catch (error) {
      if (!this.#current(epoch, gen)) return undefined;
      if (error instanceof SpoolmanRpcError && (error.failure === 'unauthorized' || error.failure === 'offline')) throw error;
      const failure = rpcFailure(error);
      if (failure === 'unauthorized' || failure === 'offline') throw error;
      return null;
    }
  }

  #fail(epoch: number, gen: number, phase: 'offline' | 'unauthorized' | 'error', message: string): void {
    if (!this.#current(epoch, gen)) return;
    this.#publish(this.#blank(phase, true, message));
  }

  #blank(phase: SpoolmanSnapshot['phase'], tracked: boolean, message: string): SpoolmanSnapshot {
    return {
      printerId: this.#io.printerId,
      endpoint: this.#io.endpoint,
      phase,
      tracked,
      message: tracked ? message : '',
      activeId: null,
      activeKnown: false,
      spools: [],
    };
  }

  #current(epoch: number, gen: number): boolean {
    return epoch === this.#epoch && gen === this.#generation;
  }

  #publish(next: SpoolmanSnapshot): void {
    if (next.tracked) this.#seen = true;
    this.snapshot = next;
    this.#onChange(next);
  }
}

class SpoolmanRpcError extends Error {
  readonly failure: 'absent' | 'unauthorized' | 'offline' | 'error';
  constructor(failure: 'absent' | 'unauthorized' | 'offline' | 'error', message: string) {
    super(message);
    this.name = 'SpoolmanRpcError';
    this.failure = failure;
  }
}

function rpcFailure(error: unknown): 'absent' | 'unauthorized' | 'offline' | 'error' {
  if (error instanceof SpoolmanRpcError) return error.failure;
  const code = typeof error === 'object' && error !== null && 'code' in error ? Number((error as { code?: unknown }).code) : 0;
  const message = error instanceof Error ? error.message : String(error);
  return classifyRpcFailure(Number.isFinite(code) ? code : 0, message);
}

function outcomeMessage(outcome: CommandOutcome): string {
  switch (outcome.status) {
    case 'ok':
      return outcome.summary;
    case 'needs_confirmation':
      return 'Confirmation required';
    case 'blocked':
    case 'busy':
      return outcome.message;
    case 'failed':
    case 'unconfirmed':
      return outcome.message;
  }
}
