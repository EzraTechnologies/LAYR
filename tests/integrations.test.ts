import { describe, expect, it } from 'vitest';
import { discoverIntegrations, discoveryFromPayloads } from '../src/lib/integrations/discover';
import {
  DEFAULT_INTEGRATIONS,
  STORAGE_INTEGRATIONS_KEY,
  changerExclusivityNote,
  defaultIntegrations,
  integrationActive,
  integrationPresence,
  integrationRouteHidden,
  integrationScopeKey,
  integrationStatusText,
  normalizeMoonrakerUrl,
  parseIntegrationBook,
  sanitizeIntegrations,
  toggleIntegration,
  writePrinterIntegrations,
  type IntegrationPrefs,
} from '../src/lib/integrations/preferences';
import { integrationEnabled, isStatusSubscriptionLinked, linkStatusSubscription, resetIntegrationRuntime, setIntegrationRuntime } from '../src/lib/integrations/runtime';
import { STORAGE_UI_KEY, parseSettings } from '../src/lib/settings.svelte';

const OFF: IntegrationPrefs = defaultIntegrations();

describe('integration defaults', () => {
  it('starts all three off so an existing install does not grow new screens', () => {
    expect(DEFAULT_INTEGRATIONS).toEqual({ spoolman: false, happyHare: false, afc: false });
    expect(parseIntegrationBook(null).printers).toEqual({});
    expect(sanitizeIntegrations(undefined)).toEqual(OFF);
    expect(sanitizeIntegrations({})).toEqual(OFF);
    expect(sanitizeIntegrations({ spoolman: 'yes', happyHare: 1, afc: false })).toEqual(OFF);
  });

  it('keeps a saved choice and ignores the display-settings record', () => {
    const ui = '{"theme":"black","filesViewMode":"folders","onScreenKeyboard":true,"hideCursor":true,"displayName":"Trident"}';
    expect(STORAGE_INTEGRATIONS_KEY).not.toBe(STORAGE_UI_KEY);
    expect(parseSettings(ui)).toMatchObject({
      theme: 'black',
      filesViewMode: 'folders',
      onScreenKeyboard: true,
      hideCursor: true,
      displayName: 'Trident',
    });
    const book = parseIntegrationBook('{"printers":{"default\\nhttp://printer.local:7125":{"spoolman":true}}}');
    expect(book.printers['default\nhttp://printer.local:7125']).toEqual({ spoolman: true, happyHare: false, afc: false });
    expect(parseSettings(ui).theme).toBe('black');
  });
});

describe('changer exclusivity', () => {
  it('turns the other changer off and leaves both off when either switch is cleared', () => {
    const happy = toggleIntegration(OFF, 'happyHare', true);
    expect(happy).toEqual({ spoolman: false, happyHare: true, afc: false });
    const afc = toggleIntegration(happy, 'afc', true);
    expect(afc).toEqual({ spoolman: false, happyHare: false, afc: true });
    const back = toggleIntegration(afc, 'happyHare', true);
    expect(back).toEqual({ spoolman: false, happyHare: true, afc: false });
    expect(toggleIntegration(back, 'happyHare', false)).toEqual(OFF);
    const onlyAfc = toggleIntegration(OFF, 'afc', true);
    expect(toggleIntegration(onlyAfc, 'afc', false)).toEqual(OFF);
    expect(changerExclusivityNote(OFF)).toBe('Happy Hare and AFC are both off.');
    expect(changerExclusivityNote(happy)).toBe('Happy Hare is on, so AFC is off.');
    expect(changerExclusivityNote(onlyAfc)).toBe('AFC is on, so Happy Hare is off.');
  });

  it('repairs a stored pair that has both changers on by clearing both', () => {
    expect(sanitizeIntegrations({ spoolman: true, happyHare: true, afc: true })).toEqual({
      spoolman: true,
      happyHare: false,
      afc: false,
    });
  });

  it('leaves Spoolman alone when a changer changes', () => {
    const withSpool = toggleIntegration(OFF, 'spoolman', true);
    expect(toggleIntegration(withSpool, 'happyHare', true)).toEqual({ spoolman: true, happyHare: true, afc: false });
    expect(toggleIntegration(withSpool, 'afc', true)).toEqual({ spoolman: true, happyHare: false, afc: true });
    expect(toggleIntegration({ spoolman: true, happyHare: true, afc: false }, 'spoolman', false)).toEqual({
      spoolman: false,
      happyHare: true,
      afc: false,
    });
  });
});

describe('per-printer persistence', () => {
  it('keys a printer by id and normalised endpoint', () => {
    expect(normalizeMoonrakerUrl(' HTTP://Printer.local:7125/ ')).toBe('http://printer.local:7125');
    expect(integrationScopeKey('default', 'http://printer.local:7125/')).toBe(integrationScopeKey(' default ', 'http://printer.local:7125'));
    expect(integrationScopeKey('default', 'http://127.0.0.1:7125')).not.toBe(integrationScopeKey('default', 'http://127.0.0.1:7126'));
    expect(integrationScopeKey('shop', 'http://127.0.0.1:7125')).not.toBe(integrationScopeKey('default', 'http://127.0.0.1:7125'));
    expect(integrationScopeKey('default', null)).not.toBe(integrationScopeKey('default', 'http://127.0.0.1:7125'));
  });

  it('writes one printer without copying its switches onto another', () => {
    const first = writePrinterIntegrations({ printers: {} }, integrationScopeKey('default', 'http://a.local:7125'), {
      spoolman: true,
      happyHare: true,
      afc: false,
    });
    const second = writePrinterIntegrations(first, integrationScopeKey('default', 'http://b.local:7125'), {
      spoolman: false,
      happyHare: false,
      afc: true,
    });
    expect(second.printers[integrationScopeKey('default', 'http://a.local:7125')]).toEqual({
      spoolman: true,
      happyHare: true,
      afc: false,
    });
    expect(second.printers[integrationScopeKey('default', 'http://b.local:7125')]).toEqual({
      spoolman: false,
      happyHare: false,
      afc: true,
    });
    expect(parseIntegrationBook('not json').printers).toEqual({});
  });

  it('drops the oldest printer record once the book is full and keeps the one just saved', () => {
    let book = { printers: {} as Record<string, IntegrationPrefs> };
    for (let i = 0; i < 30; i += 1) {
      book = writePrinterIntegrations(book, `p\nhttp://p${i}.local:7125`, { ...OFF, spoolman: true });
    }
    expect(Object.keys(book.printers)).toHaveLength(24);
    expect(book.printers['p\nhttp://p29.local:7125']?.spoolman).toBe(true);
    expect(book.printers['p\nhttp://p0.local:7125']).toBeUndefined();
  });
});

