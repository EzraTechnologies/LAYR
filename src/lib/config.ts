import { DEMO_SCENARIOS, type DemoScenarioId } from './demo/scenarios';

/**
 * One printer LAYR can connect to. v0.1 drives a single profile, but state, sources and the UI are keyed by
 * `id` so a printer switcher can be added without reshaping the data model.
 */
export interface PrinterProfile {
  id: string;
  /** Display name override. When empty, the Klipper host name is used. */
  name: string;
  moonrakerUrl: string;
  apiKey: string | null;
}

export interface AppConfig {
  printers: PrinterProfile[];
  activePrinterId: string;
  /** Demo scenario to run instead of a live connection, or null for live mode. */
  demo: DemoScenarioId | null;
  /** Where the Moonraker URL came from, shown in Settings for troubleshooting. */
  urlSource: 'query' | 'storage' | 'env' | 'default';
}

export interface ConfigInputs {
  env: Record<string, string | undefined>;
  /** `window.location.search` */
  search: string;
  /** `window.location` host name, used for the default Moonraker URL. */
  hostname: string;
  protocol: string;
  storage: Pick<Storage, 'getItem'> | null;
}

export const STORAGE_URL_KEY = 'layr.moonrakerUrl';
export const DEFAULT_MOONRAKER_PORT = 7125;

export function isDemoScenario(value: string | null | undefined): value is DemoScenarioId {
  return !!value && (DEMO_SCENARIOS as readonly string[]).includes(value);
}

function parseDemo(value: string | null | undefined): DemoScenarioId | null {
  if (value === null || value === undefined) return null;
  const v = value.trim().toLowerCase();
  if (v === '' || v === '0' || v === 'false' || v === 'off') return null;
  if (v === '1' || v === 'true' || v === 'on') return 'printing';
  return isDemoScenario(v) ? v : 'printing';
}

export function isValidMoonrakerUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * Resolves configuration. Precedence for the Moonraker URL: `?moonraker=` query parameter, then a URL saved
 * from the Settings screen (localStorage), then `VITE_LAYR_MOONRAKER_URL`, then `http(s)://<page host>:7125`.
 * Demo mode is enabled by `?demo=<scenario>` or `VITE_LAYR_DEMO`; `?demo=off` forces live mode.
 */
export function resolveConfig(inputs: ConfigInputs): AppConfig {
  const params = new URLSearchParams(inputs.search);
  const env = inputs.env;

  const queryUrl = params.get('moonraker');
  let storedUrl: string | null = null;
  try {
    storedUrl = inputs.storage?.getItem(STORAGE_URL_KEY) ?? null;
  } catch {
    storedUrl = null;
  }
  const envUrl = env.VITE_LAYR_MOONRAKER_URL;
  const protocol = inputs.protocol === 'https:' ? 'https:' : 'http:';
  const host = inputs.hostname || 'localhost';
  const defaultUrl = `${protocol}//${host.includes(':') ? `[${host}]` : host}:${DEFAULT_MOONRAKER_PORT}`;

  let moonrakerUrl = defaultUrl;
  let urlSource: AppConfig['urlSource'] = 'default';
  if (queryUrl && isValidMoonrakerUrl(queryUrl)) {
    moonrakerUrl = queryUrl.trim();
    urlSource = 'query';
  } else if (storedUrl && isValidMoonrakerUrl(storedUrl)) {
    moonrakerUrl = storedUrl.trim();
    urlSource = 'storage';
  } else if (envUrl && isValidMoonrakerUrl(envUrl)) {
    moonrakerUrl = envUrl.trim();
    urlSource = 'env';
  }

  const demo = params.has('demo') ? parseDemo(params.get('demo')) : parseDemo(env.VITE_LAYR_DEMO);

  const profile: PrinterProfile = {
    id: 'default',
    name: (env.VITE_LAYR_PRINTER_NAME ?? '').trim(),
    moonrakerUrl,
    apiKey: env.VITE_LAYR_API_KEY?.trim() || null,
  };

  return { printers: [profile], activePrinterId: profile.id, demo, urlSource };
}

export function activePrinter(config: AppConfig): PrinterProfile {
  const printer = config.printers.find((p) => p.id === config.activePrinterId) ?? config.printers[0];
  if (!printer) throw new Error('No printer profile configured');
  return printer;
}
