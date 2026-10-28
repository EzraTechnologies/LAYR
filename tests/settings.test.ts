import { describe, expect, it } from 'vitest';
import { parseFilesViewMode, parseSettings } from '../src/lib/settings.svelte';

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

describe('files view mode', () => {
  it('defaults to list when the preference is missing, so existing installs stay on the current screen', () => {
    expect(parseSettings(null).filesViewMode).toBe('list');
    expect(parseSettings('{"theme":"black","displayName":"Trident"}')).toMatchObject({
      filesViewMode: 'list',
      theme: 'black',
      displayName: 'Trident',
    });
  });

  it('keeps a saved folders choice and accepts the singular folder spelling', () => {
    expect(parseFilesViewMode('folders')).toBe('folders');
    expect(parseFilesViewMode(' folder ')).toBe('folders');
    expect(parseSettings('{"filesViewMode":"folders","dimAfterMinutes":5}').filesViewMode).toBe('folders');
    expect(parseSettings('{"filesViewMode":"folder"}').dimAfterMinutes).toBe(0);
    expect(parseSettings('{"filesViewMode":"folder"}').filesViewMode).toBe('folders');
  });

  it('ignores unknown values without dropping the rest of the saved settings', () => {
    const saved = parseSettings('{"filesViewMode":"grid","dimAfterMinutes":10,"theme":"black","hideCursor":true}');
    expect(saved.filesViewMode).toBe('list');
    expect(saved.dimAfterMinutes).toBe(10);
    expect(saved.theme).toBe('black');
    expect(saved.hideCursor).toBe(true);
    expect(parseFilesViewMode(1)).toBe('list');
    expect(parseFilesViewMode(null)).toBe('list');
    expect(parseSettings('not json').filesViewMode).toBe('list');
  });
});
