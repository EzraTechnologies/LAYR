/**
 * View of AFC (AFC-Klipper-Add-On) as reported by Klipper objects.
 * Null fields were absent from the status payload. They are not guessed.
 */

export interface AfcLane {
  /** Config name, for example `lane1`. This is the value passed to `LANE=`. */
  name: string;
  /** `AFC_lane <name>` or `AFC_stepper <name>`. Null when only the `AFC` object listed the name. */
  object: string | null;
  /** False when this lane's object sent no recognised status fields. */
  detailReported: boolean;
  unit: string | null;
  hub: string | null;
  extruder: string | null;
  buffer: string | null;
  bufferStatus: string | null;
  /** `lane` index from the lane object. */
  index: number | null;
  /** Tool map such as `T0`. */
  map: string | null;
  /** Load-sensor state (`load`). */
  load: boolean | null;
  /** Prep-sensor state (`prep`). */
  prep: boolean | null;
  toolLoaded: boolean | null;
  loadedToHub: boolean | null;
  material: string | null;
  filamentName: string | null;
  /** `#rgb` or `#rrggbb` from `color`. Anything else is dropped. */
  color: string | null;
  /** Grams. Null when `weight` was missing or not a finite number in range. */
  weight: number | null;
  spoolId: number | null;
  filamentStatus: string | null;
  /** Lane state such as `Tooled` or `Tool Loading` (`status`). */
  status: string | null;
  runoutLane: string | null;
}

export interface AfcUnit {
  /** Unit config name, for example `Turtle_1`. */
  name: string;
  /** Label from the unit type AFC reported, when that string was present. */
  typeLabel: string | null;
  /** Klipper unit object, when one was subscribed. */
  object: string | null;
  /** Lane names the unit object listed. Empty when it did not report `lanes`. */
  laneNames: string[];
}

export interface AfcMessage {
  text: string;
  /** Lower-case `type` from AFC, or an empty string when the type was missing. */
  type: string;
}

export interface AfcStatus {
  /** True once the `AFC` object returned at least one field. */
  reported: boolean;
  /** `current_state`, for example `Idle` or `Loading`. */
  state: string | null;
  /** `error_state`. Null when the field was missing. */
  error: boolean | null;
  /** Lane name in the toolhead (`current_load`), or null when AFC says nothing is loaded. */
  currentLoad: string | null;
  /** False when `current_load` was not in the payload, so "nothing loaded" would be a guess. */
  currentLoadKnown: boolean;
  /** Lane AFC is moving now (`current_lane`). Not the lane sitting in the tool. */
  currentLane: string | null;
  nextLane: string | null;
  bypass: boolean | null;
  positionSaved: boolean | null;
  /** Present only when both tool-change counters were numbers and the total was positive. */
  toolchange: { current: number; total: number } | null;
  message: AfcMessage | null;
  units: AfcUnit[];
  lanes: AfcLane[];
  /**
   * Documented lane commands that `printer.gcode.help` actually listed.
   * One of `TOOL_LOAD`, `TOOL_UNLOAD`, `CHANGE_TOOL`, `HUB_LOAD`, `LANE_UNLOAD`.
   */
  commands: string[];
  /** True when the subscription cap dropped lane or unit objects. */
  truncated: boolean;
}

export interface AfcLaneGroup {
  id: string;
  title: string;
  lanes: AfcLane[];
}
