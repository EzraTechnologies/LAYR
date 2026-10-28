/**
 * Moonraker Spoolman requests and response parsing.
 *
 * Allow-list matches Moonraker's documented proxy: GET `/v1/spool` with a fixed query,
 * or GET `/v1/spool/<id>` with no query. Other methods, paths and queries are rejected
 * before they are sent. Nothing in this module opens a socket or uses a host URL.
 */

import type { SpoolSummary } from './types';

export const SPOOL_LIST_LIMIT = 100;
export const MAX_SPOOL_LIST_OFFSET = 400;
export const MAX_SPOOL_ID = 1_000_000_000;

const HEX_RE = /^[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;
const DETAIL_PATH_RE = /^\/v1\/spool\/([1-9][0-9]{0,8})$/;
const LIST_QUERY_RE = /^allow_archived=true&limit=100&offset=(\d+)$/;
const ABSENT_TOKENS = ['not found', 'unknown method', 'unregistered', 'no module', 'method not found'];

export function spoolIdValue(value: unknown, allowNone = false): number | null {
  if (value === null && allowNone) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_SPOOL_ID) {
    throw new Error('spool id');
  }
  return value;
}

export function listQuery(offset: number): string {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_SPOOL_LIST_OFFSET || offset % SPOOL_LIST_LIMIT !== 0) {
    throw new Error('offset');
  }
  return `allow_archived=true&limit=${SPOOL_LIST_LIMIT}&offset=${offset}`;
}

function listQueryOk(query: unknown): boolean {
  if (typeof query !== 'string') return false;
  const match = LIST_QUERY_RE.exec(query);
  if (!match || match[0] !== query) return false;
  const raw = match[1]!;
  const offset = Number(raw);
  if (String(offset) !== raw) return false;
  try {
    return query === listQuery(offset);
  } catch {
    return false;
  }
}

export function spoolmanProxyAllowed(params: unknown): boolean {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return false;
  const record = params as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'use_v2_response' && key !== 'request_method' && key !== 'path' && key !== 'query') return false;
  }
  if (record.use_v2_response !== true || record.request_method !== 'GET') return false;
  const path = record.path;
  if (typeof path !== 'string' || path.includes('..') || path.includes('\\') || path.includes('%') || path.includes('://')) return false;
  const query = record.query;
  if (path === '/v1/spool') return listQueryOk(query);
  const match = DETAIL_PATH_RE.exec(path);
  if (!match || match[0] !== path || (query !== undefined && query !== '')) return false;
  try {
    spoolIdValue(Number(match[1]));
  } catch {
    return false;
  }
  return match[1] === String(Number(match[1]));
}

export function spoolmanWriteAllowed(params: unknown): boolean {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return false;
  const record = params as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !('spool_id' in record)) return false;
  try {
    spoolIdValue(record.spool_id, true);
  } catch {
    return false;
  }
  return true;
}

export function spoolmanListParams(offset = 0): Record<string, unknown> {
  return { use_v2_response: true, request_method: 'GET', path: '/v1/spool', query: listQuery(offset) };
}

export function spoolmanDetailParams(spoolId: number): Record<string, unknown> {
  spoolIdValue(spoolId);
  return { use_v2_response: true, request_method: 'GET', path: `/v1/spool/${spoolId}` };
}

/** Rejects a Spoolman call whose parameters are outside the allow-list. Other methods are untouched. */
export function assertSpoolmanCall(method: string, params: Record<string, unknown> | undefined): void {
  if (method === 'server.spoolman.proxy' && !spoolmanProxyAllowed(params ?? {})) {
    throw new Error('Spoolman proxy request is not allowed');
  }
  if (method === 'server.spoolman.post_spool_id' && !spoolmanWriteAllowed(params ?? {})) {
    throw new Error('Spoolman spool id is not allowed');
  }
}

export function isSpoolmanAbsentError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error && typeof error.code === 'number' ? error.code : null;
  if (code === -32601) return true;
  const text = error.message.toLowerCase();
  return ABSENT_TOKENS.some((token) => text.includes(token));
}

export interface ParsedStatus {
  ok: true;
  connected: boolean;
  activeKnown: boolean;
  spoolId: number | null;
}

export function parseSpoolmanStatus(result: unknown): ParsedStatus | { ok: false; error: string } {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return { ok: false, error: 'Unexpected Spoolman status' };
  }
  const record = result as Record<string, unknown>;
  const id = optionalId(record, 'spool_id');
  if (id === 'bad') return { ok: false, error: 'Spoolman returned an unusable spool id' };
  return { ok: true, connected: record.spoolman_connected === true, activeKnown: id !== 'missing', spoolId: id === 'missing' ? null : id };
}

export function parseActiveSpool(result: unknown): { ok: true; spoolId: number | null } | { ok: false; error: string } {
  if (typeof result !== 'object' || result === null || Array.isArray(result) || !('spool_id' in result)) {
    return { ok: false, error: 'Spoolman did not return an active spool' };
  }
  const id = optionalId(result as Record<string, unknown>, 'spool_id');
  if (id === 'missing' || id === 'bad') return { ok: false, error: 'Spoolman returned an unusable spool id' };
  return { ok: true, spoolId: id };
}

function optionalId(payload: Record<string, unknown>, key: string): number | null | 'missing' | 'bad' {
  if (!(key in payload)) return 'missing';
  const value = payload[key];
  if (value === null) return null;
  try {
    return spoolIdValue(value);
  } catch {
    return 'bad';
  }
}

