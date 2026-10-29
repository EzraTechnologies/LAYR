import { mapAfc } from '../afc/map';
import { integrationEnabled } from '../integrations/runtime';
import { parseMmu } from '../mmu/happyhare';
import { mapFans, mapFilamentSensors, mapLights, mapLimits, mapMacros, mapToolhead } from '../moonraker/controls';
import { mapJob, mapTemperatures, parseJobState } from '../moonraker/mapping';
import type { ConfigSettings, RawStatus } from '../moonraker/types';
import { deriveStatus, FALLBACK_LIMITS, type KlippyState, type PrinterState, type TransportState } from './model';
import { mapMotion } from './telemetry';

export interface AssembleInputs {
  printerId: string;
  /** Configured display name; empty to fall back to the host name. */
  configuredName: string;
  hostname: string | null;
  transport: TransportState;
  klippy: KlippyState;
  klippyMessage: string | null;
  reconnectAttempt: number;
  nextRetryAt: number | null;
  transportReason: string | null;
  raw: RawStatus;
  slicerEstimate: number | null;
  missingObjects: string[];
  /** Object names from `printer.objects.list`. */
  objects: string[];
  /** AFC commands listed by `printer.gcode.help`. Empty when AFC is absent or the query failed. */
  afcCommands: readonly string[];
  /** `configfile.settings`, from the subscription snapshot (query is only a fallback). */
  settings: ConfigSettings;
  /** Thumbnail for the current job file, or null. Cleared when the filename changes. */
  thumbnailPath: string | null;
  /**
   * Supported Happy Hare commands from `printer.gcode.help`.
   * Null when the printer has no `mmu` object or the help query failed.
   */
  gcodeCommands?: string[] | null;
  now: number;
}

const staticCache = new WeakMap<object, WeakMap<object, Pick<PrinterState, 'macros' | 'limits'>>>();

/** Macros and limits only change when Klipper restarts, so they are computed once per objects/settings pair. */
function staticInfo(objects: string[], settings: ConfigSettings): Pick<PrinterState, 'macros' | 'limits'> {
  let bySettings = staticCache.get(objects);
  if (!bySettings) staticCache.set(objects, (bySettings = new WeakMap()));
  let info = bySettings.get(settings);
  if (!info) bySettings.set(settings, (info = { macros: mapMacros(objects, settings), limits: mapLimits(settings) }));
  return info;
}

/** Builds the UI state from raw Moonraker data. */
export function assembleState(input: AssembleInputs): PrinterState {
  const connected = input.transport === 'connected' && input.klippy === 'ready';
  // Object data is only trustworthy while Klipper is ready; otherwise show no live values.
  const raw = connected ? input.raw : {};
  const job = mapJob(raw, input.slicerEstimate);
  if (job) job.thumbnailPath = input.thumbnailPath;
  const temps = mapTemperatures(raw);
  const jobState = raw.print_stats ? parseJobState(raw.print_stats.state) : null;
  const info = connected ? staticInfo(input.objects, input.settings) : { macros: [], limits: FALLBACK_LIMITS };

  const { status, detail } = deriveStatus({
    transport: input.transport,
    klippy: input.klippy,
    jobState,
    klippyMessage: input.klippyMessage,
    jobMessage: job?.message ?? null,
  });

  let statusDetail = detail;
  if (input.transport === 'waiting') {
    statusDetail = input.transportReason ? `${input.transportReason}. Retrying automatically` : 'Retrying automatically';
  }

  const canExtrude = raw.extruder?.can_extrude;
  return {
    printerId: input.printerId,
    printerName: input.configuredName || input.hostname || 'Klipper printer',
    hostname: input.hostname,
    status,
    statusDetail,
    transport: input.transport,
    klippy: input.klippy,
    reconnectAttempt: input.reconnectAttempt,
    nextRetryAt: input.transport === 'waiting' ? input.nextRetryAt : null,
    job,
    extruder: temps.extruder,
    bed: temps.bed,
    chamber: temps.chamber,
    sensors: temps.sensors,
    canExtrude: typeof canExtrude === 'boolean' ? canExtrude : null,
    motion: mapMotion(raw, connected ? input.settings : {}),
    toolhead: mapToolhead(raw),
    fans: mapFans(raw),
    lights: mapLights(raw, input.settings),
    macros: info.macros,
    filamentSensors: mapFilamentSensors(raw),
    afc: connected && integrationEnabled('afc') ? mapAfc(raw, input.objects, input.afcCommands) : null,
    mmu:
      connected && integrationEnabled('happyHare') && input.objects.includes('mmu')
        ? parseMmu(raw.mmu, input.gcodeCommands ?? null)
        : null,
    limits: structuredClone(info.limits),
    idleState: typeof raw.idle_timeout?.state === 'string' ? raw.idle_timeout.state : null,
    missingObjects: connected ? input.missingObjects : [],
    now: input.now,
  };
}
