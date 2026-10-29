import type { JobState, MmuGate, MmuGateStatus, MmuState } from '../printer/model';

/**
 * Happy Hare commands this screen can send, and only after `printer.gcode.help` lists them.
 * Parameters match the documented forms: no QUIET, SKIP_TIP, or forced LOADED overrides.
 * https://moggieuk.github.io/Happy-Hare-Doc/Reference-Commands/
 */
export const MMU_LOAD = 'MMU_LOAD';
export const MMU_UNLOAD = 'MMU_UNLOAD';
export const MMU_CHANGE_TOOL = 'MMU_CHANGE_TOOL';
export const MMU_RECOVER = 'MMU_RECOVER';

export const SUPPORTED_MMU_COMMANDS = [MMU_LOAD, MMU_UNLOAD, MMU_CHANGE_TOOL, MMU_RECOVER] as const;

export type SupportedMmuCommand = (typeof SUPPORTED_MMU_COMMANDS)[number];

export type MmuMove =
  | { action: 'load' }
  | { action: 'unload' }
  | { action: 'recover' }
  | { action: 'change_tool'; tool: number };

/** On-screen cap. The selected gate is kept visible when it falls past this window. */
export const MAX_MMU_GATES = 16;

/**
 * Happy Hare `FILAMENT_POS_*` names. Indexes match `mmu_constants.py`.
 * Anything outside this range is not given a name.
 */
const FILAMENT_POS_NAMES: Record<number, string> = {
  [-1]: 'Unknown',
  0: 'Unloaded and parked',
  1: 'Homed at gate',
  2: 'Start of bowden',
  3: 'In bowden',
  4: 'End of bowden',
  5: 'Homed at extruder sensor',
  6: 'At extruder gear',
  7: 'Past extruder gear',
  8: 'Homed at toolhead sensor',
  9: 'In extruder',
  10: 'Loaded in nozzle',
};

/** `action` strings from `_get_action_string` that mean a move is already running. */
const BUSY_ACTIONS = new Set([
  'Loading',
  'Unloading',
  'Loading Ext',
  'Exiting Ext',
  'Forming Tip',
  'Cutting Tip',
  'Heating',
  'Checking',
  'Homing',
  'Selecting',
  'Cutting Filament',
  'Purging',
  'Preload',
]);

const PRINTING_MMU_STATES = new Set(['printing', 'started']);

export interface MmuMovePlan {
  script: string;
  summary: string;
  title: string;
  body: string;
  confirmLabel: string;
  tone: 'primary' | 'warn';
}

