import { afcScript, type Confirmation, type PrinterCommand } from './actions/commands';
import type { CommandGateway, CommandOutcome } from './actions/gateway';
import type { ConsoleLog } from './console/console.svelte';

export interface Toast {
  id: number;
  tone: 'ok' | 'error' | 'warn' | 'info';
  title: string;
  detail: string | null;
}

export type PromptMode = 'text' | 'url' | 'gcode' | 'number';

export interface PromptOptions {
  title: string;
  value: string;
  mode: PromptMode;
  placeholder?: string;
  hint?: string;
  submitLabel?: string;
  /** Number mode: inclusive bounds shown on the keypad. */
  min?: number;
  max?: number;
  unit?: string;
  /** Number mode: quick-pick values. */
  presets?: number[];
  validate?: (value: string) => string | null;
}

interface PendingPrompt extends PromptOptions {
  resolve: (value: string | null) => void;
}

interface PendingConfirm {
  confirm: Confirmation;
  resolve: (ok: boolean) => void;
}

const TOAST_MS: Record<Toast['tone'], number> = { ok: 2500, info: 3500, warn: 6000, error: 8000 };

/**
 * App-wide interaction state: confirmation dialogs, prompts, toasts and per-command busy flags. Views call
 * `ui.run(command)`; it handles confirmation and reports the outcome, so feedback is consistent everywhere.
 */
export class Ui {
  toasts = $state<Toast[]>([]);
  confirmRequest = $state<PendingConfirm | null>(null);
  promptRequest = $state<PendingPrompt | null>(null);
  busyGroups = $state<string[]>([]);
  readonly #gateway: CommandGateway;
  readonly #console: ConsoleLog;
  #nextToast = 1;

  constructor(gateway: CommandGateway, consoleLog: ConsoleLog) {
    this.#gateway = gateway;
    this.#console = consoleLog;
    gateway.onBusyChange((busy) => (this.busyGroups = [...busy]));
  }

  get gateway(): CommandGateway {
    return this.#gateway;
  }

  /** True while a command of the same group as `command` is in flight. */
  isBusy(command: PrinterCommand): boolean {
    const group = this.#gateway.groupOf(command);
    return group !== null && this.busyGroups.includes(group);
  }

  async run(command: PrinterCommand, options: { quietSuccess?: boolean } = {}): Promise<CommandOutcome> {
    let outcome = await this.#gateway.execute(command);
    if (outcome.status === 'needs_confirmation') {
      if (!(await this.confirm(outcome.confirm))) return outcome;
      if (command.kind === 'gcode' || command.kind === 'macro' || command.kind === 'afc') {
        const text =
          command.kind === 'gcode' ? command.script.trim() : command.kind === 'macro' ? command.name : afcScript(command.action, command.lane);
        this.#console.recordCommand(text);
      }
      outcome = await this.#gateway.execute(command, { confirmed: true });
    }
    this.#report(outcome, options.quietSuccess ?? false);
    return outcome;
  }

  confirm(confirm: Confirmation): Promise<boolean> {
    this.confirmRequest?.resolve(false);
    return new Promise((resolve) => {
      this.confirmRequest = {
        confirm,
        resolve: (ok) => {
          this.confirmRequest = null;
          resolve(ok);
        },
      };
    });
  }

  prompt(options: PromptOptions): Promise<string | null> {
    this.promptRequest?.resolve(null);
    return new Promise((resolve) => {
      this.promptRequest = {
        ...options,
        resolve: (value) => {
          this.promptRequest = null;
          resolve(value);
        },
      };
    });
  }

  toast(tone: Toast['tone'], title: string, detail: string | null = null): void {
    const id = this.#nextToast++;
    this.toasts = [...this.toasts.slice(-2), { id, tone, title, detail }];
    setTimeout(() => this.dismissToast(id), TOAST_MS[tone]);
  }

  dismissToast(id: number): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  #report(outcome: CommandOutcome, quietSuccess: boolean): void {
    switch (outcome.status) {
      case 'ok':
        if (outcome.note) this.toast('info', outcome.summary, outcome.note);
        else if (!quietSuccess) this.toast('ok', outcome.summary);
        return;
      case 'blocked':
        this.toast('warn', outcome.message);
        return;
      case 'busy':
        this.toast('info', outcome.message);
        return;
      case 'failed':
        this.toast('error', `${outcome.summary} failed`, outcome.message);
        return;
      case 'unconfirmed':
        this.toast('warn', `${outcome.summary}: result unknown`, outcome.message);
        return;
      case 'needs_confirmation':
        return;
    }
  }
}
