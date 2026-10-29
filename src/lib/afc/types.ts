/** AFC status read from Klipper objects. Missing fields stay null; nothing here is invented. */

export interface AfcLane {
  /** Lane name used by `CHANGE_TOOL LANE=`. */
  name: string;
  /** Klipper object that reported this lane, when there was one. */
  object: string | null;
  unit: string | null;
  hub: string | null;
  index: number | null;
  /** Tool macro AFC assigned, such as `T0`, when it reported one. */
  map: string | null;
  material: string | null;
  /** CSS colour when AFC sent a hex colour. A colour name is kept in `colorName`. */
  color: string | null;
  colorName: string | null;
  weightG: number | null;
  /** `filament_status` as reported: In Tool, Ready, Prep, Not Ready, or whatever this version sent. */
  filamentStatus: string | null;
  load: boolean | null;
  prep: boolean | null;
  toolLoaded: boolean | null;
  loadedToHub: boolean | null;
  spoolId: number | null;
  runoutLane: string | null;
}

export interface AfcSnapshot {
  currentLoad: string | null;
  currentState: string | null;
  error: boolean | null;
  bypass: boolean | null;
  message: string | null;
  messageTone: string | null;
  units: string[];
  hubs: string[];
  buffers: string[];
  extruders: string[];
  lanes: AfcLane[];
}

export type AfcCommand =
  | { kind: 'afc_change_tool'; lane: string }
  | { kind: 'afc_load'; lane: string }
  | { kind: 'afc_unload'; lane: string | null }
  | { kind: 'afc_clear_message' };
