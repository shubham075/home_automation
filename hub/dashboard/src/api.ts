// Session handling for the web app.
// - Access token (15 min) lives only in memory, so XSS cannot read a stored token.
// - Refresh token is an httpOnly cookie the browser sends to /api/auth/* only.
// The Capacitor app will send client:"native" and keep the refresh token in Keychain / Keystore.

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export const getAccessToken = () => accessToken;

function setSession(token: string | null) {
  accessToken = token;
  window.dispatchEvent(new Event('sw6-auth'));
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public data: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function post(path: string, body: unknown) {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Swaps the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= post('/api/auth/refresh', {})
    .then(async (res) => {
      if (!res.ok) {
        setSession(null);
        return false;
      }
      setSession((await res.json()).accessToken);
      return true;
    })
    .catch(() => false) // hub unreachable: keep current state, caller decides
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function login(phone: string, password: string) {
  const res = await post('/api/auth/login', { phone, password });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'request_failed', data);
  setSession(data.accessToken);
}

/** Join a home with phone + invite code; signs up new people, signs in existing ones. */
export async function acceptInvite(body: { phone: string; code: string; name?: string; password: string }) {
  const res = await post('/api/invitations/accept', body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'request_failed', data);
  setSession(data.accessToken);
}

export async function logout() {
  await post('/api/auth/logout', {}).catch(() => undefined);
  setSession(null);
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}, retried = false): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 && !retried && (await refreshSession())) return api<T>(path, init, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'request_failed', data);
  return data as T;
}

export type Site = { id: string; name: string; type: string; role: string };
export type Me = { user: { id: string; name: string; phone: string }; sites: Site[] };
