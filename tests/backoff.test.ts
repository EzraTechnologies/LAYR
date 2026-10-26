import { describe, expect, it } from 'vitest';
import { Backoff, DEFAULT_BACKOFF } from '../src/lib/moonraker/backoff';

describe('Backoff', () => {
  it('grows exponentially up to the cap', () => {
    const b = new Backoff({ initialMs: 500, maxMs: 5000, factor: 2, jitter: 0 });
    expect(Array.from({ length: 7 }, () => b.next())).toEqual([500, 1000, 2000, 4000, 5000, 5000, 5000]);
    expect(b.attempt).toBe(7);
  });

  it('resets to the initial delay', () => {
    const b = new Backoff({ jitter: 0 });
    b.next();
    b.next();
    b.reset();
    expect(b.attempt).toBe(0);
    expect(b.next()).toBe(DEFAULT_BACKOFF.initialMs);
  });

  it('applies jitter downwards only, so delays never exceed the cap', () => {
    const b = new Backoff({ initialMs: 1000, maxMs: 4000, jitter: 0.5 }, () => 1);
    expect([b.next(), b.next(), b.next(), b.next()]).toEqual([500, 1000, 2000, 2000]);
    const r = new Backoff({ initialMs: 1000, maxMs: 4000, jitter: 0.5 }, Math.random);
    for (let i = 0; i < 100; i++) expect(r.next()).toBeLessThanOrEqual(4000);
  });

  it('stays finite during very long outages', () => {
    const b = new Backoff({ jitter: 0 });
    for (let i = 0; i < 10_000; i++) b.next();
    expect(b.next()).toBe(DEFAULT_BACKOFF.maxMs);
  });

  it('rejects invalid options', () => {
    expect(() => new Backoff({ initialMs: 0 })).toThrow();
    expect(() => new Backoff({ initialMs: 100, maxMs: 50 })).toThrow();
    expect(() => new Backoff({ factor: 0.5 })).toThrow();
  });
});
