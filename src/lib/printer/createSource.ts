import { activePrinter, type AppConfig } from '../config';
import { LiveSource } from './liveSource';
import { createInitialState } from './model';
import { UnconfiguredSource, type PrinterSource } from './source';

/**
 * Selects the data source. Without a configured Moonraker URL nothing connects anywhere: the UI stays in the
 * "not set up" state until the user saves an endpoint. There is no demo or sample-data fallback.
 */
export function createSource(config: AppConfig): PrinterSource {
  const printer = activePrinter(config);
  if (!printer.moonrakerUrl) {
    return new UnconfiguredSource(createInitialState(printer.id, printer.name || 'LAYR', Date.now(), false));
  }
  return new LiveSource({ ...printer, moonrakerUrl: printer.moonrakerUrl });
}
