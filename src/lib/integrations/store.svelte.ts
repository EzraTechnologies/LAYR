import {
  STORAGE_INTEGRATIONS_KEY,
  defaultIntegrations,
  integrationScopeKey,
  parseIntegrationBook,
  rawStoredPrefs,
  sameIntegrations,
  toggleIntegration,
  writePrinterIntegrations,
  type IntegrationId,
  type IntegrationPrefs,
} from './preferences';
import { isStatusSubscriptionLinked, setIntegrationRuntime } from './runtime';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Per-printer integration switches. `set` writes local storage and nothing else:
 * no G-code, no config write, no filament motion.
 */
export class IntegrationStore {
  scopeKey = $state('');
  value = $state<IntegrationPrefs>(defaultIntegrations());
  /**
   * Increments when Happy Hare or AFC changes and a feature linked the status
   * subscription. The shell reconnects so those objects are added or dropped.
   * Spoolman-only changes leave this at its current value.
   */
  statusRevision = $state(0);

  bind(printerId: string, moonrakerUrl: string | null): void {
    const key = integrationScopeKey(printerId, moonrakerUrl);
    this.scopeKey = key;
    let raw: string | null = null;
    try {
      raw = storage()?.getItem(STORAGE_INTEGRATIONS_KEY) ?? null;
    } catch {
      raw = null;
    }
    const book = parseIntegrationBook(raw);
    const stored = readRawEntry(raw, key);
    const prefs = book.printers[key] ?? defaultIntegrations();
    this.value = prefs;
    setIntegrationRuntime(prefs);
    if (stored && !sameIntegrations(stored, prefs)) this.#persist(prefs);
  }

  /** Local preference only. Callers must not follow this with a motion command. */
  set(id: IntegrationId, enabled: boolean): void {
    if (!this.scopeKey) return;
    const previous = this.value;
    const next = toggleIntegration(previous, id, enabled);
    if (sameIntegrations(previous, next)) return;
    this.value = next;
    setIntegrationRuntime(next);
    this.#persist(next);
    const statusChanged = previous.happyHare !== next.happyHare || previous.afc !== next.afc;
    if (statusChanged && isStatusSubscriptionLinked()) this.statusRevision += 1;
  }

  #persist(prefs: IntegrationPrefs): void {
    try {
      const book = parseIntegrationBook(storage()?.getItem(STORAGE_INTEGRATIONS_KEY) ?? null);
      const next = writePrinterIntegrations(book, this.scopeKey, prefs);
      storage()?.setItem(STORAGE_INTEGRATIONS_KEY, JSON.stringify(next));
    } catch {
      // Locked-down kiosk profiles may block storage; the choice then lasts for this session.
    }
  }
}

function readRawEntry(raw: string | null, key: string): IntegrationPrefs | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const printers = (value as { printers?: unknown }).printers;
    if (typeof printers !== 'object' || printers === null || Array.isArray(printers)) return null;
    if (!Object.prototype.hasOwnProperty.call(printers, key)) return null;
    return rawStoredPrefs((printers as Record<string, unknown>)[key]);
  } catch {
    return null;
  }
}

export const integrations = new IntegrationStore();
