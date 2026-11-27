export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : JSON.stringify(err);
}

export function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** Błąd z komunikatem przeznaczonym dla panelu (HTTP 4xx). */
export class UserError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Błąd wykonania, który można ponowić (np. timeout sieci, 429). */
export class RetryableError extends Error {}

export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 8000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { accept: 'application/json', 'user-agent': 'SolDesk/0.1', ...(rest.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new RetryableError(`Błąd sieci: ${errorMessage(err)}`);
  }
  if (res.status === 429 || res.status >= 500) {
    throw new RetryableError(`HTTP ${res.status} z ${new URL(url).host}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status} z ${new URL(url).host}: ${body.slice(0, 200)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}
