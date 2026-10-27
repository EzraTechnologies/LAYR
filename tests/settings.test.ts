import { describe, expect, it } from 'vitest';
import { parseSettings } from '../src/lib/settings.svelte';

describe('display name', () => {
  it('defaults to empty so the host name is used, and keeps a saved name', () => {
    expect(parseSettings(null).displayName).toBe('');
    expect(parseSettings('{"displayName":"Voron Trident"}').displayName).toBe('Voron Trident');
    expect(parseSettings('{"displayName":"  mainsailos  "}').displayName).toBe('mainsailos');
  });

  it('rejects names that would not fit the top bar or contain control characters', () => {
    expect(parseSettings('{"displayName":"this name is definitely longer than thirty two characters"}').displayName).toBe('');
    expect(parseSettings('{"displayName":"Voron\\nTrident"}').displayName).toBe('VoronTrident');
  });
});
