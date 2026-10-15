export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('np-unauth'));
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T,>(url: string) => req<T>('GET', url),
  post: <T,>(url: string, body: unknown = {}) => req<T>('POST', url, body),
  patch: <T,>(url: string, body: unknown) => req<T>('PATCH', url, body),
  del: <T,>(url: string) => req<T>('DELETE', url),
};

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');