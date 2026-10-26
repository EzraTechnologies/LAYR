import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandBlockedError, createCommandGateway, type PrinterCommand } from '../src/lib/actions/commands';
import { resolveConfig } from '../src/lib/config';
import { DemoSource } from '../src/lib/demo/demoSource';
import { DEMO_NOW, DEMO_SCENARIOS, demoScenario } from '../src/lib/demo/scenarios';
import { assembleState } from '../src/lib/printer/assemble';
import { createSourceBundle } from '../src/lib/printer/createSource';
import { LiveSource } from '../src/lib/printer/liveSource';
import type { PrinterState } from '../src/lib/printer/model';

const ALL_COMMANDS: PrinterCommand[] = [
  { kind: 'pause' },
  { kind: 'resume' },
  { kind: 'cancel' },
  { kind: 'emergency_stop' },
  { kind: 'set_temperature', heater: 'extruder', target: 200 },
];

function demoConfig(scenario = 'printing') {
  return resolveConfig({
    env: { VITE_LAYR_MOONRAKER_URL: 'http://real-printer.local:7125' },
    search: `?demo=${scenario}`,
    hostname: 'localhost',
    protocol: 'http:',
    storage: null,
  });
}

describe('demo isolation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('selects the demo source and a blocking gateway even when a Moonraker URL is configured', () => {
    const bundle = createSourceBundle(demoConfig());
    expect(bundle.source).toBeInstanceOf(DemoSource);
    expect(bundle.source.kind).toBe('demo');
    expect(bundle.commands.mode).toBe('demo');
  });

  it('never touches the network or timers', async () => {
    const ws = vi.fn();
    const fetchFn = vi.fn();
    vi.stubGlobal('WebSocket', ws);
    vi.stubGlobal('fetch', fetchFn);
    vi.useFakeTimers();

    const { source } = createSourceBundle(demoConfig());
    const states: PrinterState[] = [];
    source.start((s) => states.push(s));
    (source as DemoSource).setScenario('paused');
    await vi.advanceTimersByTimeAsync(120_000);
    source.stop();

    expect(ws).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(states.map((s) => s.status)).toEqual(['printing', 'paused']);
  });

  it('blocks every printer command in demo mode', async () => {
    const gateway = createSourceBundle(demoConfig()).commands;
    for (const command of ALL_COMMANDS) {
      expect(gateway.availability(command)).toEqual({
        allowed: false,
        reason: 'demo',
        message: 'Demo mode: printer actions are disabled',
      });
      await expect(gateway.execute(command)).rejects.toBeInstanceOf(CommandBlockedError);
    }
  });

  it('also blocks commands in live mode for v0.1', async () => {
    const gateway = createCommandGateway('live');
    for (const command of ALL_COMMANDS) {
      expect(gateway.availability(command).allowed).toBe(false);
      await expect(gateway.execute(command)).rejects.toMatchObject({ reason: 'unsupported' });
    }
  });

  it('uses the live source when demo mode is off', () => {
    const bundle = createSourceBundle(demoConfig('off'));
    expect(bundle.source).toBeInstanceOf(LiveSource);
    expect(bundle.commands.mode).toBe('live');
  });
});

describe('demo scenarios', () => {
  const expected: Record<string, PrinterState['status']> = {
    printing: 'printing',
    paused: 'paused',
    heating: 'printing',
    ready: 'ready',
    complete: 'ready',
    error: 'error',
    disconnected: 'disconnected',
    connecting: 'connecting',
  };

  it.each(DEMO_SCENARIOS)('%s is deterministic and maps to the expected status', (id) => {
    const a = assembleState(demoScenario(id));
    const b = assembleState(demoScenario(id));
    expect(a).toEqual(b);
    expect(a.status).toBe(expected[id]);
    expect(a.now).toBe(DEMO_NOW);
    expect(a.printerId).toBe('demo');
  });

  it('printing scenario exercises the full mapping path', () => {
    const s = assembleState(demoScenario('printing'));
    expect(s.job?.progress).toBe(0.62);
    expect(s.chamber?.label).toBe('Chamber');
    expect(s.sensors.map((x) => x.object)).toEqual(['temperature_sensor raspberry_pi']);
  });
});
