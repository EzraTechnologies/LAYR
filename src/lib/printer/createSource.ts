import { activePrinter, type AppConfig } from '../config';
import { createCommandGateway, type CommandGateway } from '../actions/commands';
import { DemoSource } from '../demo/demoSource';
import { LiveSource } from './liveSource';
import type { PrinterSource } from './source';

export interface SourceBundle {
  source: PrinterSource;
  commands: CommandGateway;
}

/** Selects the data source and command gateway for the configured mode. Demo never constructs a live client. */
export function createSourceBundle(config: AppConfig): SourceBundle {
  if (config.demo) {
    return { source: new DemoSource(config.demo), commands: createCommandGateway('demo') };
  }
  return { source: new LiveSource(activePrinter(config)), commands: createCommandGateway('live') };
}
