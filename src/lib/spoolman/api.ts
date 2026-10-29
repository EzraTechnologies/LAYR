import type { CommandOutcome } from '../actions/gateway';
import type { SpoolSummary, UnloadOutcome } from './types';

/** Page size Moonraker is asked for. Matches Spoolman's list limit used by the proxy query. */
export const LIST_LIMIT = 100;
export const MAX_LIST_OFFSET = 1900;
export const MAX_SPOOL_ID = 1_000_000_000;

const HEX_RE = /^[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;
const DETAIL_PATH_RE = /^\/v1\/spool\/([1-9][0-9]{0,8})$/;
const LIST_QUERY_RE = /^allow_archived=true&limit=100&offset=(\d+)$/;

export type SpoolmanPhase = 'idle' | 'absent' | 'loading' | 'ready' | 'offline' | 'unauthorized' | 'failed' | 'error';

export interface SpoolmanSnapshot {
  printerId: string;
  endpoint: string;
  phase: SpoolmanPhase;
  /** When false, the existing screens stay as they were before Spoolman. */
  tracked: boolean;
  message: string;
  activeId: number | null;
  activeKnown: boolean;
  spools: SpoolSummary[];
}

export type SpoolmanNotice =
  | { kind: 'active'; spoolId: number | null; known: boolean }
  | { kind: 'link'; connected: boolean };

export function emptySnapshot(printerId: string, endpoint: string): SpoolmanSnapshot {
  return {
    printerId,
    endpoint,
    phase: 'idle',
    tracked: false,
    message: '',
    activeId: null,
    activeKnown: false,
    spools: [],
  };
}

export function associationKey(printerId: string, endpoint: string): string {
  return `${printerId}\u0000${endpoint}`;
}

/** True when this catalogue belongs to the printer and Moonraker URL that requested it. */
export function belongsTo(snapshot: SpoolmanSnapshot, printerId: string, endpoint: string): boolean {
  return snapshot.printerId === printerId && snapshot.endpoint === endpoint && associationKey(printerId, endpoint) === associationKey(snapshot.printerId, snapshot.endpoint);
}

export function spoolIdValue(value: unknown, allowNone = false): number | null {
  if (value === null && allowNone) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_SPOOL_ID) {
    throw new Error('spool id');
  }
  return value;
}

export function listQuery(offset: number): string {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_LIST_OFFSET || offset % LIST_LIMIT !== 0) {
    throw new Error('offset');
  }
  return `allow_archived=true&limit=${LIST_LIMIT}&offset=${offset}`;
}

export function listProxyParams(offset = 0): Record<string, unknown> {
  return { use_v2_response: true, request_method: 'GET', path: '/v1/spool', query: listQuery(offset) };
}

export function detailProxyParams(spoolId: number): Record<string, unknown> {
  const id = spoolIdValue(spoolId);
  return { use_v2_response: true, request_method: 'GET', path: `/v1/spool/${id}` };
}

export function spoolmanProxyAllowed(params: unknown): boolean {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return false;
  const record = params as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'use_v2_response' && key !== 'request_method' && key !== 'path' && key !== 'query') return false;
  }
  if (record.use_v2_response !== true || record.request_method !== 'GET') return false;
  const path = record.path;
  if (typeof path !== 'string' || path.includes('..') || path.includes('\\') || path.includes('%') || path.includes('://')) {
    return false;
  }
  const query = record.query === undefined ? null : record.query;
  if (path === '/v1/spool') return listQueryOk(query);
  const match = DETAIL_PATH_RE.exec(path);
  if (!match || (query !== null && query !== '')) return false;
  try {
    const id = spoolIdValue(Number(match[1]));
    return match[1] === String(id);
  } catch {
    return false;
  }
}

export function spoolmanWriteAllowed(params: unknown): boolean {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return false;
  const record = params as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !('spool_id' in record)) return false;
  try {
    spoolIdValue(record.spool_id, true);
    return true;
  } catch {
    return false;
  }
}

/** Methods other than the proxy and the active-spool write are unchanged. */
export function spoolmanParamsAllowed(method: string, params?: Record<string, unknown>): boolean {
  if (method === 'server.spoolman.proxy') return spoolmanProxyAllowed(params);
  if (method === 'server.spoolman.post_spool_id') return spoolmanWriteAllowed(params);
  return true;
}

function listQueryOk(query: unknown): boolean {
  if (typeof query !== 'string') return false;
  const match = LIST_QUERY_RE.exec(query);
  if (!match || match[0] !== query) return false;
  const raw = match[1]!;
  const offset = Number(raw);
  if (raw !== String(offset)) return false;
  try {
    return query === listQuery(offset);
  } catch {
    return false;
  }
}

export function absentMessage(text: string): boolean {
  const lowered = text.toLowerCase();
  return ['not found', 'unknown method', 'unregistered', 'no module', 'method not found'].some((token) => lowered.includes(token));
}

export type SpoolmanFailure = 'absent' | 'unauthorized' | 'offline' | 'error';

