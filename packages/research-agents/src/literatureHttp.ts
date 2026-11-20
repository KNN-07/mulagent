// @effect-diagnostics-next-line nodeBuiltinImport:off - The Promise-based fetch queue can run without an Effect runtime.
import * as NodeTimersPromises from "node:timers/promises";
import * as DateTime from "effect/DateTime";

const now = () => DateTime.toEpochMillis(DateTime.nowUnsafe());

export interface LiteratureHttpOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly intervalMs?: number;
  readonly retries?: number;
  readonly timeoutMs?: number;
}

export function literatureHttp(options: LiteratureHttpOptions, intervalMs: number) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const retries = options.retries ?? 3;
  const spacing = options.intervalMs ?? intervalMs;
  const timeout = options.timeoutMs ?? 30_000;
  if (
    ![retries, spacing, timeout].every((value) => Number.isSafeInteger(value) && value >= 0) ||
    timeout === 0
  ) {
    throw new Error(
      "Literature HTTP options require nonnegative integer retries and spacing, and a positive timeout",
    );
  }
  let queue = Promise.resolve();
  let nextRequest = 0;

  return async (url: URL, headers?: HeadersInit, signal?: AbortSignal): Promise<string> => {
    const attempt = async (remaining: number): Promise<string> => {
      signal?.throwIfAborted();
      const wait = nextRequest - now();
      if (wait > 0) await NodeTimersPromises.setTimeout(wait, undefined, signal ? { signal } : {});
      nextRequest = now() + spacing;
      const deadline = AbortSignal.timeout(timeout);
      const init = {
        ...(headers ? { headers } : {}),
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      };
      let response: Response;
      try {
        response = await fetcher(url, init);
        if (response.ok) return await response.text();
      } catch (error) {
        signal?.throwIfAborted();
        if (remaining === 0)
          throw new Error(`Literature request to ${url.hostname} failed`, { cause: error });
        nextRequest = Math.max(nextRequest, now() + 500 * 2 ** (retries - remaining));
        return attempt(remaining - 1);
      }
      await response.body?.cancel();
      if (remaining === 0 || (response.status !== 429 && response.status < 500)) {
        throw new Error(
          `Literature request to ${url.hostname} failed with HTTP ${response.status}`,
        );
      }
      const header = response.headers.get("Retry-After");
      const retryAfterMs =
        header === null
          ? 0
          : /^\d+$/.test(header)
            ? Number(header) * 1_000
            : Date.parse(header) - now() || 0;
      nextRequest = Math.max(
        nextRequest,
        now() + retryAfterMs,
        now() + 500 * 2 ** (retries - remaining),
      );
      return attempt(remaining - 1);
    };

    const request = queue.then(() => attempt(retries));
    queue = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  };
}

export function literatureUrl(base: string, params: Record<string, string | number>): URL {
  const url = new URL(base);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  return url;
}
