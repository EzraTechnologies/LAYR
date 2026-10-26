/** Device-local display preferences, stored in localStorage. Nothing here is sent to the printer. */
export interface UiSettings {
  /** Minutes without touch before the screen dims; 0 disables dimming. */
  dimAfterMinutes: number;
  /** Overlay opacity while dimmed (0..0.9). Dimming never turns the backlight off. */
  dimLevel: number;
  theme: 'midnight' | 'black';
  /** Hides the mouse pointer for touch-only kiosks. */
  hideCursor: boolean;
  showHiddenMacros: boolean;
  /** Shows LAYR's on-screen keyboard for text fields. */
  onScreenKeyboard: boolean;
}

export const STORAGE_UI_KEY = 'layr.ui';
export const DIM_OPTIONS = [0, 1, 5, 10, 30] as const;

export const DEFAULT_SETTINGS: UiSettings = {
  dimAfterMinutes: 0,
  dimLevel: 0.7,
  theme: 'midnight',
  hideCursor: false,
  showHiddenMacros: false,
  onScreenKeyboard: true,
};

export function parseSettings(raw: string | null): UiSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const value = JSON.parse(raw) as Partial<UiSettings>;
    const s = { ...DEFAULT_SETTINGS };
    if (DIM_OPTIONS.includes(value.dimAfterMinutes as (typeof DIM_OPTIONS)[number])) s.dimAfterMinutes = value.dimAfterMinutes!;
    if (typeof value.dimLevel === 'number' && value.dimLevel >= 0 && value.dimLevel <= 0.9) s.dimLevel = value.dimLevel;
    if (value.theme === 'midnight' || value.theme === 'black') s.theme = value.theme;
    for (const key of ['hideCursor', 'showHiddenMacros', 'onScreenKeyboard'] as const) {
      if (typeof value[key] === 'boolean') s[key] = value[key];
    }
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export class SettingsStore {
  readonly value: UiSettings;

  constructor() {
    let raw: string | null = null;
    try {
      raw = storage()?.getItem(STORAGE_UI_KEY) ?? null;
    } catch {
      raw = null;
    }
    this.value = $state(parseSettings(raw));
  }

  update(patch: Partial<UiSettings>): void {
    Object.assign(this.value, patch);
    try {
      storage()?.setItem(STORAGE_UI_KEY, JSON.stringify(this.value));
    } catch {
      // Locked-down kiosk profiles may block storage; settings then last for this session.
    }
  }
}
