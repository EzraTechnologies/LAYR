import { getContext, setContext } from 'svelte';
import type { AppConfig, PrinterProfile } from './config';
import type { ConsoleLog } from './console/console.svelte';
import type { FileBrowser } from './files/browser.svelte';
import type { PrinterStore } from './printer/store.svelte';
import type { SettingsStore } from './settings.svelte';
import type { GcodeHelp } from './integrations/gcodeHelp.svelte';
import type { SpoolmanStore } from './spoolman/store.svelte';
import type { Ui } from './ui.svelte';

export interface AppContext {
  config: AppConfig;
  printer: PrinterProfile;
  store: PrinterStore;
  ui: Ui;
  files: FileBrowser;
  console: ConsoleLog;
  settings: SettingsStore;
  spoolman: SpoolmanStore;
  /** Registered Klipper commands from `printer.gcode.help`. Null until that read finishes. */
  gcodeHelp: GcodeHelp;
  /** Text queued for the console input, e.g. a macro that needs parameters. */
  consoleDraft: { value: string };
}

const KEY = Symbol('layr');

export function setApp(context: AppContext): void {
  setContext(KEY, context);
}

export function app(): AppContext {
  const context = getContext<AppContext | undefined>(KEY);
  if (!context) throw new Error('LAYR context is missing');
  return context;
}
