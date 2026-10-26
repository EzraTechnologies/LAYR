/** Minimal Moonraker / Klipper API shapes used by LAYR. Fields are optional because Klipper only reports what exists. */

export interface ServerInfo {
  klippy_connected?: boolean;
  klippy_state?: string;
  components?: string[];
  failed_components?: string[];
  moonraker_version?: string;
  api_version_string?: string;
}

export interface PrinterInfo {
  state?: string;
  state_message?: string;
  hostname?: string;
  software_version?: string;
}

export interface ObjectsListResult {
  objects: string[];
}

export interface SubscribeResult {
  eventtime?: number;
  status: RawStatus;
}

export interface FileMetadata {
  filename?: string;
  estimated_time?: number;
  layer_count?: number;
  slicer?: string;
}

/** Accumulated Klipper object status, keyed by object name. */
export type RawStatus = Record<string, Record<string, unknown>>;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id: number;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown[];
}

/** The subset of the browser WebSocket API the client relies on, so tests can provide a fake. */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export const WS_OPEN = 1;
