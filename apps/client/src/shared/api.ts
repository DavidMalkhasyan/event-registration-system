// Same-origin JSON API client. Cookies are HttpOnly and sent by the browser; the CSRF token and
// link tokens are passed explicitly and only ever kept in memory (ADR-010, ADR-011).

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown>,
  ) {
    super(code);
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  body?: unknown;
  csrf?: string;
  linkToken?: string | null;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.csrf) headers['x-csrf-token'] = options.csrf;
  if (options.linkToken !== undefined) headers.authorization = `Link ${options.linkToken ?? ''}`;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'network_error', {});
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(response.status, String(body.code ?? 'error'), body);
  return body as T;
}

export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  if (error.code === 'invalid_link') return 'This link is not valid or has expired.';
  if (error.code === 'network_error')
    return 'The server cannot be reached. Please check your connection and try again.';
  const title = typeof error.body.title === 'string' ? error.body.title : 'The request failed';
  const extra =
    error.code === 'validation_failed' && Array.isArray(error.body.errors)
      ? ` (${(error.body.errors as { field: string }[]).map((e) => e.field).join(', ')})`
      : '';
  return `${title}${extra}.`;
}
