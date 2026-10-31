/** A deadline covers both fetch headers and body consumption, even for an uncooperative transport. */
export async function boundedHttp<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  controller: AbortController,
  caller?: AbortSignal,
): Promise<T> {
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason ?? new DOMException('HTTP request cancelled', 'AbortError'));
  const cancel = () => controller.abort(new DOMException('HTTP request cancelled', 'AbortError'));
  controller.signal.addEventListener('abort', onAbort, { once: true });
  caller?.addEventListener('abort', cancel, { once: true });
  if (caller?.aborted) cancel();
  if (controller.signal.aborted) onAbort();
  const timer = setTimeout(() => controller.abort(new Error('Moonraker HTTP request timed out')), timeoutMs);
  try {
    return await Promise.race([
      aborted,
      Promise.resolve().then(async () => {
        controller.signal.throwIfAborted();
        const result = await operation(controller.signal);
        controller.signal.throwIfAborted();
        return result;
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', onAbort);
    caller?.removeEventListener('abort', cancel);
  }
}
