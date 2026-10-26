import type { GcodeStoreResult } from '../moonraker/types';
import type { PrinterConnection } from '../printer/source';

export type LineKind = 'command' | 'response' | 'error' | 'warning';

export interface ConsoleLine {
  id: number;
  /** Epoch ms. */
  time: number;
  kind: LineKind;
  text: string;
}

const MAX_LINES = 250;
/** Errors newer than this are shown as alerts on the dashboard. */
export const ALERT_WINDOW_MS = 10 * 60_000;

/** Klipper prefixes errors with `!!` and informational output with `//`. */
export function classifyResponse(text: string): LineKind {
  const t = text.trimStart();
  if (t.startsWith('!!')) return 'error';
  if (/^\/\/\s*(warning|warn)\b/i.test(t) || /^echo:\s*(warning)/i.test(t)) return 'warning';
  return 'response';
}

/** Recent G-code commands and responses from Moonraker (`server.gcode_store` + `notify_gcode_response`). */
export class ConsoleLog {
  lines = $state<ConsoleLine[]>([]);
  /** Ids of alerts the user dismissed. */
  dismissed = $state<number[]>([]);
  #nextId = 1;
  readonly #connection: PrinterConnection | null;
  readonly #unsubscribe: Array<() => void> = [];

  constructor(connection: PrinterConnection | null) {
    this.#connection = connection;
    if (!connection) return;
    this.#unsubscribe.push(
      connection.onReady(() => void this.reload()),
      connection.onGcodeResponse((text) => this.#append('response', text, Date.now())),
    );
  }

  dispose(): void {
    this.#unsubscribe.forEach((u) => u());
  }

  /** Replaces the log with Moonraker's cached history, so it is consistent after a reconnect. */
  async reload(): Promise<void> {
    if (!this.#connection) return;
    try {
      const result = await this.#connection.call<GcodeStoreResult>('server.gcode_store', { count: 100 });
      const items = Array.isArray(result.gcode_store) ? result.gcode_store : [];
      this.lines = items
        .filter((i) => typeof i.message === 'string')
        .map((i) => {
          const text = i.message!;
          const kind: LineKind = i.type === 'command' ? 'command' : classifyResponse(text);
          return { id: this.#nextId++, time: typeof i.time === 'number' ? i.time * 1000 : Date.now(), kind, text };
        });
    } catch {
      // History is optional; live responses still arrive.
    }
  }

  /** Records a command LAYR sent, because Moonraker does not echo commands as responses. */
  recordCommand(text: string): void {
    this.#append('command', text, Date.now());
  }

  /** Local status lines (e.g. a command that failed before reaching Klipper). */
  recordLocal(kind: LineKind, text: string): void {
    this.#append(kind, text, Date.now());
  }

  /** Recent, undismissed errors for the dashboard. */
  alerts(now: number): ConsoleLine[] {
    return this.lines
      .filter((l) => l.kind === 'error' && now - l.time < ALERT_WINDOW_MS && !this.dismissed.includes(l.id))
      .slice(-3);
  }

  dismiss(id: number): void {
    this.dismissed = [...this.dismissed, id];
  }

  #append(kind: LineKind, text: string, time: number): void {
    const next = [...this.lines, { id: this.#nextId++, time, kind: kind === 'response' ? classifyResponse(text) : kind, text }];
    this.lines = next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
  }
}
