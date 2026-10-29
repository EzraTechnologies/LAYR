/** Happy Hare status fixtures for Playwright. Not shipped in the app. */

export const MMU_COMMANDS = ['MMU_LOAD', 'MMU_UNLOAD', 'MMU_CHANGE_TOOL', 'MMU_RECOVER'] as const;

export function readyMmu(): Record<string, unknown> {
  return {
    enabled: true,
    num_gates: 5,
    is_homed: true,
    print_state: 'ready',
    tool: 1,
    gate: 2,
    filament: 'Loaded',
    filament_pos: 10,
    action: 'Idle',
    reason_for_pause: '',
    ttg_map: [0, 2, 1, 3, 4],
    gate_status: [1, 0, 1, 2, -1],
    gate_filament_name: ['Galaxy Black', '', 'PolyLite', 'Buffer PLA', ''],
    gate_material: ['ASA', '', 'PLA', 'PLA', ''],
    gate_color: ['#2a2a2a', '', '#3ee0f0', '#fbbf24', ''],
    gate_temperature: [250, 0, 210, 210, 0],
    gate_spool_id: [12, -1, 4, -1, -1],
  };
}

export function errorMmu(): Record<string, unknown> {
  return {
    ...readyMmu(),
    tool: -1,
    filament: 'Unknown',
    filament_pos: -1,
    print_state: 'pause_locked',
    action: 'Idle',
    reason_for_pause: 'Filament clog on gate 2',
  };
}

export function printingMmu(): Record<string, unknown> {
  return { ...readyMmu(), tool: 0, gate: 0, print_state: 'printing', action: 'Idle' };
}

export function partialMmu(): Record<string, unknown> {
  return { enabled: true, tool: 0, gate: 0, filament: 'Unloaded', action: 'Idle', is_homed: false };
}