describe('capability gate', () => {
  it('runs a feature only when it is enabled and the printer has it', () => {
    expect(integrationActive(false, false)).toBe(false);
    expect(integrationActive(false, true)).toBe(false);
    expect(integrationActive(true, false)).toBe(false);
    expect(integrationActive(true, null)).toBe(false);
    expect(integrationActive(true, true)).toBe(true);
  });

  it('treats nearby object names as missing hardware', () => {
    const discovery = discoveryFromPayloads(
      { components: ['database'], failed_components: [] },
      { objects: ['extruder', 'mmu_machine', 'AFC_lane lane1', 'AFC_stepper legacy'] },
    );
    expect(integrationPresence('happyHare', discovery)).toBe(false);
    expect(integrationPresence('afc', discovery)).toBe(false);
    expect(integrationPresence('spoolman', discovery)).toBe(false);
    expect(integrationActive(true, integrationPresence('happyHare', discovery))).toBe(false);
  });

  it('recognises the real objects and a failed Spoolman component', () => {
    const ready = discoveryFromPayloads(
      { components: ['database', 'spoolman'] },
      { objects: ['extruder', 'mmu', 'AFC'] },
    );
    expect(integrationPresence('happyHare', ready)).toBe(true);
    expect(integrationPresence('afc', ready)).toBe(true);
    expect(integrationPresence('spoolman', ready)).toBe(true);

    const failed = discoveryFromPayloads({ components: ['spoolman'], failed_components: ['spoolman'] }, { objects: [] });
    expect(integrationPresence('spoolman', failed)).toBe(false);
    expect(integrationPresence('happyHare', discoveryFromPayloads({ components: [] }, null))).toBe(null);
    expect(integrationPresence('spoolman', discoveryFromPayloads({}, { objects: [] }))).toBe(null);
  });

  it('describes off, waiting, missing, and available without sending a command', async () => {
    const base = { enabled: true, connected: true, presence: null as boolean | null, pending: false, failed: false };
    expect(integrationStatusText({ ...base, enabled: false, presence: true })).toBe('Off');
    expect(integrationStatusText({ ...base, connected: false })).toBe('On, waiting for the printer');
    expect(integrationStatusText({ ...base, pending: true })).toBe('On, checking this printer');
    expect(integrationStatusText({ ...base, presence: false })).toBe('On, not detected on this printer');
    expect(integrationStatusText({ ...base, presence: false, failed: true })).toBe('On, not running on this printer');
    expect(integrationStatusText({ ...base, presence: true })).toBe('On, available');
    expect(integrationStatusText(base)).toBe('On, not reported by this printer');

    const methods: string[] = [];
    const found = await discoverIntegrations(async (method) => {
      methods.push(method);
      if (method === 'server.info') return { components: ['spoolman'] };
      if (method === 'printer.objects.list') return { objects: ['mmu'] };
      throw new Error(`unexpected ${method}`);
    });
    expect(methods).toEqual(['server.info', 'printer.objects.list']);
    expect(integrationPresence('spoolman', found)).toBe(true);
    expect(integrationPresence('happyHare', found)).toBe(true);
    expect(integrationPresence('afc', found)).toBe(false);
  });

  it('hides a changer route only while its own switch is off', () => {
    expect(integrationRouteHidden('mmu', OFF)).toBe(true);
    expect(integrationRouteHidden('afc', OFF)).toBe(true);
    expect(integrationRouteHidden('extrude', OFF)).toBe(false);
    expect(integrationRouteHidden('settings', { spoolman: true, happyHare: true, afc: false })).toBe(false);
    expect(integrationRouteHidden('mmu', { ...OFF, happyHare: true })).toBe(false);
    expect(integrationRouteHidden('afc', { ...OFF, happyHare: true })).toBe(true);
  });
});

describe('runtime gate', () => {
  it('stays off until a caller publishes the saved switches', () => {
    resetIntegrationRuntime();
    expect(integrationEnabled('spoolman')).toBe(false);
    expect(integrationEnabled('happyHare')).toBe(false);
    expect(integrationEnabled('afc')).toBe(false);
    expect(isStatusSubscriptionLinked()).toBe(false);
    setIntegrationRuntime({ spoolman: true, happyHare: false, afc: true });
    expect(integrationEnabled('spoolman')).toBe(true);
    expect(integrationEnabled('afc')).toBe(true);
    linkStatusSubscription();
    expect(isStatusSubscriptionLinked()).toBe(true);
    resetIntegrationRuntime();
    expect(integrationEnabled('spoolman')).toBe(false);
    expect(isStatusSubscriptionLinked()).toBe(false);
  });
});
