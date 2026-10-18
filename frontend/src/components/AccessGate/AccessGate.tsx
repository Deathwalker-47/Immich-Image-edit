import React, { useEffect, useRef, useState } from 'react';
import { fetchAuthStatus, unlock } from '../../api/auth';

type Phase = 'checking' | 'locked' | 'open' | 'not-configured' | 'unreachable';

/**
 * The key from a #key=… fragment. Not URLSearchParams: that decodes '+' as a
 * space, and base64 keys contain '+', so a pasted key would silently stop
 * matching.
 */
function readHashKey(): string | null {
  const match = window.location.hash.match(/[#&]key=([^&]*)/);
  if (!match || !match[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Holds the app back until the browser has a session cookie.
 *
 * Children mount only once unlocked, so their mount-time loads (settings, the
 * ?assetId= deep link the Android app opens) run with the cookie in place. The
 * URL is left untouched, which is what lets the app's WebView land straight in
 * the editor for its photo after the one-time unlock.
 */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // StrictMode runs effects twice in dev; the first run consumes the #key= link.
  const started = useRef(false);

  const checkStatus = async (quiet = false) => {
    if (!quiet) setPhase('checking');
    try {
      const status = await fetchAuthStatus();
      setPhase(!status.configured ? 'not-configured' : status.authenticated ? 'open' : 'locked');
    } catch (err: any) {
      setError(err.message);
      setPhase('unreachable');
    }
  };

  // A /#key=… bookmark unlocks in one step. The fragment is never sent to the
  // server, so the key stays out of every proxy log; it is still stripped from
  // the address bar at once so it doesn't sit in history.
  const consumeHashKey = async () => {
    const hashKey = readHashKey();
    if (!hashKey) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    try {
      await unlock(hashKey);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      await consumeHashKey();
      await checkStatus();
    })();
  }, []);

  // Pasting the link into a tab already on this page only changes the hash —
  // no reload, so the mount-time check above never sees it. Re-checked quietly:
  // flashing the spinner would unmount an app that may already be open.
  useEffect(() => {
    const onHashChange = async () => {
      if (!readHashKey()) return;
      await consumeHashKey();
      await checkStatus(true);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unlock(key.trim());
      setPhase('open');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'open') return <>{children}</>;

  if (phase === 'checking') {
    return (
      <div className="access-gate">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="access-gate">
      <form className="access-gate-card" onSubmit={handleSubmit} id="access-gate-form">
        <div className="access-gate-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-accent)" strokeWidth="2">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
          </svg>
        </div>

        {phase === 'locked' && (
          <>
            <div className="access-gate-title">This editor is private</div>
            <div className="access-gate-desc">
              Enter the access key to continue. Each device only needs it once.
            </div>
            {/* Gives password managers a name to file the key under. */}
            <input type="text" name="username" autoComplete="username" value="gedit" readOnly style={{ display: 'none' }} />
            <input
              id="access-key-input"
              className="form-input"
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="Access key"
              autoFocus
              value={key}
              onChange={e => setKey(e.target.value)}
            />
            {error && <div className="access-gate-error">{error}</div>}
            <button className="btn btn-primary" type="submit" disabled={busy || !key.trim()} id="access-gate-unlock">
              {busy ? <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : null}
              Unlock
            </button>
          </>
        )}

        {phase === 'not-configured' && (
          <>
            <div className="access-gate-title">Editor locked</div>
            <div className="access-gate-desc">
              The server has no access key set, so it is refusing every request. Add EDITOR_ACCESS_KEY to its
              .env file and restart it.
            </div>
          </>
        )}

        {phase === 'unreachable' && (
          <>
            <div className="access-gate-title">Can't reach the editor</div>
            <div className="access-gate-desc">{error}</div>
            <button className="btn btn-primary" type="button" onClick={() => { setError(null); checkStatus(); }}>
              Try again
            </button>
          </>
        )}
      </form>
    </div>
  );
}
