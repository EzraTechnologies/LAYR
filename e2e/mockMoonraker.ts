import type { Page, WebSocketRoute } from '@playwright/test';
import { partThumbnail } from './png';

/**
 * Stateful Moonraker stand-in for Playwright, served through WebSocket and HTTP routing. It implements the
 * JSON-RPC methods LAYR uses and simulates enough of Klipper (homing, travel limits, heaters, fans, prints,
 * files) to exercise the UI end to end. All data here is test fixture data; none of it ships in the app.
 */

export type Scenario = 'ready' | 'printing' | 'paused' | 'complete' | 'shutdown' | 'startup';

type Status = Record<string, Record<string, unknown>>;

export interface MockFile {
  path: string;
  modified: number;
  size: number;
  meta: Record<string, unknown> | null;
}

export const MOONRAKER = 'http://127.0.0.1:7125';
/** 2026-01-15 14:32:00 UTC, used for deterministic screenshots. */
export const FIXED_NOW = Date.UTC(2026, 0, 15, 14, 32, 0);
const T = FIXED_NOW / 1000;

const AXIS_MAX = [250, 250, 230];
const AXIS_MIN = [0, 0, -5];
const PRINT_FILE = 'stealthburner/SB_main_body_ASA_0.2mm_3h41m.gcode';

const MACROS: Record<string, { gcode: string; description?: string }> = {
  PRINT_START: { gcode: '{% set bed = params.BED|default(100)|int %}\nM190 S{bed}\nG28', description: 'Heat, home and level for a print' },
  PRINT_END: { gcode: 'M104 S0\nM140 S0' },
  LOAD_FILAMENT: { gcode: 'M83\nG1 E50 F300', description: 'Feed filament into the hotend' },
  UNLOAD_FILAMENT: { gcode: 'M83\nG1 E-60 F1200', description: 'Retract filament out of the hotend' },
  CASELIGHT_ON: { gcode: 'SET_PIN PIN=caselight VALUE=1' },
  CASELIGHT_OFF: { gcode: 'SET_PIN PIN=caselight VALUE=0' },
  CHAMBER_HEATSOAK: { gcode: 'M190 S{params.TEMP|int}\nG4 P{params.MINUTES|default(10)|int * 60000}', description: 'Soak the chamber' },
  NOZZLE_CLEAN: { gcode: 'G1 X50 Y250', description: 'Wipe the nozzle on the brush' },
  BED_MESH_LOAD: { gcode: 'BED_MESH_PROFILE LOAD=default' },
  QUAD_GANTRY_LEVEL_SAFE: { gcode: 'G28\nQUAD_GANTRY_LEVEL' },
  PAUSE: { gcode: 'PAUSE_BASE' },
  RESUME: { gcode: 'RESUME_BASE' },
  CANCEL_PRINT: { gcode: 'CANCEL_PRINT_BASE' },
  _HOME_Z_HELPER: { gcode: 'G28 Z' },
  _CLIENT_VARIABLE: { gcode: '' },
};

function mockSpoolPayload(): Array<Record<string, unknown>> {
  const rows: MockSpool[] = [
    { id: 1, name: 'PolyTerra Black', material: 'PLA', vendor: 'Polymaker', color: '1c1c1c', remaining: 812, length: 274_000, used: 188, total: 1000 },
    { id: 2, name: 'Galaxy Orange', material: 'ASA', vendor: 'Polymaker', color: 'ff6a00', remaining: 420.4, length: 141_200, used: 79.6, total: 500 },
    { id: 3, name: 'Empty PETG', material: 'PETG', vendor: 'Prusament', color: '2f6fed', remaining: 0, length: 0, used: 1000, total: 1000, archived: true },
    { id: 4, name: 'Mystery spool', material: 'Nylon', vendor: '', color: '', remaining: null, length: null, used: null, total: null },
  ];
  return rows.map((spool) => ({
    id: spool.id,
    archived: spool.archived === true,
    remaining_weight: spool.remaining,
    remaining_length: spool.length,
    used_weight: spool.used,
    location: spool.id === 2 ? 'Box 1' : null,
    lot_nr: spool.id === 1 ? 'L2401' : null,
    filament: {
      name: spool.name,
      material: spool.material,
      weight: spool.total,
      color_hex: spool.color || null,
      vendor: spool.vendor ? { name: spool.vendor } : null,
    },
  }));
}

