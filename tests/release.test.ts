import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/lib/config';
import { createSource } from '../src/lib/printer/createSource';
import { LiveSource } from '../src/lib/printer/liveSource';
import type { PrinterState } from '../src/lib/printer/model';
import { UnconfiguredSource } from '../src/lib/printer/source';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const config = (search = '', env: Record<string, string> = {}) =>
  resolveConfig({ env, search, hostname: 'localhost', protocol: 'http:', storage: null });

describe('release build has no demo mode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('ships no demo module, scenario data or demo switches in the app source', () => {
    expect(existsSync('src/lib/demo')).toBe(false);
    for (const file of walk('src')) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/DemoSource|demoScenario|DEMO_SCENARIOS|VITE_LAYR_DEMO|\?demo=/);
    }
  });

  it('stays offline and silent until an endpoint is configured, even with ?demo=', async () => {
    const ws = vi.fn();
    const fetchFn = vi.fn();
    vi.stubGlobal('WebSocket', ws);
    vi.stubGlobal('fetch', fetchFn);
    vi.useFakeTimers();

    const source = createSource(config('?demo=printing', { VITE_LAYR_DEMO: 'printing' }));
    expect(source).toBeInstanceOf(UnconfiguredSource);
    expect(source.connection).toBeNull();
    const states: PrinterState[] = [];
    source.start((s) => states.push(s));
    await vi.advanceTimersByTimeAsync(120_000);
    source.stop();

    expect(ws).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ status: 'unconfigured', job: null, extruder: null, bed: null, fans: [], macros: [] });
  });

  it('uses the live source once a URL is configured', () => {
    expect(createSource(config('?moonraker=http://trident.local:7125'))).toBeInstanceOf(LiveSource);
  });
});
