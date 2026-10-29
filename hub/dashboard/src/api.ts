// Thin fetch wrapper. The token lives in localStorage on the web; the Capacitor app
// will keep it in Keychain / Keystore behind biometric unlock instead.
const TOKEN_KEY = 'sw6.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked: the session lasts until reload
  }
  window.dispatchEvent(new Event('sw6-auth'));
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) setToken(null);
    throw new ApiError(res.status, data.error ?? 'request_failed');
  }
  return data as T;
}

export type Site = { id: string; name: string; type: string; role: string };
export type Me = { user: { id: string; name: string; phone: string }; sites: Site[] };