function thumbs(name: string): Array<Record<string, unknown>> {
  const base = name.replace(/\.gcode$/, '');
  return [
    { width: 32, height: 32, size: 900, relative_path: `.thumbs/${base}-32x32.png` },
    { width: 300, height: 300, size: 30000, relative_path: `.thumbs/${base}-300x300.png` },
  ];
}

function fileMeta(name: string, extra: Record<string, unknown>, withThumbs = true): Record<string, unknown> {
  return {
    slicer: 'OrcaSlicer',
    slicer_version: '2.3.0',
    layer_height: 0.2,
    first_layer_height: 0.25,
    nozzle_diameter: 0.4,
    filament_type: 'ASA',
    filament_name: 'Polymaker ASA Galaxy Black',
    first_layer_extr_temp: 255,
    first_layer_bed_temp: 105,
    ...(withThumbs ? { thumbnails: thumbs(name) } : {}),
    ...extra,
  };
}

export function defaultFiles(): MockFile[] {
  return [
    { path: 'Voron_Design_Cube_v7_ASA_0.2mm_1h12m.gcode', modified: T - 3600, size: 4_812_300, meta: fileMeta('Voron_Design_Cube_v7_ASA_0.2mm_1h12m.gcode', { estimated_time: 4320, filament_total: 6120.4, filament_weight_total: 18.4 }) },
    { path: 'cable_chain_mount_PETG.gcode', modified: T - 86_400 * 2, size: 1_203_100, meta: fileMeta('cable_chain_mount_PETG.gcode', { estimated_time: 2280, filament_total: 2310, filament_type: 'PETG', first_layer_extr_temp: 240, first_layer_bed_temp: 80 }) },
    { path: 'no_preview_bracket.gcode', modified: T - 86_400 * 5, size: 812_000, meta: fileMeta('no_preview_bracket.gcode', { estimated_time: 1500, filament_total: 1400 }, false) },
    { path: PRINT_FILE, modified: T - 7200, size: 9_402_000, meta: fileMeta('SB_main_body_ASA_0.2mm_3h41m.gcode', { estimated_time: 13_260, filament_total: 21_870, filament_weight_total: 65.2 }) },
    { path: 'stealthburner/SB_cowling_ASA_0.2mm.gcode', modified: T - 7300, size: 5_100_000, meta: fileMeta('SB_cowling_ASA_0.2mm.gcode', { estimated_time: 7800, filament_total: 11_020 }) },
    { path: 'calibration/first layer #2.gcode', modified: T - 600, size: 302_000, meta: fileMeta('first layer #2.gcode', { estimated_time: 540, filament_total: 820 }) },
    { path: 'readme.txt', modified: T - 9000, size: 120, meta: null },
  ];
}

function baseStatus(scenario: Scenario, homed: boolean): Status {
  const printing = scenario === 'printing' || scenario === 'paused' || scenario === 'complete';
  const active = scenario === 'printing' || scenario === 'paused';
  const jobState = scenario === 'ready' ? 'standby' : scenario === 'printing' || scenario === 'paused' || scenario === 'complete' ? scenario : 'standby';
  const progress = scenario === 'complete' ? 1 : scenario === 'paused' ? 0.41 : 0.62;
  const duration = scenario === 'complete' ? 13_100 : scenario === 'paused' ? 5_400 : 8_220;
  return {
    webhooks: { state: 'ready', state_message: 'Printer is ready' },
    print_stats: printing
      ? {
          filename: PRINT_FILE,
          state: jobState,
          message: '',
          print_duration: duration,
          total_duration: duration + 300,
          filament_used: Math.round(duration * 1.6),
          info: { current_layer: Math.round(progress * 210), total_layer: 210 },
        }
      : { filename: '', state: 'standby', message: '', print_duration: 0, total_duration: 0, filament_used: 0, info: {} },
    display_status: { progress: printing ? progress : 0, message: null },
    virtual_sdcard: { progress: printing ? progress : 0, is_active: scenario === 'printing', file_path: printing ? `/home/pi/printer_data/gcodes/${PRINT_FILE}` : null },
    extruder: active
      ? { temperature: 254.6, target: 255, power: 0.46, can_extrude: true }
      : scenario === 'complete'
        ? { temperature: 92.1, target: 0, power: 0, can_extrude: false }
        : { temperature: 24.8, target: 0, power: 0, can_extrude: false },
    heater_bed: active ? { temperature: 105.2, target: 105, power: 0.38 } : { temperature: scenario === 'complete' ? 71.3 : 23.9, target: 0, power: 0 },
    'temperature_sensor chamber': { temperature: active ? 51.4 : 24.1 },
    'temperature_sensor raspberry_pi': { temperature: 48.3 },
    toolhead: {
      homed_axes: homed || printing ? 'xyz' : '',
      position: active ? [142.31, 118.05, 25.2, 1820.4] : homed ? [125, 125, 10, 0] : [0, 0, 0, 0],
      axis_minimum: [...AXIS_MIN, 0],
      axis_maximum: [...AXIS_MAX, 0],
      max_velocity: 300,
      extruder: 'extruder',
    },
    // Factors are intentionally not 1. The dashboard must show live mm/s and mm³/s, not these percentages.
    gcode_move: { homing_origin: [0, 0, active ? -0.02 : 0, 0], speed_factor: 1.5, extrude_factor: 1.2 },
    motion_report: {
      live_velocity: scenario === 'printing' ? 48.2 : 0,
      live_extruder_velocity: scenario === 'printing' ? 5 : 0,
    },
    idle_timeout: { state: active ? 'Printing' : 'Idle' },
    fan: { speed: active ? 0.4 : 0, rpm: null },
    'fan_generic nevermore': { speed: active ? 1 : 0, rpm: null },
    'heater_fan hotend_fan': { speed: active ? 1 : 0, rpm: active ? 7820 : 0 },
    'controller_fan electronics': { speed: active ? 0.6 : 0, rpm: null },
    'output_pin caselight': { value: 0.8 },
    'neopixel sb_leds': { color_data: [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]] },
    'filament_switch_sensor runout': { filament_detected: true, enabled: true },
  };
}

