import type { MacroInfo } from './printer/model';

/** Common names for filament load/unload macros. Only macros that exist on the printer are offered. */
export const LOAD_MACROS = ['LOAD_FILAMENT', 'FILAMENT_LOAD', 'LOAD', 'M701'] as const;
export const UNLOAD_MACROS = ['UNLOAD_FILAMENT', 'FILAMENT_UNLOAD', 'UNLOAD', 'M702'] as const;

export function findMacro(macros: readonly MacroInfo[], candidates: readonly string[]): MacroInfo | null {
  for (const name of candidates) {
    const macro = macros.find((m) => m.name === name);
    if (macro) return macro;
  }
  return null;
}
