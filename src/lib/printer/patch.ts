function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Copies `next` into `target` in place, writing only values that actually changed. Applied to a Svelte
 * `$state` proxy this means a status update that only moves the nozzle temperature only re-renders the
 * nozzle readout. Returns the number of leaf writes performed (useful in tests).
 */
export function patchInPlace(target: Record<string, unknown>, next: Record<string, unknown>): number {
  let writes = 0;
  for (const key of Object.keys(target)) {
    if (!(key in next)) {
      delete target[key];
      writes += 1;
    }
  }
  for (const [key, value] of Object.entries(next)) {
    const current = target[key];
    if (isRecord(value) && isRecord(current)) {
      writes += patchInPlace(current, value);
    } else if (Array.isArray(value) && Array.isArray(current) && value.length === current.length) {
      value.forEach((item, i) => {
        if (isRecord(item) && isRecord(current[i])) {
          writes += patchInPlace(current[i] as Record<string, unknown>, item);
        } else if (!Object.is(current[i], item)) {
          current[i] = item;
          writes += 1;
        }
      });
    } else if (!Object.is(current, value)) {
      target[key] = value;
      writes += 1;
    }
  }
  return writes;
}
