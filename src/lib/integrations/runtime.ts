import { defaultIntegrations, type IntegrationId, type IntegrationPrefs } from './preferences';

/**
 * Plain copy of the active printer's switches for code that cannot import the Svelte store
 * (the Moonraker client and subscription planner). Defaults are off until Settings binds a printer.
 * Updating this does not send G-code.
 */

let current: IntegrationPrefs = defaultIntegrations();
let statusLinked = false;
const listeners = new Set<(prefs: IntegrationPrefs) => void>();

export function currentIntegrations(): IntegrationPrefs {
  return { ...current };
}

export function integrationEnabled(id: IntegrationId): boolean {
  return current[id];
}

export function setIntegrationRuntime(prefs: IntegrationPrefs): void {
  current = { spoolman: prefs.spoolman, happyHare: prefs.happyHare, afc: prefs.afc };
  for (const listener of listeners) listener(currentIntegrations());
}

export function onIntegrationsChanged(listener: (prefs: IntegrationPrefs) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Happy Hare and AFC call this when their object subscription is installed.
 * Settings then reconnects the status socket after a changer switch so the
 * planner can add or drop those objects. Spoolman does not use this.
 */
export function linkStatusSubscription(): void {
  statusLinked = true;
}

export function isStatusSubscriptionLinked(): boolean {
  return statusLinked;
}

/** Test hook. Production code leaves the link in place for the page lifetime. */
export function resetIntegrationRuntime(): void {
  current = defaultIntegrations();
  statusLinked = false;
  listeners.clear();
}
