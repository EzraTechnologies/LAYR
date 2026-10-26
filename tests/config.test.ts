import { describe, expect, it } from 'vitest';
import { activePrinter, resolveConfig, STORAGE_URL_KEY, type ConfigInputs } from '../src/lib/config';

function inputs(over: Partial<ConfigInputs> = {}): ConfigInputs {
  return { env: {}, search: '', hostname: 'pi.local', protocol: 'http:', storage: null, ...over };
}

const storage = (value: string | null) => ({ getItem: (k: string) => (k === STORAGE_URL_KEY ? value : null) });

describe('resolveConfig', () => {
  it('defaults to port 7125 on the page host', () => {
    const c = resolveConfig(inputs());
    expect(activePrinter(c).moonrakerUrl).toBe('http://pi.local:7125');
    expect(c.urlSource).toBe('default');
    expect(c.demo).toBeNull();
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

  it('ignores invalid URLs and broken storage', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
    };
    const c = resolveConfig(inputs({ search: '?moonraker=javascript:alert(1)', storage: throwing }));
    expect(activePrinter(c).moonrakerUrl).toBe('http://pi.local:7125');
  });

  it('parses demo mode from query and env, with query taking precedence', () => {
    expect(resolveConfig(inputs({ search: '?demo=paused' })).demo).toBe('paused');
    expect(resolveConfig(inputs({ search: '?demo' })).demo).toBeNull();
    expect(resolveConfig(inputs({ search: '?demo=1' })).demo).toBe('printing');
    expect(resolveConfig(inputs({ search: '?demo=nonsense' })).demo).toBe('printing');
    expect(resolveConfig(inputs({ env: { VITE_LAYR_DEMO: 'error' } })).demo).toBe('error');
    expect(resolveConfig(inputs({ env: { VITE_LAYR_DEMO: 'error' }, search: '?demo=off' })).demo).toBeNull();
  });

  it('reads printer name and API key from env', () => {
    const p = activePrinter(resolveConfig(inputs({ env: { VITE_LAYR_PRINTER_NAME: ' Voron ', VITE_LAYR_API_KEY: ' k ' } })));
    expect(p).toMatchObject({ name: 'Voron', apiKey: 'k' });
  });
});
