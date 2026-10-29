/**
 * Manual Spoolman, Happy Hare, and AFC switches.
 *
 * All three default off, including on installs that have never saved this book.
 * Spoolman is independent. Happy Hare and AFC cannot be on together, and both
 * off is a valid saved state. Nothing in this module talks to Moonraker.
 *
 * Happy Hare (#41), AFC (#42), and Spoolman (#43) should read `integrationEnabled`
 * from `./runtime` before subscribing, polling, or sending a command. A feature
 * runs only when that switch is on and the printer actually exposes it.
 */

export const STORAGE_INTEGRATIONS_KEY = 'layr.integrations';

/** Saved printers beyond this are dropped, oldest write first. The printer just saved stays. */
export const MAX_SAVED_PRINTERS = 24;

export const INTEGRATION_IDS = ['spoolman', 'happyHare', 'afc'] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export interface IntegrationPrefs {
  spoolman: boolean;
  happyHare: boolean;
  afc: boolean;
}

export const DEFAULT_INTEGRATIONS: IntegrationPrefs = Object.freeze({
  spoolman: false,
  happyHare: false,
  afc: false,
});

export function defaultIntegrations(): IntegrationPrefs {
  return { ...DEFAULT_INTEGRATIONS };
}

export interface IntegrationBook {
  printers: Record<string, IntegrationPrefs>;
}

/** Result of the reads Settings uses to explain a switch. Null fields were not reported. */
export interface IntegrationDiscovery {
  objects: string[] | null;
  components: string[] | null;
  failedComponents: string[] | null;
}

export function integrationScopeKey(printerId: string, moonrakerUrl: string | null): string {
  const id = printerId.trim() || 'default';
  return `${id}\n${normalizeMoonrakerUrl(moonrakerUrl) ?? ''}`;
}

/** Stable endpoint identity. Trailing slashes and host case do not create a second printer. */
export function normalizeMoonrakerUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const protocol = url.protocol.toLowerCase();
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(protocol)) return trimmed;
    const host = url.hostname.toLowerCase();
    let port = url.port;
    if ((protocol === 'http:' || protocol === 'ws:') && port === '80') port = '';
    if ((protocol === 'https:' || protocol === 'wss:') && port === '443') port = '';
    const path = url.pathname.replace(/\/+$/, '');
    const hostText = host.includes(':') ? `[${host}]` : host;
    return `${protocol}//${hostText}${port ? `:${port}` : ''}${path}${url.search}`;
  } catch {
    return trimmed;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Booleans as stored, before the both-on pair is cleared. Missing entries are all off. */
export function rawStoredPrefs(entry: unknown): IntegrationPrefs {
  if (!isRecord(entry)) return defaultIntegrations();
  return {
    spoolman: entry.spoolman === true,
    happyHare: entry.happyHare === true,
    afc: entry.afc === true,
  };
}

/**
 * Accepts only real booleans. A stored pair with both changers on is invalid,
 * so both go off rather than picking one for the user.
 */
export function sanitizeIntegrations(entry: unknown): IntegrationPrefs {
  const flags = rawStoredPrefs(entry);
  if (flags.happyHare && flags.afc) return { spoolman: flags.spoolman, happyHare: false, afc: false };
  return flags;
}

export function sameIntegrations(a: IntegrationPrefs, b: IntegrationPrefs): boolean {
  return a.spoolman === b.spoolman && a.happyHare === b.happyHare && a.afc === b.afc;
}

/** Turning a changer on clears the other. Turning one off leaves the other off. */
export function toggleIntegration(current: IntegrationPrefs, id: IntegrationId, enabled: boolean): IntegrationPrefs {
  const next: IntegrationPrefs = { ...current, [id]: enabled };
  if (enabled && id === 'happyHare') next.afc = false;
  if (enabled && id === 'afc') next.happyHare = false;
  return next;
}

export function parseIntegrationBook(raw: string | null): IntegrationBook {
  if (!raw) return { printers: {} };
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || !isRecord(value.printers)) return { printers: {} };
    const printers: Record<string, IntegrationPrefs> = {};
    for (const [key, entry] of Object.entries(value.printers)) {
      if (!key || key.length > 1024) continue;
      printers[key] = sanitizeIntegrations(entry);
    }
    return { printers };
  } catch {
    return { printers: {} };
  }
}

export function writePrinterIntegrations(book: IntegrationBook, key: string, prefs: IntegrationPrefs): IntegrationBook {
  const printers: Record<string, IntegrationPrefs> = {};
  for (const [existing, entry] of Object.entries(book.printers)) {
    if (existing !== key) printers[existing] = entry;
  }
  printers[key] = sanitizeIntegrations(prefs);
  const names = Object.keys(printers);
  while (names.length > MAX_SAVED_PRINTERS) {
    const oldest = names.shift();
    if (!oldest || oldest === key) break;
    delete printers[oldest];
  }
  return { printers };
}

/**
 * True only when the user turned the feature on and this printer currently has it.
 * Unknown (`null`) stays off so a missing report does not start subscriptions.
 */
export function integrationActive(enabled: boolean, capabilityPresent: boolean | null): boolean {
  return enabled && capabilityPresent === true;
}

/** Happy Hare is the Klipper object `mmu`. AFC is the object `AFC`. Lane or machine objects do not count. */
export function integrationPresence(id: IntegrationId, discovery: IntegrationDiscovery | null): boolean | null {
  if (!discovery) return null;
  if (id === 'happyHare') {
    if (!discovery.objects) return null;
    return discovery.objects.includes('mmu');
  }
  if (id === 'afc') {
    if (!discovery.objects) return null;
    return discovery.objects.includes('AFC');
  }
  if (discovery.failedComponents?.includes('spoolman')) return false;
  if (!discovery.components) return null;
  return discovery.components.includes('spoolman');
}

export function integrationStatusText(input: {
  enabled: boolean;
  connected: boolean;
  presence: boolean | null;
  pending: boolean;
  failed: boolean;
}): string {
  if (!input.enabled) return 'Off';
  if (!input.connected) return 'On, waiting for the printer';
  if (input.presence === true) return 'On, available';
  if (input.presence === false) return input.failed ? 'On, not running on this printer' : 'On, not detected on this printer';
  if (input.pending) return 'On, checking this printer';
  return 'On, not reported by this printer';
}

/** Direct links to a changer screen leave that screen when its switch is off. */
export function integrationRouteHidden(route: string, prefs: IntegrationPrefs): boolean {
  if (route === 'mmu') return !prefs.happyHare;
  if (route === 'afc') return !prefs.afc;
  return false;
}

export function changerExclusivityNote(prefs: IntegrationPrefs): string {
  if (prefs.happyHare) return 'Happy Hare is on, so AFC is off.';
  if (prefs.afc) return 'AFC is on, so Happy Hare is off.';
  return 'Happy Hare and AFC are both off.';
}
