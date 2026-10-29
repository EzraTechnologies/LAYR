import type { HostMachine } from '../printer/model';

/**
 * Raspberry Pi host power, as documented by Moonraker's machine API:
 * JSON-RPC `machine.reboot` and `machine.shutdown` (HTTP POST `/machine/reboot`
 * and `/machine/shutdown`). Neither method takes parameters. The result is `"ok"`
 * when Moonraker accepts the request.
 *
 * Moonraker still has to be allowed to reboot or shut down the host (systemd
 * provider, not `none`, and not inside a container). A refused or missing method
 * comes back as a JSON-RPC error. The socket may also close before that reply.
 *
 * `machine.services.*`, `machine.system_info`, sudo, and every other `machine.*`
 * method are not host power and are not allowed here.
 */
export const MACHINE_REBOOT_METHOD = 'machine.reboot';
export const MACHINE_SHUTDOWN_METHOD = 'machine.shutdown';

export const HOST_METHOD_LIST = [MACHINE_REBOOT_METHOD, MACHINE_SHUTDOWN_METHOD] as const;

export type HostMethod = (typeof HOST_METHOD_LIST)[number];

export function isHostMethod(method: string): method is HostMethod {
  return method === MACHINE_REBOOT_METHOD || method === MACHINE_SHUTDOWN_METHOD;
}

/** These two methods are sent with no `params` object at all. `{}` is not allowed. */
export function hostParamsAllowed(method: string, params?: Record<string, unknown>): boolean {
  if (!isHostMethod(method)) return true;
  return params === undefined;
}

export const HOST_UNKNOWN_MESSAGE = 'Moonraker has not reported Raspberry Pi host controls';
export const HOST_UNSUPPORTED_MESSAGE = 'This Moonraker does not provide Raspberry Pi reboot or shutdown';
export const HOST_UNAUTHORIZED_MESSAGE = 'Moonraker denied Raspberry Pi host control for this connection';
export const HOST_UNCONFIRMED_NOTE =
  'The Raspberry Pi may still be running. This is not a confirmed reboot or shutdown';

export type HostRefusal = 'unauthorized' | 'unsupported';

/** Classify a JSON-RPC error from `machine.reboot` or `machine.shutdown`. */
export function classifyHostRpcError(code: number, message: string): HostRefusal | 'rejected' {
  const text = message.toLowerCase();
  if (
    code === 401 ||
    code === 403 ||
    /unauthori[sz]ed|forbidden|permission denied|access denied|not permitted|insufficient permission/.test(text)
  ) {
    return 'unauthorized';
  }
  if (code === -32601 || /method not found|unknown method|unregistered|no module/.test(text)) return 'unsupported';
  return 'rejected';
}

/**
 * `server.info` capability for the two host methods.
 * `unknown` when the component list was not sent (do not guess).
 * `unavailable` when `machine` is missing, failed, or the reported API is older than 1.0.
 * A missing API version with a loaded `machine` component stays available: those methods
 * predate Moonraker's API version field.
 */
export function hostMachineFromInfo(info: {
  components?: unknown;
  failed_components?: unknown;
  api_version?: unknown;
  api_version_string?: unknown;
} | null | undefined): HostMachine {
  if (!info || typeof info !== 'object') return 'unknown';
  if (info.components == null) return 'unknown';
  const components = stringList(info.components);
  if (!components) return 'unknown';
  if (info.failed_components != null) {
    const failed = stringList(info.failed_components);
    if (!failed) return 'unknown';
    if (failed.includes('machine')) return 'unavailable';
  }
  if (!components.includes('machine')) return 'unavailable';
  if (!reportedApiAllowsHost(info.api_version, info.api_version_string)) return 'unavailable';
  return 'available';
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === 'string')) return null;
  return value;
}

function reportedApiAllowsHost(version: unknown, versionString: unknown): boolean {
  if (version != null) {
    const fromList = parseVersionList(version);
    return !!fromList && fromList[0] >= 1;
  }
  if (typeof versionString === 'string' && versionString !== '') {
    const fromString = parseVersionString(versionString);
    return !!fromString && fromString[0] >= 1;
  }
  return true;
}

function parseVersionList(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return null;
  const parts = [0, 0, 0];
  for (let i = 0; i < value.length; i += 1) {
    const part = value[i];
    if (typeof part !== 'number' || !Number.isInteger(part) || part < 0) return null;
    parts[i] = part;
  }
  return [parts[0]!, parts[1]!, parts[2]!];
}

function parseVersionString(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
