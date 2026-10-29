/** Happy Hare status read from the `mmu` / `mmu_machine` objects. Missing fields stay null. */

export interface MmuGate {
  index: number;
  /** Tool mapped to this gate, when `ttg_map` or a 1:1 layout provides one. */
  tool: number | null;
  unit: string | null;
  filamentName: string | null;
  material: string | null;
  /** CSS colour from `gate_color_rgb` or a reported hex. A colour name stays in `colorName`. */
  color: string | null;
  colorName: string | null;
  /** Documented `gate_status` code: -1 unknown, 0 empty, 1 available, 2 buffered. */
  status: number | null;
  spoolId: number | null;
  temperatureC: number | null;
}

export interface MmuUnit {
  name: string;
  firstGate: number;
  gateCount: number;
}

export interface MmuSnapshot {
  enabled: boolean | null;
  version: string | null;
  numGates: number | null;
  homed: boolean | null;
  printState: string | null;
  tool: number | null;
  gate: number | null;
  filament: string | null;
  action: string | null;
  operation: string | null;
  reasonForPause: string | null;
  hasBypass: boolean | null;
  /** Gate index per tool. Null when Happy Hare did not send `ttg_map`. */
  ttgMap: number[] | null;
  activeName: string | null;
  activeMaterial: string | null;
  units: MmuUnit[];
  gates: MmuGate[];
}

export type MmuCommand =
  | { kind: 'mmu_home' }
  | { kind: 'mmu_select'; gate: number }
  | { kind: 'mmu_change_tool'; gate: number }
  | { kind: 'mmu_load' }
  | { kind: 'mmu_unload' }
  | { kind: 'mmu_eject' }
  | { kind: 'mmu_preload' }
  | { kind: 'mmu_check_gate' }
  | { kind: 'mmu_recover' }
  | { kind: 'mmu_unlock' }
  | { kind: 'mmu_bypass' };
