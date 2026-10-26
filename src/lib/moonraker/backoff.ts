export interface BackoffOptions {
  /** Delay before the first retry, in ms. */
  initialMs: number;
  /** Upper bound for any single delay, in ms. */
  maxMs: number;
  /** Multiplier applied after each failure. */
  factor: number;
  /** Fraction (0..1) of random jitter subtracted from each delay to avoid thundering herds. */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  initialMs: 1000,
  maxMs: 30_000,
  factor: 2,
  jitter: 0.2,
};

/**
 * Bounded exponential backoff. Delays grow `initialMs * factor^n` and never exceed `maxMs`.
 * `random` is injectable so tests are deterministic.
 */
export class Backoff {
  #attempt = 0;
  readonly options: BackoffOptions;
  readonly #random: () => number;

  constructor(options: Partial<BackoffOptions> = {}, random: () => number = Math.random) {
    this.options = { ...DEFAULT_BACKOFF, ...options };
    if (this.options.initialMs <= 0 || this.options.maxMs < this.options.initialMs || this.options.factor < 1) {
      throw new Error('Invalid backoff options');
    }
    this.options.jitter = Math.min(Math.max(this.options.jitter, 0), 1);
    this.#random = random;
  }

  /** Number of delays handed out since the last reset. */
  get attempt(): number {
    return this.#attempt;
  }

  /** Returns the delay for the next retry and advances the attempt counter. */
  next(): number {
    const { initialMs, maxMs, factor, jitter } = this.options;
    // Cap the exponent so the intermediate value stays finite for very long outages.
    const exp = Math.min(this.#attempt, 32);
    const base = Math.min(maxMs, initialMs * Math.pow(factor, exp));
    this.#attempt += 1;
    const delay = base - base * jitter * this.#random();
    return Math.max(0, Math.round(delay));
  }

  reset(): void {
    this.#attempt = 0;
  }
}
