/** How the Files screen lays out the current Moonraker directory. Display only. */
export type FilesViewMode = 'list' | 'folders';

/** Device-local display preferences, stored in localStorage. Nothing here is sent to the printer. */
export interface UiSettings {
  /** Minutes without touch before the screen dims; 0 disables dimming. */
  dimAfterMinutes: number;
  /** Overlay opacity while dimmed (0..0.9). Dimming never turns the backlight off. */
  dimLevel: number;
  theme: 'midnight' | 'black';
  /** Hides the mouse pointer for touch-only kiosks. */
  hideCursor: boolean;
  /**
   * Name shown in the top bar. Empty means the Klipper host name.
   * This never changes the Linux hostname.
   */
  displayName: string;
  showHiddenMacros: boolean;
  /** Shows LAYR's on-screen keyboard for text fields. */
  onScreenKeyboard: boolean;
  /**
   * Files screen layout. `list` is the compact rows shipped before this setting existed.
   * `folders` is the thumbnail-card layout. The stored id stays `folders` so a device
   * that saved it before the control was labelled Thumbnails still opens that layout.
   * Missing or unknown values, including the display word "thumbnails", stay on `list`.
   */
  filesViewMode: FilesViewMode;
}

/** Toolbar and Settings labels. `folders` is the persisted id for the Thumbnails layout. */
export const FILES_VIEW_OPTIONS: Array<{ id: FilesViewMode; label: string }> = [
  { id: 'list', label: 'List' },
  { id: 'folders', label: 'Thumbnails' },
];

export const STORAGE_UI_KEY = 'layr.ui';
export const DIM_OPTIONS = [0, 1, 5, 10, 30] as const;

export const DEFAULT_SETTINGS: UiSettings = {
  dimAfterMinutes: 0,
  dimLevel: 0.7,
  theme: 'midnight',
  hideCursor: false,
  showHiddenMacros: false,
  onScreenKeyboard: true,
  displayName: '',
  filesViewMode: 'list',
};

/**
 * Accepts the current values and the singular "folder" used in older notes.
 * Anything else, including a missing field, stays on the list.
 */
export function parseFilesViewMode(value: unknown): FilesViewMode {
  if (typeof value !== 'string') return 'list';
  const mode = value.trim().toLowerCase();
  if (mode === 'folder' || mode === 'folders') return 'folders';
  return 'list';
}

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
    if (typeof value.displayName === 'string') {
      const name = value.displayName.replace(/[\u0000-\u001f]/g, '').trim();
      if (name.length <= 32) s.displayName = name;
    }
    s.filesViewMode = parseFilesViewMode(value.filesViewMode);
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