function settings(): Record<string, Record<string, unknown>> {
  const s: Record<string, Record<string, unknown>> = {
    printer: { kinematics: 'corexy', max_velocity: 300, max_accel: 4000, max_z_velocity: 15 },
    extruder: { min_temp: 10, max_temp: 300, min_extrude_temp: 170, max_extrude_only_distance: 150, max_extrude_only_velocity: 50, filament_diameter: '1.75' },
    heater_bed: { min_temp: 0, max_temp: 120 },
    'output_pin caselight': { pwm: true, scale: 1 },
    'neopixel sb_leds': { chain_count: 3 },
  };
  for (const [name, macro] of Object.entries(MACROS)) {
    s[`gcode_macro ${name.toLowerCase()}`] = { gcode: macro.gcode, description: macro.description ?? 'G-Code macro' };
  }
  return s;
}

const CONTROL = new Set([
  'printer.gcode.script',
  'printer.print.start',
  'printer.print.pause',
  'printer.print.resume',
  'printer.print.cancel',
  'printer.emergency_stop',
  'printer.restart',
  'printer.firmware_restart',
  'server.files.delete_file',
  'server.spoolman.post_spool_id',
]);

export type SpoolmanMode = 'absent' | 'ready' | 'offline' | 'error';
/** `off` printers have no AFC objects. `unsupported` has lanes but not the documented motion commands. */
export type AfcMode = 'off' | 'ready' | 'error' | 'busy' | 'unsupported';
/** `off` printers have no `mmu` object. `legacy` only registers the older `*_TOOL` command names. */
export type MmuMode = 'off' | 'ready' | 'printing' | 'pause_locked' | 'error' | 'busy' | 'unsupported' | 'legacy';

function mmuStatus(mode: Exclude<MmuMode, 'off'>): Status {
  return {
    mmu: {
      enabled: true,
      num_gates: 4,
      is_homed: true,
      print_state: mode === 'printing' ? 'printing' : mode === 'pause_locked' ? 'pause_locked' : mode === 'error' ? 'error' : 'idle',
      tool: 1,
      gate: 1,
      filament: 'Loaded',
      action: mode === 'busy' ? 'Loading' : 'Idle',
      operation: '',
      reason_for_pause: mode === 'pause_locked' ? 'Filament encoder not detected' : '',
      gate_status: [-1, 1, 0, 2],
      gate_filament_name: ['PolyTerra Black', 'Galaxy Orange', '', ''],
      gate_material: ['PLA', 'ASA', 'PETG', ''],
      gate_color: ['', '', 'blue', ''],
      gate_color_rgb: [[0.11, 0.11, 0.11], [1, 0.416, 0], null, null],
      gate_spool_id: [1, 2, -1, -1],
      ttg_map: [0, 1, 2, 3],
      has_bypass: true,
      active_filament: { filament_name: 'Galaxy Orange', material: 'ASA', color: 'ff6a00' },
    },
    mmu_machine: {
      happy_hare_version: '4.0.0',
      num_units: 1,
      num_gates: 4,
      unit_0: { name: 'ERCF', display_name: 'ERCF', num_gates: 4, first_gate: 0, has_bypass: true },
    },
  };
}