export type MmuMoveResult = { ok: true; plan: MmuMovePlan } | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function asInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function asBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asList(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function at(list: unknown[] | null, index: number): unknown {
  if (!list || index < 0 || index >= list.length) return undefined;
  return list[index];
}

/** Commands from `printer.gcode.help`. Null when the payload is not a map. */
export function mmuCommandsFromHelp(help: unknown): string[] | null {
  if (!isRecord(help)) return null;
  return SUPPORTED_MMU_COMMANDS.filter((name) => Object.prototype.hasOwnProperty.call(help, name));
}

function filamentWord(value: unknown): MmuState['filament'] {
  const text = cleanText(value, 32);
  if (!text) return null;
  const key = text.toLowerCase();
  if (key === 'loaded') return 'Loaded';
  if (key === 'unloaded') return 'Unloaded';
  if (key === 'unknown') return 'Unknown';
  return null;
}

/** State-machine code. A fractional `filament_position` is a distance, not a code. */
function filamentPosCode(raw: Record<string, unknown>): number | null {
  const current = asInt(raw.filament_pos);
  if (current !== null && current >= -1 && current <= 10) return current;
  const legacy = asInt(raw.filament_position);
  if (legacy !== null && legacy >= -1 && legacy <= 10) return legacy;
  return null;
}

/**
 * Current Happy Hare sets the coarse word from the position code:
 * loaded at the nozzle, unloaded when parked, otherwise unknown.
 */
function filamentDisagrees(filament: MmuState['filament'], code: number | null): boolean {
  if (filament === null || code === null) return false;
  if (filament === 'Loaded') return code !== 10;
  if (filament === 'Unloaded') return code !== 0;
  return code === 0 || code === 10;
}

function cssChannel(value: number, scale: number): string {
  const byte = Math.round(Math.min(255, Math.max(0, value * scale)));
  return byte.toString(16).padStart(2, '0');
}

/** `#rrggbb` from a Happy Hare RGB tuple (0–1 fractions, or 0–255). */
function cssFromRgb(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const channels = value.slice(0, 3);
  if (!channels.every((n): n is number => typeof n === 'number' && Number.isFinite(n))) return null;
  const [r, g, b] = channels;
  if (r === undefined || g === undefined || b === undefined) return null;
  const fractional = r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1;
  const bytes = r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255;
  if (!fractional && !bytes) return null;
  const scale = fractional ? 255 : 1;
  return `#${cssChannel(r, scale)}${cssChannel(g, scale)}${cssChannel(b, scale)}`;
}

function gateColor(color: unknown, rgb: unknown): { css: string | null; name: string | null } {
  const name = cleanText(color, 32);
  if (!name) return { css: null, name: null };
  const hex = /^#?[0-9a-fA-F]{6}$/.test(name) ? `#${name.replace(/^#/, '').toLowerCase()}` : null;
  if (hex) return { css: hex, name };
  const fromRgb = cssFromRgb(rgb);
  if (!fromRgb) return { css: null, name };
  // An empty color is stored as black. A real black only counts when the name says so, or the tuple is not black.
  if (fromRgb === '#000000' && !/black/i.test(name)) return { css: null, name };
  return { css: fromRgb, name };
}

function gateStatus(value: unknown): { status: MmuGateStatus | null; code: number | null } {
  if (value === undefined || value === null) return { status: null, code: null };
  const code = asInt(value);
  if (code === null) return { status: 'unrecognized', code: null };
  if (code === -1) return { status: 'unknown', code: null };
  if (code === 0) return { status: 'empty', code: null };
  if (code === 1) return { status: 'available', code: null };
  if (code === 2) return { status: 'buffer', code: null };
  return { status: 'unrecognized', code };
}

function positive(value: unknown, max: number): number | null {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : null;
  if (n === null || n <= 0 || n > max) return null;
  return n;
}

function toolIndex(value: unknown): number | null {
  const n = asInt(value);
  if (n === null) return null;
  if (n >= -2) return n;
  return null;
}

function gateCount(raw: Record<string, unknown>, status: unknown[] | null, ttg: unknown[] | null): number | null {
  const reported = asInt(raw.num_gates);
  if (reported !== null && reported >= 0 && reported <= 64) return reported;
  if (status && status.length > 0 && status.length <= 64) return status.length;
  if (ttg && ttg.length > 0 && ttg.length <= 64) return ttg.length;
  return null;
}

function activeFilament(value: unknown): {
  name: string | null;
  material: string | null;
  color: string | null;
  colorName: string | null;
  temperature: number | null;
  spoolId: number | null;
} | null {
  if (!isRecord(value)) return null;
  const color = gateColor(value.color, value.color_rgb);
  const spool = asInt(value.spool_id);
  return {
    name: cleanText(value.filament_name, 80),
    material: cleanText(value.material, 32),
    color: color.css,
    colorName: color.name,
    temperature: positive(value.temperature, 500),
    spoolId: spool !== null && spool > 0 ? spool : null,
  };
}

/** Builds the UI model from one `mmu` status object. Missing fields stay null. */
export function parseMmu(raw: unknown, commands: readonly string[] | null): MmuState {
  const source = isRecord(raw) ? raw : {};
  const statusSeen = Object.keys(source).length > 0;
  const statusList = asList(source.gate_status);
  const names = asList(source.gate_filament_name);
  const materials = asList(source.gate_material);
  const colors = asList(source.gate_color);
  const colorRgb = asList(source.gate_color_rgb);
  const temps = asList(source.gate_temperature);
  const spools = asList(source.gate_spool_id);
  const ttgRaw = asList(source.ttg_map);
  const ttg = ttgRaw ? ttgRaw.map((entry) => asInt(entry)) : [];
  const count = gateCount(source, statusList, ttgRaw);
  const filamentPos = filamentPosCode(source);
  const filament = filamentWord(source.filament);
  const filamentRaw = filament ? null : cleanText(source.filament, 80);
  const active = activeFilament(source.active_filament);
  const selectedGate = toolIndex(source.gate);

  const supported = commands ? SUPPORTED_MMU_COMMANDS.filter((name) => commands.includes(name)) : null;

  const gates: MmuGate[] = [];
  let hiddenGates = 0;
  if (count !== null && count > 0) {
    const shown = Math.min(count, MAX_MMU_GATES);
    const indexes = Array.from({ length: shown }, (_, index) => index);
    if (selectedGate !== null && selectedGate >= shown && selectedGate < count) indexes[shown - 1] = selectedGate;
    hiddenGates = count - shown;
    for (const index of indexes) {
      const fromArrays = names !== null || materials !== null || colors !== null;
      const useActive = !fromArrays && selectedGate === index && active !== null;
      const painted = gateColor(at(colors, index), at(colorRgb, index));
      const spool = asInt(at(spools, index));
      const parsed = gateStatus(at(statusList, index));
      const tools = ttgRaw ? ttg.flatMap((gate, tool) => (gate === index ? [tool] : [])) : [];
      gates.push({
        index,
        status: statusList ? parsed.status : null,
        statusCode: parsed.code,
        filamentName: names ? cleanText(at(names, index), 80) : useActive ? active.name : null,
        material: materials ? cleanText(at(materials, index), 32) : useActive ? active.material : null,
        color: colors || colorRgb ? painted.css : useActive ? active.color : null,
        colorName: colors ? painted.name : useActive ? active.colorName : null,
        temperature: temps ? positive(at(temps, index), 500) : useActive ? active.temperature : null,
        spoolId: spools ? (spool !== null && spool > 0 ? spool : null) : useActive ? active.spoolId : null,
        tools,
      });
    }
  }

  const printState = cleanText(source.print_state, 32);

  return {
    statusSeen,
    enabled: asBool(source.enabled),
    homed: asBool(source.is_homed),
    numGates: count,
    tool: toolIndex(source.tool),
    gate: selectedGate,
    lastTool: toolIndex(source.last_tool),
    nextTool: toolIndex(source.next_tool),
    filament,
    filamentRaw,
    filamentPos,
    filamentPosition: filamentPos === null ? null : (FILAMENT_POS_NAMES[filamentPos] ?? null),
    filamentDisagreement: filamentDisagrees(filament, filamentPos),
    action: cleanText(source.action, 40),
    printState,
    paused: printState ? null : (asBool(source.is_paused) ?? asBool(source.is_locked)),
    reasonForPause: cleanText(source.reason_for_pause, 240),
    ttgReported: ttgRaw !== null,
    gates,
    hiddenGates,
    commands: supported,
  };
}

export function slotLabel(kind: 'Tool' | 'Gate', value: number | null): string {
  if (value === null || value < -2) return `${kind} not reported`;
  if (value === -1) return `${kind} Unknown`;
  if (value === -2) return 'Bypass';
  return `${kind} ${value}`;
}

export function filamentHeadline(mmu: MmuState): string {
  if (mmu.filamentPosition) return mmu.filamentPosition;
  if (mmu.filament) return mmu.filament;
  if (mmu.filamentRaw) return mmu.filamentRaw;
  return 'Filament not reported';
}

export function mmuSummary(mmu: MmuState): string {
  if (mmu.reasonForPause) return mmu.reasonForPause;
  return `${slotLabel('Tool', mmu.tool)} · ${slotLabel('Gate', mmu.gate)} · ${filamentHeadline(mmu)}`;
}

export function gateStatusLabel(gate: MmuGate): string {
  switch (gate.status) {
    case 'unknown':
      return 'Unknown';
    case 'empty':
      return 'Empty';
    case 'available':
      return 'Available';
    case 'buffer':
      return 'From buffer';
    case 'unrecognized':
      return gate.statusCode === null ? 'Unrecognized status' : `Unrecognized status (${gate.statusCode})`;
    default:
      return 'Status not reported';
  }
}

export function mmuNeedsRecover(mmu: MmuState): boolean {
  if (mmu.reasonForPause) return true;
  if (mmu.filament === 'Unknown' || mmu.filamentPos === -1) return true;
  if (mmu.printState === 'error' || mmu.printState === 'pause_locked') return true;
  if (mmu.action === 'Unknown') return true;
  return false;
}

export interface MmuNotice {
  tone: 'danger' | 'warn' | 'info';
  text: string;
}

export function mmuNotices(mmu: MmuState): MmuNotice[] {
  const notices: MmuNotice[] = [];
  if (!mmu.statusSeen) notices.push({ tone: 'info', text: 'Waiting for MMU status' });
  if (mmu.enabled === false) notices.push({ tone: 'warn', text: 'Happy Hare reports the MMU is disabled' });
  if (mmu.reasonForPause) notices.push({ tone: 'danger', text: mmu.reasonForPause });
  if (mmu.printState === 'error' || mmu.printState === 'pause_locked') {
    notices.push({ tone: 'danger', text: `MMU print state: ${mmu.printState}` });
  } else if (mmu.printState === 'paused') {
    notices.push({ tone: 'warn', text: 'MMU print state: paused' });
  } else if (mmu.paused === true) {
    notices.push({ tone: 'warn', text: 'Happy Hare reports the MMU is paused' });
  }
  if (mmu.homed === false) notices.push({ tone: 'warn', text: 'The MMU reports it is not homed' });
  if (mmu.filamentDisagreement && mmu.filament) {
    notices.push({ tone: 'warn', text: `Filament field says ${mmu.filament}, which does not match the position above` });
  }
  if (mmu.commands === null) notices.push({ tone: 'info', text: 'Command list unavailable. No MMU moves are offered' });
  else if (mmu.commands.length === 0) {
    notices.push({ tone: 'info', text: 'This Happy Hare did not register load, unload, tool change, or recover' });
  }
  if (mmu.hiddenGates > 0) notices.push({ tone: 'info', text: `${mmu.hiddenGates} more gates were reported and are not shown` });
  if (mmu.statusSeen && mmu.numGates === null) notices.push({ tone: 'info', text: 'Gate count was not reported' });
  if (mmu.gates.length > 0 && !mmu.ttgReported) notices.push({ tone: 'info', text: 'Tool-to-gate map was not reported' });
  return notices;
}

const COMMAND_FOR: Record<MmuMove['action'], SupportedMmuCommand> = {
  load: MMU_LOAD,
  unload: MMU_UNLOAD,
  recover: MMU_RECOVER,
  change_tool: MMU_CHANGE_TOOL,
};

/** Exact G-code for a move. Null when the tool index cannot be written safely. */
export function mmuScript(move: MmuMove): string | null {
  if (move.action === 'load') return MMU_LOAD;
  if (move.action === 'unload') return MMU_UNLOAD;
  if (move.action === 'recover') return MMU_RECOVER;
  if (!Number.isInteger(move.tool) || move.tool < 0 || move.tool > 63) return null;
  return `${MMU_CHANGE_TOOL} TOOL=${move.tool}`;
}

function printingBlock(mmu: MmuState, jobState: JobState | null): string | null {
  if (jobState === 'printing') return 'Not available while printing';
  if (mmu.printState && PRINTING_MMU_STATES.has(mmu.printState)) return 'Not available while printing';
  return null;
}

function caution(mmu: MmuState, jobState: JobState | null): boolean {
  if (jobState === 'paused' || jobState === 'error') return true;
  return mmu.printState === 'paused' || mmu.printState === 'pause_locked' || mmu.printState === 'error';
}

/**
 * Decides whether one Happy Hare command may be sent.
 * The caller still has to pass the Klipper-ready gate before this.
 */
export function prepareMmuMove(move: MmuMove, ctx: { mmu: MmuState | null; jobState: JobState | null }): MmuMoveResult {
  const mmu = ctx.mmu;
  if (!mmu) return { ok: false, message: 'No Happy Hare MMU is connected' };
  if (!mmu.statusSeen) return { ok: false, message: 'Waiting for MMU status' };
  if (mmu.enabled === false) return { ok: false, message: 'Happy Hare reports the MMU is disabled' };

  const blocked = printingBlock(mmu, ctx.jobState);
  if (blocked) return { ok: false, message: blocked };
  if (mmu.action && BUSY_ACTIONS.has(mmu.action)) return { ok: false, message: `Happy Hare is busy (${mmu.action})` };

  const command = COMMAND_FOR[move.action];
  if (mmu.commands === null) return { ok: false, message: 'Happy Hare command list is unavailable' };
  if (!mmu.commands.includes(command)) return { ok: false, message: `${command} is not registered on this printer` };

  let script = mmuScript(move);
  if (!script) return { ok: false, message: 'Choose a whole tool number' };

  if (move.action === 'change_tool') {
    if (mmu.numGates === null || mmu.numGates < 1) return { ok: false, message: 'Tool count was not reported' };
    if (move.tool < 0 || move.tool >= mmu.numGates) {
      return { ok: false, message: `Tool ${move.tool} is outside 0–${mmu.numGates - 1}` };
    }
    if (mmu.tool === move.tool) return { ok: false, message: `Tool ${move.tool} is already selected` };
    script = `${MMU_CHANGE_TOOL} TOOL=${move.tool}`;
  }

  const careful = caution(mmu, ctx.jobState);
  const lines: string[] = [];
  if (ctx.jobState === 'paused') lines.push('A print is paused.');
  else if (ctx.jobState === 'error') lines.push('The print is in an error state.');
  else if (mmu.printState === 'pause_locked' || mmu.printState === 'paused' || mmu.printState === 'error') {
    lines.push(`Happy Hare print state is ${mmu.printState}.`);
  }
  if (mmu.homed === false) lines.push('The MMU reports it is not homed.');
  if (mmu.filament === 'Unknown' || mmu.filamentPos === -1) lines.push('Filament position is unknown.');

  if (move.action === 'load') {
    lines.push('Runs MMU_LOAD. Happy Hare loads filament from the current gate. This can move filament.');
  } else if (move.action === 'unload') {
    lines.push('Runs MMU_UNLOAD. Happy Hare unloads filament and parks it. This can move filament.');
  } else if (move.action === 'recover') {
    lines.push('Runs MMU_RECOVER with no parameters. Happy Hare checks the filament position and may move filament.');
  } else {
    lines.push(`Runs MMU_CHANGE_TOOL TOOL=${move.tool}. Happy Hare changes to tool ${move.tool}. This can move filament.`);
  }

  if (move.action !== 'change_tool') {
    if (mmu.gate === null) lines.push('The selected gate was not reported.');
    else if (mmu.gate === -1) lines.push('The selected gate is unknown.');
    else if (mmu.gate === -2) lines.push('The bypass is selected.');
  }
  lines.push('Nothing is sent until you confirm.');

  const titles: Record<MmuMove['action'], string> = {
    load: 'Load filament?',
    unload: 'Unload filament?',
    recover: 'Recover MMU state?',
    change_tool: 'Change to tool?',
  };
  const labels: Record<MmuMove['action'], string> = {
    load: 'Load',
    unload: 'Unload',
    recover: 'Recover',
    change_tool: 'Change tool',
  };
  const summaries: Record<MmuMove['action'], string> = {
    load: 'Load filament',
    unload: 'Unload filament',
    recover: 'Recover MMU state',
    change_tool: move.action === 'change_tool' ? `Change to tool ${move.tool}` : 'Change tool',
  };

  return {
    ok: true,
    plan: {
      script,
      summary: move.action === 'change_tool' ? `Change to tool ${move.tool}` : summaries[move.action],
      title: move.action === 'change_tool' ? `Change to tool ${move.tool}?` : titles[move.action],
      body: lines.join(' '),
      confirmLabel: labels[move.action],
      tone: careful ? 'warn' : 'primary',
    },
  };
}
