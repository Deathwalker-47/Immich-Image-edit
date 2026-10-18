export interface AuthStatus {
  /** False when the server has no EDITOR_ACCESS_KEY — nothing can unlock it. */
  configured: boolean;
  authenticated: boolean;
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth/status', { cache: 'no-store' });
  if (!res.ok) throw new Error(`The editor's server is unreachable (HTTP ${res.status})`);
  return res.json();
}

/** Exchange the access key for the session cookie. Throws with the server's reason. */
export async function unlock(key: string): Promise<void> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Unlock failed (HTTP ${res.status})`);
  }
}