export interface ParsedCatalogue {
  ok: true;
  spools: SpoolSummary[];
  received: number;
}

export function parseSpoolmanProxy(result: unknown): ParsedCatalogue | { ok: false; offline: boolean; error: string } {
  const unwrapped = unwrapProxy(result);
  if (!unwrapped.ok) return unwrapped;
  const parsed = parseCollection(unwrapped.payload);
  return { ok: true, spools: parsed.spools, received: parsed.received };
}

function unwrapProxy(result: unknown): { ok: true; payload: unknown } | { ok: false; offline: boolean; error: string } {
  if (Array.isArray(result)) return { ok: true, payload: result };
  if (typeof result !== 'object' || result === null) return { ok: false, offline: false, error: 'Unexpected Spoolman response' };
  const record = result as Record<string, unknown>;
  if (record.error) {
    const error = record.error;
    const message = typeof error === 'object' && error !== null && 'message' in error ? String((error as { message?: unknown }).message ?? '') : String(error);
    const code = typeof error === 'object' && error !== null && 'status_code' in error ? (error as { status_code?: unknown }).status_code : null;
    const text = message || 'Spoolman error';
    if (code === 503 || text.toLowerCase().includes('not available')) return { ok: false, offline: true, error: 'Spoolman is not reachable' };
    return { ok: false, offline: false, error: text };
  }
  if ('response' in record) return { ok: true, payload: record.response };
  if ('id' in record && 'filament' in record) return { ok: true, payload: record };
  return { ok: false, offline: false, error: 'Unexpected Spoolman response' };
}

function parseCollection(payload: unknown): { spools: SpoolSummary[]; received: number } {
  const items = Array.isArray(payload) ? payload : typeof payload === 'object' && payload !== null && 'id' in payload ? [payload] : [];
  const received = Array.isArray(payload) ? payload.length : items.length;
  const spools: SpoolSummary[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const spool = parseSpool(item as Record<string, unknown>);
    if (spool) spools.push(spool);
  }
  return { spools, received };
}

function parseSpool(item: Record<string, unknown>): SpoolSummary | null {
  let id: number;
  try {
    const parsed = spoolIdValue(item.id);
    if (parsed === null) return null;
    id = parsed;
  } catch {
    return null;
  }
  const filament = asRecord(item.filament);
  const vendor = asRecord(filament.vendor);
  const colors = colorsFrom(filament.color_hex, filament.multi_color_hexes);
  const name = text(filament.name) || `Spool ${id}`;
  return {
    id,
    name,
    material: text(filament.material) || null,
    vendor: text(vendor.name) || null,
    colorHex: colors[0]?.slice(1) ?? null,
    colors,
    remainingWeightG: grams(item.remaining_weight),
    remainingLengthMm: lengthMm(item.remaining_length),
    usedWeightG: grams(item.used_weight),
    spoolWeightG: grams(filament.weight),
    archived: item.archived === true,
    location: text(item.location) || null,
    lot: text(item.lot_nr) || null,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.split(/\s+/).filter(Boolean).join(' ');
}

function grams(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function lengthMm(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function colorsFrom(single: unknown, multi: unknown): string[] {
  const found: string[] = [];
  if (typeof multi === 'string' && multi.trim()) {
    for (const piece of multi.split(',')) {
      const color = cssColor(piece.trim());
      if (color && !found.includes(color)) found.push(color);
    }
  }
  if (found.length === 0) {
    const color = cssColor(typeof single === 'string' ? single : '');
    if (color) found.push(color);
  }
  return found.slice(0, 6);
}

function cssColor(value: string): string {
  const token = value.startsWith('#') ? value.slice(1) : value;
  if (!HEX_RE.test(token)) return '';
  return `#${token.slice(0, 6).toLowerCase()}`;
}

export function formatGrams(value: number | null): string | null {
  if (value === null) return null;
  if (value >= 100 || Math.abs(value - Math.round(value)) < 0.05) return `${Math.round(value)} g`;
  return `${value.toFixed(1)} g`;
}

export function formatLength(mm: number | null): string | null {
  if (mm === null) return null;
  if (mm >= 1000) return `${(mm / 1000).toFixed(mm >= 10_000 ? 1 : 2)} m`;
  return `${Math.round(mm)} mm`;
}

/** Remaining quantity line. "Weight not reported" when Spoolman sent neither weight nor length. */
export function spoolQuantityLine(spool: SpoolSummary): string {
  const parts: string[] = [];
  const remaining = formatGrams(spool.remainingWeightG);
  const length = formatLength(spool.remainingLengthMm);
  const used = formatGrams(spool.usedWeightG);
  const total = formatGrams(spool.spoolWeightG);
  if (remaining) parts.push(`${remaining} left`);
  if (length) parts.push(`${length} left`);
  if (used && total) parts.push(`${used} used · ${total} spool`);
  else if (used) parts.push(`${used} used`);
  else if (total && !remaining) parts.push(`${total} spool`);
  return parts.join(' · ') || 'Weight not reported';
}

export function spoolMatches(spool: SpoolSummary, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [spool.name, spool.vendor ?? '', spool.material ?? '', spool.location ?? '', spool.lot ?? '', String(spool.id)].join(' ').toLowerCase();
  return haystack.includes(needle);
}
