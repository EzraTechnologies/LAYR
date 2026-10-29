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

class RpcFailure extends Error {
  readonly code: number;
  constructor(message: string, code = 400) {
    super(message);
    this.code = code;
  }
}

export type SpoolmanMode = 'absent' | 'ready' | 'offline' | 'unauthorized';

export interface MockSpool {
  id: number;
  name: string;
  material: string | null;
  vendor: string | null;
  /** Hex without `#`. Null when the fixture omits a colour. */
  color: string | null;
  remainingWeight: number | null;
  /** Millimetres. Null when the fixture omits a length. */
  remainingLength: number | null;
  archived?: boolean;
}

/** Fixture spools. Not shipped in the app. */
export function sampleSpools(): MockSpool[] {
  return [
    { id: 7, name: 'Galaxy Black', material: 'ASA', vendor: 'Polymaker', color: '1c1c1c', remainingWeight: 842.4, remainingLength: 311_200 },
    { id: 8, name: 'Arctic White', material: 'PETG', vendor: 'Prusament', color: 'f4f4f4', remainingWeight: 210, remainingLength: 78_000 },
    { id: 3, name: 'Clearance Red', material: 'PLA', vendor: null, color: 'd7263d', remainingWeight: null, remainingLength: null },
  ];
}

function toSpoolman(spool: MockSpool): Record<string, unknown> {
  const filament: Record<string, unknown> = { name: spool.name };
  if (spool.material) filament.material = spool.material;
  if (spool.color) filament.color_hex = spool.color;
  if (spool.vendor) filament.vendor = { name: spool.vendor };
  const body: Record<string, unknown> = { id: spool.id, archived: spool.archived === true, filament };
  if (spool.remainingWeight != null) body.remaining_weight = spool.remainingWeight;
  if (spool.remainingLength != null) body.remaining_length = spool.remainingLength;
  return body;
}

export interface MockOptions {
  scenario?: Scenario;
  homed?: boolean;
  files?: MockFile[];
  /** Directory paths relative to gcodes that exist even with no files inside them. */
  emptyDirs?: string[];
  /** Status overrides applied after the scenario. */
  status?: Status;
  /** Pre-filled `server.gcode_store`. */
  gcodeStore?: Array<{ message: string; time: number; type: 'command' | 'response' }>;
  /** `absent` omits the Spoolman component. Other modes add it to `server.info`. */
  spoolman?: SpoolmanMode;
  spools?: MockSpool[];
  /** `null` is an explicit empty active spool. Omitted means spool 7 when Spoolman is ready. */
  activeSpoolId?: number | null;
  /** Omit `components` so LAYR probes `server.spoolman.status` instead. */
  omitComponents?: boolean;
  failedComponents?: string[];
  /** Macro names that Klipper rejects. */
  failScripts?: string[];
}

export class MockMoonraker {
  readonly calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  readonly thumbnailRequests: string[] = [];
  status: Status;
  klippy: string;
  files: MockFile[];
  emptyDirs: string[];
  gcodeStore: Array<{ message: string; time: number; type: string }>;
  /** When false, new WebSocket connections are closed immediately. */
  online = true;
  spoolmanMode: SpoolmanMode;
  spools: MockSpool[];
  activeSpoolId: number | null;
  omitComponents: boolean;
  failedComponents: string[];
  failScripts: string[];
  #ws: WebSocketRoute | null = null;
  #relative = false;
  #saved: Record<string, boolean> = {};

