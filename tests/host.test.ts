import { describe, expect, it } from 'vitest';
import { prepareCommand } from '../src/lib/actions/commands';
import { hostMachineFromInfo, hostParamsAllowed, isHostMethod } from '../src/lib/moonraker/host';
import { assembleState, type AssembleInputs } from '../src/lib/printer/assemble';
import type { PrinterState } from '../src/lib/printer/model';
import { readyState, withJob } from './stateFixture';

function idleHost(overrides: Partial<PrinterState> = {}): PrinterState {
  return readyState({
    hostMachine: 'available',
    printState: 'standby',
    hostname: 'trident',
    idleState: 'Idle',
    ...overrides,
  });
}

function plan(state: PrinterState, kind: 'host_reboot' | 'host_shutdown') {
  const result = prepareCommand({ kind }, state);
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

function blocked(state: PrinterState, kind: 'host_reboot' | 'host_shutdown' = 'host_reboot'): string {
  const result = prepareCommand({ kind }, state);
  if (result.ok) throw new Error(`Expected blocked, got ${result.plan.method}`);
  return result.message;
}

describe('Moonraker host capability', () => {
  it('allows only the two documented host methods, with no parameters', () => {
    expect(isHostMethod('machine.reboot')).toBe(true);
    expect(isHostMethod('machine.shutdown')).toBe(true);
    expect(isHostMethod('machine.services.restart')).toBe(false);
    expect(isHostMethod('machine.system_info')).toBe(false);
    expect(isHostMethod('machine.*')).toBe(false);
    expect(isHostMethod('machine.reboot ')).toBe(false);
    expect(hostParamsAllowed('machine.reboot', undefined)).toBe(true);
    expect(hostParamsAllowed('machine.shutdown', undefined)).toBe(true);
    expect(hostParamsAllowed('machine.reboot', {})).toBe(false);
    expect(hostParamsAllowed('machine.shutdown', { service: 'klipper' })).toBe(false);
    expect(hostParamsAllowed('printer.gcode.script', { script: 'G28' })).toBe(true);
  });

  it('reads the machine component and API version without guessing', () => {
    expect(hostMachineFromInfo(null)).toBe('unknown');
    expect(hostMachineFromInfo({})).toBe('unknown');
    expect(hostMachineFromInfo({ components: 'machine' })).toBe('unknown');
    expect(hostMachineFromInfo({ components: ['database', 'machine'] })).toBe('available');
    expect(hostMachineFromInfo({ components: ['database', 'machine'], api_version: [1, 5, 0] })).toBe('available');
    expect(hostMachineFromInfo({ components: ['database', 'machine'], api_version_string: '1.4.2' })).toBe('available');
    expect(hostMachineFromInfo({ components: ['database'] })).toBe('unavailable');
    expect(hostMachineFromInfo({ components: ['machine'], failed_components: ['machine'] })).toBe('unavailable');
    expect(hostMachineFromInfo({ components: ['machine'], api_version: [0, 9, 0] })).toBe('unavailable');
    expect(hostMachineFromInfo({ components: ['machine'], api_version_string: '0.8.0' })).toBe('unavailable');
    expect(hostMachineFromInfo({ components: ['machine'], api_version: ['1', 0, 0] })).toBe('unavailable');
    expect(hostMachineFromInfo({ components: ['machine'], failed_components: 'machine' })).toBe('unknown');
  });
});

describe('printer host commands', () => {
  it('selects machine.reboot or machine.shutdown and names the connected host', () => {
    const reboot = plan(idleHost(), 'host_reboot');
    expect(reboot.method).toBe('machine.reboot');
    expect(reboot.params).toBeUndefined();
    expect(reboot.group).toBe('pi-host');
    expect(reboot.confirm).toMatchObject({
      title: 'Reboot the printer host?',
      confirmLabel: 'Reboot printer host',
      cancelLabel: 'Go back',
    });
    expect(reboot.confirm?.body).toContain('printer host trident');
    expect(reboot.confirm?.body).toContain('not a Klipper firmware restart');
    expect(reboot.confirm?.body).toContain('lose its connection');
    expect(reboot.confirm?.body).toContain('printer power supply');
    expect(reboot.method).not.toBe('printer.firmware_restart');
    expect(reboot.method).not.toBe('printer.restart');

    const shutdown = plan(idleHost(), 'host_shutdown');
    expect(shutdown.method).toBe('machine.shutdown');
    expect(shutdown.params).toBeUndefined();
    expect(shutdown.confirm?.title).toBe('Shut down the printer host?');
    expect(shutdown.confirm?.body).toContain('does not necessarily remove power');
    expect(shutdown.confirm?.body).toContain('physical power cycle');
    expect(shutdown.note).toContain('physical power cycle');
  });

  it('does not invent a hostname when Klipper has not reported one', () => {
    const body = plan(idleHost({ hostname: null }), 'host_reboot').confirm?.body ?? '';
    expect(body).toContain('the printer host this screen is connected to');
    expect(body).not.toContain('trident');
    expect(body).not.toMatch(/host null|host undefined/i);
  });

  it('blocks printing, paused, offline, not ready, and unknown states', () => {
    const idle = idleHost();
    expect(blocked(withJob(idle, 'printing'))).toBe('Not available during a print');
    expect(blocked(withJob(idle, 'paused'), 'host_shutdown')).toBe('Not available while a print is paused');
    expect(blocked(idleHost({ transport: 'waiting', status: 'disconnected' }))).toBe('Printer is offline');
    expect(blocked(idleHost({ status: 'unconfigured', transport: 'idle' }))).toMatch(/Set up the printer connection/);
    expect(blocked(idleHost({ klippy: 'unknown', status: 'connecting' }))).toBe('Printer state is unknown');
    expect(blocked(idleHost({ klippy: 'shutdown', status: 'error' }))).toBe('Klipper is not ready');
    expect(blocked(idleHost({ klippy: 'startup', status: 'connecting' }))).toBe('Klipper is not ready');
    expect(blocked(idleHost({ klippy: 'disconnected', status: 'disconnected' }))).toBe('Klipper is not ready');
    expect(blocked(idleHost({ printState: null }))).toBe('Print state is unknown');
    expect(blocked(idleHost({ printState: 'unknown' }))).toBe('Print state is unknown');
    expect(blocked(idleHost({ idleState: 'Printing' }))).toBe('Klipper is busy');
    expect(blocked(idleHost({ hostMachine: 'unknown' }))).toMatch(/has not reported/);
    expect(blocked(idleHost({ hostMachine: 'unavailable' }), 'host_shutdown')).toMatch(/does not provide/);
  });

  it('keeps an idle standby print state when no file is loaded', () => {
    const input: AssembleInputs = {
      printerId: 'p1',
      configuredName: '',
      hostname: 'trident',
      transport: 'connected',
      klippy: 'ready',
      klippyMessage: null,
      reconnectAttempt: 0,
      nextRetryAt: null,
      transportReason: null,
      raw: { print_stats: { filename: '', state: 'standby' }, idle_timeout: { state: 'Idle' } },
      slicerEstimate: null,
      missingObjects: [],
      objects: ['print_stats'],
      afcCommands: [],
      settings: {},
      thumbnailPath: null,
      hostMachine: 'available',
      now: 0,
    };
    const state = assembleState(input);
    expect(state.job).toBeNull();
    expect(state.printState).toBe('standby');
    expect(state.hostMachine).toBe('available');
    expect(prepareCommand({ kind: 'host_reboot' }, state).ok).toBe(true);
    expect(assembleState({ ...input, raw: { print_stats: { filename: '', state: 'nope' } } }).printState).toBe('unknown');
  });
});
