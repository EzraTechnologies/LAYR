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

/** Thumbnail entry from `server.files.metadata`; `relative_path` is relative to the G-code file's folder. */
export interface ThumbnailInfo {
  width?: number;
  height?: number;
  size?: number;
  relative_path?: string;
}

/** `server.files.metadata` result (all fields depend on the slicer). */
export interface FileMetadata {
  filename?: string;
  size?: number;
  modified?: number;
  slicer?: string;
  slicer_version?: string;
  estimated_time?: number;
  layer_count?: number;
  layer_height?: number;
  first_layer_height?: number;
  object_height?: number;
  first_layer_extr_temp?: number;
  first_layer_bed_temp?: number;
  chamber_temp?: number;
  filament_name?: string;
  filament_type?: string;
  filament_total?: number;
  filament_weight_total?: number;
  nozzle_diameter?: number;
  thumbnails?: ThumbnailInfo[];
  print_start_time?: number | null;
}

/** `server.files.get_directory` result. With `extended: true`, file entries also carry metadata fields. */
export interface DirectoryResult {
  dirs?: Array<{ dirname?: string; modified?: number; size?: number; permissions?: string }>;
  files?: Array<FileMetadata & { filename?: string; modified?: number; size?: number; permissions?: string }>;
  disk_usage?: { total?: number; used?: number; free?: number };
  root_info?: { name?: string; permissions?: string };
}

export interface GcodeStoreResult {
  gcode_store?: Array<{ message?: string; time?: number; type?: string }>;
}

/** `configfile.settings`: parsed config sections, keyed by lower-case section name. */
export type ConfigSettings = Record<string, Record<string, unknown>>;

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