  constructor(options: MockOptions = {}) {
    const scenario = options.scenario ?? 'ready';
    this.status = baseStatus(scenario, options.homed ?? false);
    for (const [name, fields] of Object.entries(options.status ?? {})) this.status[name] = { ...this.status[name], ...fields };
    this.klippy = scenario === 'shutdown' ? 'shutdown' : scenario === 'startup' ? 'startup' : 'ready';
    this.files = options.files ?? defaultFiles();
    this.emptyDirs = options.emptyDirs ?? [];
    this.gcodeStore = options.gcodeStore ?? [
      { message: 'G28', time: T - 400, type: 'command' },
      { message: '// Klipper state: Ready', time: T - 390, type: 'response' },
    ];
    this.spoolmanMode = options.spoolman ?? 'absent';
    this.spools = options.spools ?? sampleSpools();
    this.activeSpoolId = options.activeSpoolId === undefined ? (this.spoolmanMode === 'ready' ? 7 : null) : options.activeSpoolId;
    this.omitComponents = options.omitComponents ?? false;
    this.failedComponents = options.failedComponents ?? [];
    this.failScripts = options.failScripts ?? [];
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
      error(e instanceof Error ? e.message : String(e), e instanceof RpcFailure ? e.code : 500);
    }
  }

  #objects(): string[] {
    return [...Object.keys(this.status), 'configfile', 'pause_resume', ...Object.keys(MACROS).map((m) => `gcode_macro ${m}`)];
  }

  async #dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'server.connection.identify':
        return { connection_id: 101 };
      case 'server.info': {
        const body: Record<string, unknown> = { klippy_connected: true, klippy_state: this.klippy, moonraker_version: 'v0.9.3' };
        if (!this.omitComponents) {
          const components = ['database', 'file_manager', 'klippy_apis', 'machine', 'data_store'];
          if (this.spoolmanMode !== 'absent' && !this.failedComponents.includes('spoolman')) components.push('spoolman');
          body.components = components;
          body.failed_components = this.failedComponents;
        }
        return body;
      }
      case 'server.spoolman.status':
        if (this.spoolmanMode === 'absent') throw new RpcFailure('Method not found', -32601);
        if (this.spoolmanMode === 'unauthorized') throw new RpcFailure('Unauthorized', 401);
        return {
          spoolman_connected: this.spoolmanMode === 'ready',
          pending_reports: [],
          spool_id: this.spoolmanMode === 'ready' ? this.activeSpoolId : null,
        };
      case 'server.spoolman.get_spool_id':
        if (this.spoolmanMode === 'unauthorized') throw new RpcFailure('Unauthorized', 401);
        if (this.spoolmanMode !== 'ready') throw new RpcFailure('Spoolman server not available', 503);
        return { spool_id: this.activeSpoolId };
      case 'server.spoolman.post_spool_id': {
        if (this.spoolmanMode === 'unauthorized') throw new RpcFailure('Unauthorized', 401);
        if (this.spoolmanMode !== 'ready') throw new RpcFailure('Spoolman server not available', 503);
        const id = params.spool_id;
        this.activeSpoolId = typeof id === 'number' ? id : null;
        const spoolId = this.activeSpoolId;
        setTimeout(() => this.notify('notify_active_spool_set', [{ spool_id: spoolId }]), 20);
        return { spool_id: spoolId };
      }
      case 'server.spoolman.proxy':
        return this.#spoolProxy(params);
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
    for (const empty of this.emptyDirs) {
      const normalized = empty.replace(/^\/+|\/+$/g, '');
      if (!normalized || normalized.split('/').some((part) => part === '' || part === '.' || part === '..' || part.startsWith('.'))) continue;
      if (normalized === dir) continue;
      if (!normalized.startsWith(prefix)) continue;
      const name = normalized.slice(prefix.length).split('/')[0];
      if (name) dirs.add(name);
    }
    dirs.add('.thumbs');
    return {
      dirs: [...dirs].map((dirname) => ({ dirname, modified: T, size: 4096, permissions: 'rw' })),
      files,
      disk_usage: { total: 30e9, used: 8e9, free: 22e9 },
      root_info: { name: 'gcodes', permissions: 'rw' },
    };
  }

  #spoolProxy(params: Record<string, unknown>): Record<string, unknown> {
    if (this.spoolmanMode === 'unauthorized') throw new RpcFailure('Unauthorized', 401);
    if (this.spoolmanMode !== 'ready') throw new RpcFailure('Spoolman server not available', 503);
    const path = String(params.path ?? '');
    const query = typeof params.query === 'string' ? params.query : '';
    if (path === '/v1/spool') {
      const search = new URLSearchParams(query);
      const offset = Number(search.get('offset') ?? '0');
      const limit = Number(search.get('limit') ?? '100');
      return { response: this.spools.slice(offset, offset + limit).map(toSpoolman), response_headers: {} };
    }
    const detail = /^\/v1\/spool\/(\d+)$/.exec(path);
    if (!detail) throw new RpcFailure('Not found', 404);
    const found = this.spools.find((spool) => spool.id === Number(detail[1]));
    if (!found) throw new RpcFailure('Not found', 404);
    return { response: toSpoolman(found), response_headers: {} };
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
        default:
          if (word in MACROS) {
            if (this.failScripts.includes(word)) this.#fail(`${word} failed`);
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