function afcStatus(mode: Exclude<AfcMode, 'off'>): Status {
  const lanes = [
    { name: 'lane1', map: 'T0', material: 'PLA', color: '#1c1c1c', weight: 812, filament_status: 'Ready', lane: 0, unit: 'BoxTurtle' },
    { name: 'lane2', map: 'T1', material: 'ASA', color: '#ff6a00', weight: 420.4, filament_status: 'In Tool', lane: 1, unit: 'BoxTurtle', tool_loaded: true, load: true },
    { name: 'lane3', map: 'T2', material: 'PETG', color: 'blue', weight: 0, filament_status: 'Not Ready', lane: 2, unit: 'BoxTurtle' },
    { name: 'lane4', map: '', material: '', color: '', filament_status: '', lane: 3, unit: 'BoxTurtle' },
  ];
  const status: Status = {
    AFC: {
      current_load: mode === 'busy' ? '' : 'lane2',
      current_lane: 'lane2',
      current_state: mode === 'busy' ? 'Loading' : 'Idle',
      error_state: mode === 'error',
      bypass_state: false,
      message: mode === 'error' ? { message: 'Lane sensor did not trigger', type: 'error' } : '',
      lanes: lanes.map((lane) => lane.name),
      units: ['BoxTurtle'],
      hubs: ['hub'],
      buffers: [],
      extruders: ['extruder'],
    },
  };
  for (const lane of lanes) status[`AFC_stepper ${lane.name}`] = { ...lane };
  return status;
}

interface MockSpool {
  id: number;
  name: string;
  material: string;
  vendor: string;
  color: string;
  remaining: number | null;
  length: number | null;
  used: number | null;
  total: number | null;
  archived?: boolean;
}

class RpcFailure extends Error {}

export interface MockOptions {
  scenario?: Scenario;
  homed?: boolean;
  files?: MockFile[];
  /** Status overrides applied after the scenario. */
  status?: Status;
  /** Pre-filled `server.gcode_store`. */
  gcodeStore?: Array<{ message: string; time: number; type: 'command' | 'response' }>;
  /** Moonraker Spoolman component. Absent printers omit it from `server.info.components`. */
  spoolman?: SpoolmanMode;
  /** Macro names that should be rejected by Klipper. */
  failMacros?: string[];
  /** AFC Klipper objects. Off printers omit them, so the AFC screen stays out of the nav. */
  afc?: AfcMode;
  /** Happy Hare `mmu` object. Off printers omit it. */
  mmu?: MmuMode;
}

export class MockMoonraker {
  readonly calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  readonly thumbnailRequests: string[] = [];
  status: Status;
  klippy: string;
  files: MockFile[];
  gcodeStore: Array<{ message: string; time: number; type: string }>;
  /** When false, new WebSocket connections are closed immediately. */
  online = true;
  spoolman: SpoolmanMode;
  afc: AfcMode;
  mmu: MmuMode;
  activeSpoolId: number | null = 2;
  readonly failMacros: Set<string>;
  #ws: WebSocketRoute | null = null;
  #relative = false;
  #saved: Record<string, boolean> = {};

  constructor(options: MockOptions = {}) {
    const scenario = options.scenario ?? 'ready';
    this.afc = options.afc ?? 'off';
    this.mmu = options.mmu ?? 'off';
    this.status = baseStatus(scenario, options.homed ?? false);
    if (this.afc !== 'off') Object.assign(this.status, afcStatus(this.afc));
    if (this.mmu !== 'off') Object.assign(this.status, mmuStatus(this.mmu));
    for (const [name, fields] of Object.entries(options.status ?? {})) this.status[name] = { ...this.status[name], ...fields };
    this.klippy = scenario === 'shutdown' ? 'shutdown' : scenario === 'startup' ? 'startup' : 'ready';
    this.files = options.files ?? defaultFiles();
    this.gcodeStore = options.gcodeStore ?? [
      { message: 'G28', time: T - 400, type: 'command' },
      { message: '// Klipper state: Ready', time: T - 390, type: 'response' },
    ];
    this.spoolman = options.spoolman ?? 'absent';
    this.failMacros = new Set(options.failMacros ?? []);
  }

