import type { PrinterConnection } from '../printer/source';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Reads `printer.gcode.help` once each time Klipper is ready. AFC and Happy Hare buttons are
 * chosen from this list, so a command that this printer does not register is never offered.
 */
export class GcodeHelp {
  names = $state<string[] | null>(null);
  readonly #connection: PrinterConnection | null;
  readonly #onUpdate: (commands: ReadonlySet<string> | null) => void;
  #generation = 0;
  #loading = false;

  constructor(connection: PrinterConnection | null, onUpdate: (commands: ReadonlySet<string> | null) => void) {
    this.#connection = connection;
    this.#onUpdate = onUpdate;
  }

  observe(transport: string, klippy: string): void {
    const ready = transport === 'connected' && klippy === 'ready';
    if (!ready) {
      if (this.names !== null || this.#loading) this.#clear();
      return;
    }
    if (this.names !== null || this.#loading || !this.#connection) return;
    void this.#load();
  }

  #clear(): void {
    this.#generation += 1;
    this.#loading = false;
    this.names = null;
    this.#onUpdate(null);
  }

  async #load(): Promise<void> {
    const connection = this.#connection;
    if (!connection) return;
    const generation = ++this.#generation;
    this.#loading = true;
    try {
      const result = await connection.call<Record<string, unknown>>('printer.gcode.help');
      if (generation !== this.#generation) return;
      const names = Object.keys(result).filter((name) => NAME_RE.test(name));
      this.names = names;
      this.#onUpdate(new Set(names));
    } catch {
      if (generation !== this.#generation) return;
      this.names = [];
      this.#onUpdate(new Set());
    } finally {
      if (generation === this.#generation) this.#loading = false;
    }
  }
}