export function classifyRpcFailure(code: number, message: string): SpoolmanFailure {
  const text = message.toLowerCase();
  if (code === 401 || code === 403 || /unauthori[sz]ed|forbidden|api key|not trusted/.test(text)) return 'unauthorized';
  if (code === -32601 || absentMessage(text)) return 'absent';
  if (code === 503 || /not available|not reachable|offline|timed out|econnrefused|connection refused/.test(text)) return 'offline';
  return 'error';
}

export interface ParsedStatus {
  ok: boolean;
  connected: boolean;
  activeKnown: boolean;
  spoolId: number | null;
  error: string;
}

export function parseStatus(result: unknown): ParsedStatus {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return { ok: false, connected: false, activeKnown: false, spoolId: null, error: 'Unexpected Spoolman status' };
  }
  const record = result as Record<string, unknown>;
  const id = optionalId(record, 'spool_id');
  return {
    ok: true,
    connected: record.spoolman_connected === true,
    activeKnown: id.known,
    spoolId: id.spoolId,
    error: '',
  };
}

export interface ParsedActive {
  ok: boolean;
  activeKnown: boolean;
  spoolId: number | null;
  error: string;
}

export function parseActive(result: unknown): ParsedActive {
  if (typeof result !== 'object' || result === null || Array.isArray(result) || !('spool_id' in result)) {
    return { ok: false, activeKnown: false, spoolId: null, error: 'Spoolman did not return an active spool' };
  }
  const id = optionalId(result as Record<string, unknown>, 'spool_id');
  if (!id.known) return { ok: false, activeKnown: false, spoolId: null, error: 'Spoolman returned an unusable spool id' };
  return { ok: true, activeKnown: true, spoolId: id.spoolId, error: '' };
}

function optionalId(payload: Record<string, unknown>, key: string): { known: boolean; spoolId: number | null } {
  if (!(key in payload)) return { known: false, spoolId: null };
  const value = payload[key];
  if (value === null) return { known: true, spoolId: null };
  try {
    return { known: true, spoolId: spoolIdValue(value) };
  } catch {
    return { known: false, spoolId: null };
  }
}

export interface ParsedPage {
  ok: boolean;
  spools: SpoolSummary[];
  received: number;
  error: string;
  failure: SpoolmanFailure | null;
}

export function parseProxy(result: unknown): ParsedPage {
  const unwrapped = unwrap(result);
  if (unwrapped.failure || unwrapped.error) {
    return { ok: false, spools: [], received: 0, error: unwrapped.error, failure: unwrapped.failure };
  }
  const parsed = parseCollection(unwrapped.payload);
  return { ok: true, spools: parsed.spools, received: parsed.received, error: '', failure: null };
}

function unwrap(result: unknown): { payload: unknown; error: string; failure: SpoolmanFailure | null } {
  if (Array.isArray(result)) return { payload: result, error: '', failure: null };
  if (typeof result !== 'object' || result === null) {
    return { payload: null, error: 'Unexpected Spoolman response', failure: 'error' };
  }
  const record = result as Record<string, unknown>;
  if (record.error) {
    const error = record.error;
    const message = typeof error === 'object' && error !== null && 'message' in error ? String((error as { message?: unknown }).message ?? '') : String(error);
    const code = typeof error === 'object' && error !== null && 'status_code' in error ? Number((error as { status_code?: unknown }).status_code) : 0;
    const failure = classifyRpcFailure(Number.isFinite(code) ? code : 0, message || 'Spoolman error');
    return { payload: null, error: failure === 'offline' ? 'Spoolman is not reachable' : message || 'Spoolman error', failure };
  }
  if ('response' in record) return { payload: record.response, error: '', failure: null };
  if ('id' in record && 'filament' in record) return { payload: record, error: '', failure: null };
  return { payload: null, error: 'Unexpected Spoolman response', failure: 'error' };
}

function parseCollection(payload: unknown): { spools: SpoolSummary[]; received: number } {
  if (Array.isArray(payload)) {
    const spools = payload.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null).flatMap((item) => {
      const parsed = parseSpool(item);
      return parsed ? [parsed] : [];
    });
    return { spools, received: payload.length };
  }
  if (typeof payload === 'object' && payload !== null && 'id' in payload) {
    const parsed = parseSpool(payload as Record<string, unknown>);
    return { spools: parsed ? [parsed] : [], received: 1 };
  }
  return { spools: [], received: 0 };
}