  /** Control (printer-changing) calls in order. */
  get controlCalls() {
    return this.calls.filter((c) => CONTROL.has(c.method));
  }

  get scripts(): string[] {
    return this.calls.filter((c) => c.method === 'printer.gcode.script').map((c) => String(c.params?.script));
  }

  async install(page: Page): Promise<void> {
    await page.routeWebSocket(/:7125\/websocket/, (ws) => {
      if (!this.online) {
        void ws.close();
        return;
      }
      this.#ws = ws;
      ws.onMessage((raw) => void this.#handle(ws, String(raw)));
    });
    await page.route(/:7125\/server\/files\/gcodes\//, async (route) => {
      const url = new URL(route.request().url());
      this.thumbnailRequests.push(url.pathname);
      const path = decodeURIComponent(url.pathname.replace('/server/files/gcodes/', ''));
      const known = this.files.some((f) => {
        const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';
        const t = (f.meta?.thumbnails as Array<{ relative_path: string }> | undefined) ?? [];
        return t.some((x) => `${dir}${x.relative_path}` === path);
      });
      if (!known) return route.fulfill({ status: 404, body: 'Not found' });
      const hue: [number, number, number] = path.includes('PETG') ? [62, 224, 240] : path.includes('first') ? [251, 191, 36] : [139, 108, 255];
      return route.fulfill({ status: 200, contentType: 'image/png', body: partThumbnail(path.includes('32x32') ? 32 : 160, hue) });
    });
  }

  /** Drops the current connection, as if Moonraker or the network went away. */
  async disconnect(): Promise<void> {
    this.online = false;
    await this.#ws?.close();
    this.#ws = null;
  }

  notify(method: string, params: unknown[]): void {
    this.#ws?.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  /** Applies a status change and pushes it as `notify_status_update`. */
  update(diff: Status): void {
    for (const [name, fields] of Object.entries(diff)) this.status[name] = { ...this.status[name], ...fields };
    this.notify('notify_status_update', [diff, 1]);
  }

  #respond(message: string): void {
    this.gcodeStore.push({ message, time: Date.now() / 1000, type: 'response' });
    this.notify('notify_gcode_response', [message]);
  }

