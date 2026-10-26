/**
 * One printer LAYR can connect to. The MVP drives a single profile, but state, sources and the UI are keyed by
 * `id` so a printer switcher can be added without reshaping the data model.
 */
export interface PrinterProfile {
  id: string;
  /** Display name override. When empty, the Klipper host name is used. */
  name: string;
  /** Moonraker base URL, or null until one has been configured. */
  moonrakerUrl: string | null;
  apiKey: string | null;
}

export interface AppConfig {
  printers: PrinterProfile[];
  activePrinterId: string;
  /** Where the Moonraker URL came from, shown in Settings for troubleshooting. */
  urlSource: 'query' | 'storage' | 'env' | 'none';
  /** `http(s)://<page host>:7125`, offered as a one-tap choice in Settings. Never used automatically. */
  suggestedUrl: string;
}

export interface ConfigInputs {
  env: Record<string, string | undefined>;
  /** `window.location.search` */
  search: string;
  /** `window.location` host name, used for the suggested Moonraker URL. */
  hostname: string;
  protocol: string;
  storage: Pick<Storage, 'getItem'> | null;
}

export const STORAGE_URL_KEY = 'layr.moonrakerUrl';
export const DEFAULT_MOONRAKER_PORT = 7125;

export function isValidMoonrakerUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.hostname !== '' && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Resolves configuration. Precedence for the Moonraker URL: `?moonraker=` query parameter, then a URL saved
 * from the Settings screen (localStorage), then `VITE_LAYR_MOONRAKER_URL`. There is no implicit default: until
 * one of these is set, LAYR stays disconnected and asks for an endpoint.
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
  const suggestedUrl = `${protocol}//${host.includes(':') ? `[${host}]` : host}:${DEFAULT_MOONRAKER_PORT}`;

  let moonrakerUrl: string | null = null;
  let urlSource: AppConfig['urlSource'] = 'none';
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

  const profile: PrinterProfile = {
    id: 'default',
    name: (env.VITE_LAYR_PRINTER_NAME ?? '').trim(),
    moonrakerUrl,
    apiKey: env.VITE_LAYR_API_KEY?.trim() || null,
  };

  return { printers: [profile], activePrinterId: profile.id, urlSource, suggestedUrl };
}

export function activePrinter(config: AppConfig): PrinterProfile {
  const printer = config.printers.find((p) => p.id === config.activePrinterId) ?? config.printers[0];
  if (!printer) throw new Error('No printer profile configured');
  return printer;
}
