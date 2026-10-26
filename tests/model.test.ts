import { describe, expect, it } from 'vitest';
import { deriveStatus, type JobState, type KlippyState, type TransportState } from '../src/lib/printer/model';

describe('deriveStatus', () => {
  const cases: Array<[TransportState, KlippyState, JobState | null, string]> = [
    ['idle', 'ready', 'printing', 'disconnected'],
    ['waiting', 'ready', 'printing', 'disconnected'],
    ['connecting', 'unknown', null, 'connecting'],
    ['connected', 'unknown', null, 'connecting'],
    ['connected', 'startup', null, 'connecting'],
    ['connected', 'disconnected', null, 'disconnected'],
    ['connected', 'shutdown', 'printing', 'error'],
    ['connected', 'error', null, 'error'],
    ['connected', 'ready', null, 'ready'],
    ['connected', 'ready', 'standby', 'ready'],
    ['connected', 'ready', 'complete', 'ready'],
    ['connected', 'ready', 'cancelled', 'ready'],
    ['connected', 'ready', 'printing', 'printing'],
    ['connected', 'ready', 'paused', 'paused'],
    ['connected', 'ready', 'error', 'error'],
    ['connected', 'ready', 'unknown', 'ready'],
  ];

  it.each(cases)('transport=%s klippy=%s job=%s → %s', (transport, klippy, jobState, expected) => {
    expect(deriveStatus({ transport, klippy, jobState }).status).toBe(expected);
  });

  it('passes through Klippy and job messages', () => {
    expect(deriveStatus({ transport: 'connected', klippy: 'shutdown', jobState: null, klippyMessage: 'Lost comms' }).detail).toBe(
      'Lost comms',
    );
    expect(deriveStatus({ transport: 'connected', klippy: 'ready', jobState: 'error', jobMessage: 'Thermal runaway' }).detail).toBe(
      'Thermal runaway',
    );
  });
});