export function parseSpool(item: Record<string, unknown>): SpoolSummary | null {
  let id: number | null;
  try {
    id = spoolIdValue(item.id);
  } catch {
    return null;
  }
  if (id === null) return null;
  const filament = asRecord(item.filament);
  const vendor = asRecord(filament?.vendor);
  const colorHex = firstColor(filament?.color_hex, filament?.multi_color_hexes);
  return {
    id,
    name: text(filament?.name) || `Spool ${id}`,
    material: text(filament?.material),
    vendor: text(vendor?.name),
    colorHex,
    remainingWeightG: grams(item.remaining_weight),
    remainingLengthMm: grams(item.remaining_length),
    archived: item.archived === true,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function grams(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function firstColor(single: unknown, multi: unknown): string | null {
  const found: string[] = [];
  if (typeof multi === 'string' && multi.trim()) {
    for (const piece of multi.split(',')) {
      const color = cssHex(piece.trim());
      if (color && !found.includes(color)) found.push(color);
    }
  }
  if (found.length === 0 && typeof single === 'string') {
    const color = cssHex(single);
    if (color) found.push(color);
  }
  return found[0] ?? null;
}

/** Six-digit hex without `#`, or null when the value is not a colour Spoolman would store. */
export function cssHex(value: string): string | null {
  const token = value.startsWith('#') ? value.slice(1) : value;
  if (!HEX_RE.test(token)) return null;
  return token.slice(0, 6).toLowerCase();
}

/** CSS colour for a swatch. Null means Spoolman did not send a usable colour. */
export function cssColor(colorHex: string | null): string | null {
  if (!colorHex) return null;
  const hex = cssHex(colorHex);
  return hex ? `#${hex}` : null;
}

export function parseSpoolmanNotice(method: string, params: unknown): SpoolmanNotice | null {
  const payload = noticePayload(params);
  if (method === 'notify_active_spool_set') {
    if (!payload || !('spool_id' in payload)) return { kind: 'active', spoolId: null, known: false };
    const parsed = parseActive(payload);
    return { kind: 'active', spoolId: parsed.spoolId, known: parsed.ok && parsed.activeKnown };
  }
  if (method === 'notify_spoolman_status_changed') {
    if (!payload || !('spoolman_connected' in payload)) return null;
    return { kind: 'link', connected: payload.spoolman_connected === true };
  }
  return null;
}

function noticePayload(params: unknown): Record<string, unknown> | null {
  if (Array.isArray(params) && params.length > 0 && typeof params[0] === 'object' && params[0] !== null) {
    return params[0] as Record<string, unknown>;
  }
  if (typeof params === 'object' && params !== null && !Array.isArray(params)) return params as Record<string, unknown>;
  return null;
}

export function unloadOutcomeFrom(outcome: Pick<CommandOutcome, 'status'> & { message?: string }): UnloadOutcome {
  if (outcome.status === 'ok') return { kind: 'confirmed-success' };
  if (outcome.status === 'failed') return { kind: 'failed', reason: outcome.message ?? '' };
  if (outcome.status === 'unconfirmed') return { kind: 'unconfirmed', reason: outcome.message ?? '' };
  return { kind: 'cancelled' };
}

export function formatGrams(value: number): string {
  if (value >= 100 || Math.abs(value - Math.round(value)) < 0.05) return `${Math.round(value)} g`;
  return `${value.toFixed(1)} g`;
}

export function formatLength(mm: number): string {
  if (mm <= 0) return '0 mm';
  if (mm >= 1000) {
    const metres = mm / 1000;
    return `${metres >= 10 ? metres.toFixed(0) : metres.toFixed(1)} m`;
  }
  return `${Math.round(mm)} mm`;
}

/** Remaining quantity from the fields Spoolman actually sent. Never invents a number. */
export function quantityText(spool: Pick<SpoolSummary, 'remainingWeightG' | 'remainingLengthMm'>): string {
  const weight = spool.remainingWeightG;
  const length = spool.remainingLengthMm;
  if (weight == null && length == null) return 'Quantity not reported';
  if (weight != null && length != null) return `${formatGrams(weight)} · ${formatLength(length)} left`;
  if (weight != null) return `${formatGrams(weight)} left`;
  return `${formatLength(length ?? 0)} left`;
}

export function materialText(spool: Pick<SpoolSummary, 'vendor' | 'material'>): string {
  const parts = [spool.vendor, spool.material].filter((part): part is string => !!part);
  return parts.join(' · ') || 'Material not reported';
}

export function materialMismatch(fileMaterial: string | null | undefined, spool: SpoolSummary | null): string | null {
  if (!fileMaterial || !spool?.material) return null;
  if (fileMaterial.trim().toLowerCase() === spool.material.trim().toLowerCase()) return null;
  return `This file asks for ${fileMaterial.trim()}. The active spool is ${spool.material}.`;
}

export function sortSpools(spools: readonly SpoolSummary[], activeId: number | null): SpoolSummary[] {
  return [...spools].sort((a, b) => {
    const rank = (spool: SpoolSummary) => (spool.id === activeId ? 0 : spool.archived ? 2 : 1);
    const delta = rank(a) - rank(b);
    if (delta !== 0) return delta;
    return a.name.localeCompare(b.name) || a.id - b.id;
  });
}

export function matchesSpool(spool: SpoolSummary, query: string, material: string): boolean {
  if (material && (spool.material ?? '') !== material) return false;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [spool.name, spool.vendor ?? '', spool.material ?? '', String(spool.id)].join(' ').toLowerCase();
  return haystack.includes(needle);
}