  async #handle(ws: WebSocketRoute, raw: string): Promise<void> {
    const msg = JSON.parse(raw) as { id: number; method: string; params?: Record<string, unknown> };
    this.calls.push({ method: msg.method, params: msg.params });
    const reply = (result: unknown) => ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    const error = (message: string, code = 400) => ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code, message } }));
    try {
      const result = await this.#dispatch(msg.method, msg.params ?? {});
      reply(result);
    } catch (e) {
      error(e instanceof Error ? e.message : String(e), e instanceof RpcFailure ? 400 : 500);
    }
  }

  #objects(): string[] {
    return [...Object.keys(this.status), 'configfile', 'pause_resume', ...Object.keys(MACROS).map((m) => `gcode_macro ${m}`)];
  }

  async #dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'server.connection.identify':
        return { connection_id: 101 };
      case 'server.info':
        return {
          klippy_connected: true,
          klippy_state: this.klippy,
          moonraker_version: 'v0.9.3',
          components: this.spoolman === 'absent' ? ['klippy_connection', 'file_manager'] : ['klippy_connection', 'file_manager', 'spoolman'],
        };
      case 'server.spoolman.status':
        if (this.spoolman === 'error') throw new RpcFailure('Spoolman database is locked');
        return { spoolman_connected: this.spoolman === 'ready', pending_reports: [], spool_id: this.activeSpoolId };
      case 'server.spoolman.get_spool_id':
        return { spool_id: this.activeSpoolId };
      case 'server.spoolman.post_spool_id': {
        const id = params.spool_id;
        this.activeSpoolId = typeof id === 'number' ? id : null;
        setTimeout(() => this.notify('notify_active_spool_set', [{ spool_id: this.activeSpoolId }]), 10);
        return { spool_id: this.activeSpoolId };
      }
      case 'server.spoolman.proxy':
        if (params.request_method !== 'GET' || params.path !== '/v1/spool') throw new RpcFailure('Spoolman proxy request is not allowed');
        return { response: mockSpoolPayload() };
      case 'printer.info':
        return {
          state: this.klippy,
          state_message: this.klippy === 'shutdown' ? 'MCU \'mcu\' shutdown: Timer too close\nOnce the underlying issue is corrected, use the "FIRMWARE_RESTART" command to reset the firmware.' : 'Printer is ready',
          hostname: 'trident',
        };
      case 'printer.objects.list':
        return { objects: this.#objects() };
      case 'printer.objects.subscribe': {
        const requested = Object.keys((params.objects as Record<string, unknown>) ?? {});
        const status: Status = {};
        for (const name of requested) if (this.status[name]) status[name] = structuredClone(this.status[name]);
        return { eventtime: 1, status };
      }
      case 'printer.objects.query':
        return { eventtime: 1, status: { configfile: { settings: settings() } } };
      case 'server.gcode_store':
        return { gcode_store: this.gcodeStore };
      case 'server.files.get_directory':
        return this.#directory(String(params.path ?? 'gcodes'));
      case 'server.files.metadata': {
        const file = this.files.find((f) => f.path === params.filename);
        if (!file?.meta) throw new RpcFailure(`Metadata not available for <${String(params.filename)}>`);
        return { filename: file.path, size: file.size, modified: file.modified, ...file.meta };
      }
      case 'server.files.delete_file': {
        const path = String(params.path).replace(/^gcodes\//, '');
        this.files = this.files.filter((f) => f.path !== path);
        setTimeout(() => this.notify('notify_filelist_changed', [{ action: 'delete_file', item: { root: 'gcodes', path } }]), 20);
        return { item: { path, root: 'gcodes' }, action: 'delete_file' };
      }
      case 'printer.print.start': {
        const filename = String(params.filename);
        this.update({
          print_stats: { filename, state: 'printing', print_duration: 0, total_duration: 1, info: { current_layer: 0, total_layer: 180 } },
          virtual_sdcard: { progress: 0, is_active: true },
          display_status: { progress: 0 },
        });
        return 'ok';
      }
      case 'printer.print.pause':
        this.update({ print_stats: { state: 'paused' } });
        return 'ok';
      case 'printer.print.resume':
        this.update({ print_stats: { state: 'printing' } });
        return 'ok';
      case 'printer.print.cancel':
        this.update({ print_stats: { state: 'cancelled' } });
        return 'ok';
      case 'printer.emergency_stop':
        this.klippy = 'shutdown';
        this.update({ webhooks: { state: 'shutdown', state_message: 'Shutdown due to M112 command' } });
        this.notify('notify_klippy_shutdown', []);
        return 'ok';
      case 'printer.firmware_restart':
      case 'printer.restart':
        // Klipper drops the job, turns heaters off and forgets homing. The ready notification follows
        // the same path Moonraker uses after a real firmware restart.
        this.status = baseStatus('ready', false);
        this.klippy = 'ready';
        setTimeout(() => this.notify('notify_klippy_ready', []), 50);
        return 'ok';
      case 'printer.gcode.script':
        return this.#script(String(params.script));
      case 'printer.gcode.help':
        return this.#gcodeHelp();
      default:
        throw new Error(`Method not found: ${method}`);
    }
  }

  #directory(path: string) {
    const dir = path.replace(/^gcodes\/?/, '');
    const prefix = dir ? `${dir}/` : '';
    const dirs = new Set<string>();
    const files: Array<Record<string, unknown>> = [];
    for (const f of this.files) {
      if (!f.path.startsWith(prefix)) continue;
      const rest = f.path.slice(prefix.length);
      if (rest.includes('/')) dirs.add(rest.split('/')[0]!);
      else files.push({ filename: rest, modified: f.modified, size: f.size, permissions: 'rw', ...(f.meta ?? {}) });
    }
    dirs.add('.thumbs');
    return {
      dirs: [...dirs].map((dirname) => ({ dirname, modified: T, size: 4096, permissions: 'rw' })),
      files,
      disk_usage: { total: 30e9, used: 8e9, free: 22e9 },
      root_info: { name: 'gcodes', permissions: 'rw' },
    };
  }

  #gcodeHelp(): Record<string, string> {
    const help: Record<string, string> = {};
    for (const [name, macro] of Object.entries(MACROS)) help[name] = macro.description ?? '';
    if (this.afc === 'ready' || this.afc === 'error' || this.afc === 'busy') {
      help.CHANGE_TOOL = 'Switch to another lane';
      help.TOOL_LOAD = 'Load a lane';
      help.TOOL_UNLOAD = 'Unload the toolhead';
      help.AFC_CLEAR_MESSAGE = 'Clear the AFC message';
    } else if (this.afc === 'unsupported') {
      help.AFC_CLEAR_MESSAGE = 'Clear the AFC message';
    }
    if (this.mmu === 'ready' || this.mmu === 'printing' || this.mmu === 'pause_locked' || this.mmu === 'error' || this.mmu === 'busy') {
      help.MMU_HOME = 'Home the selector';
      help.MMU_SELECT = 'Select a gate';
      help.MMU_SELECT_BYPASS = 'Select the bypass';
      help.MMU_CHANGE_TOOL = 'Change tool';
      help.MMU_LOAD = 'Load filament';
      help.MMU_UNLOAD = 'Unload filament';
      help.MMU_EJECT = 'Eject filament';
      help.MMU_PRELOAD = 'Preload the gate';
      help.MMU_CHECK_GATE = 'Check the gate';
      help.MMU_RECOVER = 'Recover MMU state';
      help.MMU_UNLOCK = 'Unlock after a pause';
    } else if (this.mmu === 'legacy') {
      help.MMU_HOME = 'Home the selector';
      help.MMU_SELECT_TOOL = 'Select a tool';
      help.MMU_LOAD_TOOL = 'Load filament';
      help.MMU_UNLOAD_TOOL = 'Unload filament';
      help.MMU_EJECT_TOOL = 'Eject filament';
    }
    return help;
  }

  #fail(message: string): never {
    this.#respond(`!! ${message}`);
    throw new RpcFailure(message);
  }

  async #script(script: string): Promise<string> {
    if (this.klippy !== 'ready' && !/^(FIRMWARE_RESTART|RESTART|STATUS)/i.test(script)) this.#fail('Printer is not ready');
    const toolhead = this.status.toolhead!;
    for (const raw of script.split('\n')) {
      const line = raw.trim();
      const [cmd = '', ...args] = line.split(/\s+/);
      const word = cmd.toUpperCase();
      const arg = (key: string) => {
        const found = args.find((a) => a.toUpperCase().startsWith(`${key}=`) || (a.length > 1 && a[0]!.toUpperCase() === key && !a.includes('=')));
        if (!found) return null;
        return found.includes('=') ? found.slice(found.indexOf('=') + 1) : found.slice(1);
      };
      switch (word) {
        case 'SAVE_GCODE_STATE':
          this.#saved[arg('NAME') ?? 'default'] = this.#relative;
          break;
        case 'RESTORE_GCODE_STATE':
          this.#relative = this.#saved[arg('NAME') ?? 'default'] ?? false;
          break;
        case 'G90':
          this.#relative = false;
          break;
        case 'G91':
          this.#relative = true;
          break;
        case 'M82':
        case 'M83':
          break;
        case 'G28': {
          const axes = args.map((a) => a.toLowerCase()).filter((a) => 'xyz'.includes(a));
          const target = axes.length ? axes : ['x', 'y', 'z'];
          const homed = String(toolhead.homed_axes);
          if (target.length === 1 && target[0] === 'z' && !(homed.includes('x') && homed.includes('y'))) {
            this.#fail('Must home X and Y axes first');
          }
          await new Promise((r) => setTimeout(r, 150));
          const pos = [...(toolhead.position as number[])];
          for (const a of target) pos['xyz'.indexOf(a)] = a === 'z' ? 10 : AXIS_MAX['xyz'.indexOf(a)]!;
          const next = [...new Set([...homed, ...target])].filter((a) => 'xyz'.includes(a)).sort().join('');
          this.update({ toolhead: { homed_axes: next, position: pos } });
          break;
        }
        case 'G1':
        case 'G0': {
          const pos = [...(toolhead.position as number[])];
          const homed = String(toolhead.homed_axes);
          for (const [i, axis] of ['X', 'Y', 'Z'].entries()) {
            const v = arg(axis);
            if (v === null) continue;
            if (!homed.includes(axis.toLowerCase())) this.#fail(`Must home axis first: ${pos.slice(0, 3).map((p) => p.toFixed(3)).join(' ')} [${pos[3]!.toFixed(3)}]`);
            const next = this.#relative ? pos[i]! + Number(v) : Number(v);
            if (next < AXIS_MIN[i]! || next > AXIS_MAX[i]!) this.#fail(`Move out of range: ${next.toFixed(3)}`);
            pos[i] = Math.round(next * 1000) / 1000;
          }
          const e = arg('E');
          if (e !== null) {
            const temp = Number(this.status.extruder!.temperature);
            if (temp < 170) this.#fail('Extrude below minimum temp\nSee the \'min_extrude_temp\' config option for details');
            pos[3] = pos[3]! + Number(e);
          }
          this.update({ toolhead: { position: pos } });
          break;
        }
        case 'SET_HEATER_TEMPERATURE': {
          const heater = arg('HEATER')!;
          const object = heater === 'extruder' || heater === 'heater_bed' ? heater : `heater_generic ${heater}`;
          this.update({ [object]: { target: Number(arg('TARGET')) } });
          break;
        }
        case 'M106':
          this.update({ fan: { speed: Number(arg('S') ?? 255) / 255 } });
          break;
        case 'M107':
          this.update({ fan: { speed: 0 } });
          break;
        case 'SET_FAN_SPEED':
          this.update({ [`fan_generic ${arg('FAN')}`]: { speed: Number(arg('SPEED')) } });
          break;
        case 'SET_PIN':
          this.update({ [`output_pin ${arg('PIN')}`]: { value: Number(arg('VALUE')) } });
          break;
        case 'SET_LED': {
          const v = Number(arg('WHITE') ?? arg('RED') ?? 0);
          this.update({ [`neopixel ${arg('LED')}`]: { color_data: [[v, v, v, v], [v, v, v, v], [v, v, v, v]] } });
          break;
        }
        case 'M220':
          this.update({ gcode_move: { speed_factor: Number(arg('S')) / 100 } });
          break;
        case 'M221':
          this.update({ gcode_move: { extrude_factor: Number(arg('S')) / 100 } });
          break;
        case 'SET_GCODE_OFFSET': {
          const origin = [...(this.status.gcode_move!.homing_origin as number[])];
          origin[2] = Math.round((origin[2]! + Number(arg('Z_ADJUST') ?? 0)) * 1000) / 1000;
          this.update({ gcode_move: { homing_origin: origin } });
          break;
        }
        case 'M84':
          this.update({ toolhead: { homed_axes: '' } });
          break;
        case 'STATUS':
          this.#respond('// Klipper state: Ready');
          break;
        case 'CHANGE_TOOL':
        case 'TOOL_LOAD': {
          const lane = arg('LANE');
          if (lane && this.status.AFC) {
            this.update({
              AFC: { current_load: lane, current_state: 'Idle' },
              [`AFC_stepper ${lane}`]: { filament_status: 'In Tool', tool_loaded: true, load: true },
            });
          }
          this.#respond(`// ${word} done`);
          break;
        }
        case 'TOOL_UNLOAD':
          if (this.status.AFC) this.update({ AFC: { current_load: '', current_state: 'Idle' } });
          this.#respond(`// ${word} done`);
          break;
        case 'AFC_CLEAR_MESSAGE':
          if (this.status.AFC) this.update({ AFC: { message: '', error_state: false } });
          this.#respond('// AFC message cleared');
          break;
        case 'MMU_HOME':
        case 'MMU_LOAD':
        case 'MMU_LOAD_TOOL':
        case 'MMU_UNLOAD':
        case 'MMU_UNLOAD_TOOL':
        case 'MMU_EJECT':
        case 'MMU_EJECT_TOOL':
        case 'MMU_PRELOAD':
        case 'MMU_CHECK_GATE':
        case 'MMU_RECOVER':
        case 'MMU_UNLOCK':
        case 'MMU_SELECT':
        case 'MMU_SELECT_TOOL':
        case 'MMU_SELECT_BYPASS':
        case 'MMU_CHANGE_TOOL': {
          if (this.status.mmu) {
            const tool = arg('TOOL');
            const gate = arg('GATE');
            const bypass = word === 'MMU_SELECT_BYPASS' || arg('BYPASS') === '1';
            const next: Record<string, unknown> = { action: 'Idle' };
            if (bypass) next.tool = -2;
            else if (tool !== null && Number.isInteger(Number(tool))) next.tool = Number(tool);
            if (gate !== null && Number.isInteger(Number(gate))) next.gate = Number(gate);
            else if (typeof next.tool === 'number' && next.tool >= 0) next.gate = next.tool;
            this.update({ mmu: next });
          }
          this.#respond(`// ${word} done`);
          break;
        }
        default:
          if (word in MACROS) {
            if (this.failMacros.has(word)) this.#fail(`${word} failed`);
            if (word.includes('FILAMENT')) await new Promise((r) => setTimeout(r, 250));
            this.#respond(`// ${word} done`);
            break;
          }
          this.#fail(`Unknown command:"${word}"`);
      }
    }
    return 'ok';
  }
}
