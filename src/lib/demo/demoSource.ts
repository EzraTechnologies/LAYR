import { assembleState } from '../printer/assemble';
import type { PrinterState } from '../printer/model';
import type { PrinterSource } from '../printer/source';
import { demoScenario, type DemoScenarioId } from './scenarios';

/**
 * Static, deterministic demo source. It never opens sockets, makes HTTP requests or starts timers, so demo
 * output is identical on every run and cannot reach a real printer.
 */
export class DemoSource implements PrinterSource {
  readonly kind = 'demo' as const;
  readonly printerId = 'demo';
  #scenario: DemoScenarioId;
  #onState: ((state: PrinterState) => void) | null = null;

  constructor(scenario: DemoScenarioId) {
    this.#scenario = scenario;
  }

  get scenario(): DemoScenarioId {
    return this.#scenario;
  }

  start(onState: (state: PrinterState) => void): void {
    this.#onState = onState;
    this.#emit();
  }

  stop(): void {
    this.#onState = null;
  }

  setScenario(scenario: DemoScenarioId): void {
    this.#scenario = scenario;
    this.#emit();
  }

  #emit(): void {
    this.#onState?.(assembleState(demoScenario(this.#scenario)));
  }
}
