import type { Page } from '@playwright/test';
import {
  STORAGE_INTEGRATIONS_KEY,
  defaultIntegrations,
  integrationScopeKey,
  type IntegrationPrefs,
} from '../src/lib/integrations/preferences';

/**
 * Saves switches for the mock printer before the app boots.
 * Call this before `openWithMock`. Unset switches stay off.
 */
export async function seedIntegrations(
  page: Page,
  patch: Partial<IntegrationPrefs>,
  moonrakerUrl: string,
  printerId = 'default',
): Promise<void> {
  const scope = integrationScopeKey(printerId, moonrakerUrl);
  const prefs = { ...defaultIntegrations(), ...patch };
  await page.addInitScript(
    ({ storageKey, scope: printerScope, prefs: saved }) => {
      localStorage.setItem(storageKey, JSON.stringify({ printers: { [printerScope]: saved } }));
    },
    { storageKey: STORAGE_INTEGRATIONS_KEY, scope, prefs },
  );
}
