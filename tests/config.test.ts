import { describe, expect, it } from 'vitest';
import { activePrinter, isValidMoonrakerUrl, resolveConfig, STORAGE_URL_KEY, type ConfigInputs } from '../src/lib/config';

function inputs(over: Partial<ConfigInputs> = {}): ConfigInputs {
  return { env: {}, search: '', hostname: 'pi.local', protocol: 'http:', storage: null, ...over };
}

const storage = (value: string | null) => ({ getItem: (k: string) => (k === STORAGE_URL_KEY ? value : null) });

describe('resolveConfig', () => {
  it('has no implicit endpoint: without configuration LAYR is not set up', () => {
    const c = resolveConfig(inputs());
    expect(activePrinter(c).moonrakerUrl).toBeNull();
    expect(c.urlSource).toBe('none');
    // The page host is only offered as a suggestion in Settings.
    expect(c.suggestedUrl).toBe('http://pi.local:7125');
  });

  it('follows query > storage > env precedence', () => {
    const env = { VITE_LAYR_MOONRAKER_URL: 'http://env:7125' };
    expect(activePrinter(resolveConfig(inputs({ env }))).moonrakerUrl).toBe('http://env:7125');
    expect(activePrinter(resolveConfig(inputs({ env, storage: storage('http://saved:7125') }))).moonrakerUrl).toBe(
      'http://saved:7125',
    );
    const c = resolveConfig(inputs({ env, storage: storage('http://saved:7125'), search: '?moonraker=http://q:7125' }));
    expect(activePrinter(c).moonrakerUrl).toBe('http://q:7125');
    expect(c.urlSource).toBe('query');
  });

  it('ignores invalid URLs, URLs with credentials and broken storage', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
    };
    const c = resolveConfig(inputs({ search: '?moonraker=javascript:alert(1)', storage: throwing }));
    expect(activePrinter(c).moonrakerUrl).toBeNull();
    expect(isValidMoonrakerUrl('http://user:pass@pi.local:7125')).toBe(false);
    expect(isValidMoonrakerUrl('ws://pi.local:7125')).toBe(true);
  });

  it('keeps the Moonraker URL when the kiosk adds layr_build', () => {
    const c = resolveConfig(
      inputs({ search: '?moonraker=http://q:7125&layr_build=20261028T010000Z' }),
    );
    expect(activePrinter(c).moonrakerUrl).toBe('http://q:7125');
    expect(c.urlSource).toBe('query');
    expect(c).not.toHaveProperty('layrBuild');
  });

  it('ignores the removed demo switches', () => {
    for (const search of ['?demo=printing', '?demo=1', '?demo']) {
      const c = resolveConfig(inputs({ search, env: { VITE_LAYR_DEMO: 'printing' } }));
      expect(c).not.toHaveProperty('demo');
      expect(activePrinter(c).moonrakerUrl).toBeNull();
    }
  });

  it('brackets IPv6 hosts in the suggested URL and follows https pages', () => {
    expect(resolveConfig(inputs({ hostname: '::1' })).suggestedUrl).toBe('http://[::1]:7125');
    expect(resolveConfig(inputs({ protocol: 'https:' })).suggestedUrl).toBe('https://pi.local:7125');
  });

  it('reads printer name and API key from env', () => {
    const p = activePrinter(resolveConfig(inputs({ env: { VITE_LAYR_PRINTER_NAME: ' Voron ', VITE_LAYR_API_KEY: ' k ' } })));
    expect(p).toMatchObject({ name: 'Voron', apiKey: 'k' });
  });
});
