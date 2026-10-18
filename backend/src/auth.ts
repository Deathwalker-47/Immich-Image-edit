import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Access-key auth for the public deployment.
 *
 * Before this, every /api route answered anyone who found the URL: the whole
 * Immich library could be browsed and downloaded, provider credit spent, and
 * files uploaded into Immich. Now one long random key (EDITOR_ACCESS_KEY)
 * unlocks the editor. Entering it sets a signed HttpOnly cookie, and every /api
 * route except /api/auth requires that cookie.
 *
 * Why a cookie and not a header or nginx basic auth:
 * - The frontend loads photos with plain <img src="/api/immich/..."> tags, which
 *   cannot carry an Authorization header. Same-origin cookies ride along on
 *   every request, images included.
 * - The Immich Android app opens the editor in url_launcher's WebViewActivity at
 *   a fixed /?assetId= URL. That activity never handles
 *   onReceivedHttpAuthRequest, so a basic-auth challenge just renders a 401 page,
 *   and the URL has no way to carry a credential. The WebView does keep
 *   first-party cookies, so the key is entered once per device and the existing
 *   APK keeps working without a rebuild.
 *
 * The cookie holds an expiry and an HMAC of it keyed by the access key, never
 * the key itself. Rotating EDITOR_ACCESS_KEY therefore logs out every device.
 */

const COOKIE_NAME = 'gedit_session';
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_MS = 365 * DAY_MS;
// Re-issue a cookie once it is a month old, so a device in regular use never
// reaches the expiry and gets asked for the key again.
const REFRESH_AFTER_MS = 30 * DAY_MS;
// `openssl rand -hex 32` gives 64 characters. Anything much shorter is a
// password, not a key, and would make the brute-force math below matter.
const MIN_KEY_LENGTH = 32;

// Failed unlocks are counted globally, not per client: behind two nginx hops
// every request arrives from the same proxy address, and X-Forwarded-For is
// client-controlled. A tripped limit only blocks new unlocks for a minute —
// devices that already hold a cookie are unaffected.
const FAIL_WINDOW_MS = 60_000;
const MAX_FAILS_PER_WINDOW = 20;
const FAIL_DELAY_MS = 1000;
let failWindowStart = 0;
let failCount = 0;

/** Read lazily: index.ts runs dotenv.config() after its imports are evaluated. */
function accessKey(): string | null {
  const key = process.env.EDITOR_ACCESS_KEY || '';
  return key.length >= MIN_KEY_LENGTH ? key : null;
}

export function accessKeyConfigured(): boolean {
  return accessKey() !== null;
}

function signature(expires: number, key: string): string {
  return crypto.createHmac('sha256', key).update(`gedit-session:v1:${expires}`).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  // Hash first so the comparison is constant-time even when lengths differ.
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Returns the session's expiry (ms) when the cookie is valid, otherwise null. */
function verifySession(value: string | null, key: string): number | null {
  if (!value) return null;
  const [version, expRaw, sig] = value.split('.');
  if (version !== 'v1' || !expRaw || !sig) return null;
  const expires = Number(expRaw);
  const now = Date.now();
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + SESSION_MS + DAY_MS) return null;
  return safeEqual(sig, signature(expires, key)) ? expires : null;
}

function issueSession(res: Response, key: string): void {
  const expires = Date.now() + SESSION_MS;
  res.cookie(COOKIE_NAME, `v1.${expires}.${signature(expires, key)}`, {
    httpOnly: true,
    // Always Secure: production is HTTPS at the host vhost, and browsers treat
    // http://localhost as a secure context, so local dev still works.
    // X-Forwarded-Proto can't be used to decide — the inner nginx overwrites it
    // with its own (http) scheme.
    secure: true,
    // Lax still sends the cookie on the app's top-level WebView load and on
    // every same-origin fetch, but not on cross-site POSTs.
    sameSite: 'lax',
    maxAge: SESSION_MS,
    path: '/',
  });
}

/**
 * Providers fetch internal image paths from this backend over HTTP loopback
 * (see resolveImageInput in providers/atlas.ts and its siblings), without the
 * caller's cookie. Only this process can originate those: browser traffic
 * arrives via the frontend nginx container, and the published host port is
 * NATed in from the Docker bridge gateway, so neither shows a loopback address.
 */
function isLoopback(req: Request): boolean {
  const addr = req.socket.remoteAddress || '';
  return addr.startsWith('127.') || addr.startsWith('::ffff:127.') || addr === '::1';
}

export function requireAccess(req: Request, res: Response, next: NextFunction): void {
  if (isLoopback(req)) {
    next();
    return;
  }

  const key = accessKey();
  if (!key) {
    // Fail closed: a missing key must not quietly reopen the editor to everyone.
    res.status(503).json({
      error: 'The editor is locked: EDITOR_ACCESS_KEY is not set on the server.',
      code: 'AUTH_NOT_CONFIGURED',
    });
    return;
  }

  const expires = verifySession(readCookie(req, COOKIE_NAME), key);
  if (expires === null) {
    res.status(401).json({ error: 'Unlock the editor with its access key.', code: 'AUTH_REQUIRED' });
    return;
  }

  if (expires - Date.now() < SESSION_MS - REFRESH_AFTER_MS) issueSession(res, key);
  next();
}

const router = Router();

// GET /api/auth/status — lets the frontend decide between the app and the unlock screen
router.get('/status', (req: Request, res: Response) => {
  const key = accessKey();
  res.set('Cache-Control', 'no-store');
  res.json({
    configured: key !== null,
    authenticated: key !== null && verifySession(readCookie(req, COOKIE_NAME), key) !== null,
  });
});

// POST /api/auth/login — exchange the access key for a session cookie
router.post('/login', async (req: Request, res: Response) => {
  const key = accessKey();
  if (!key) {
    res.status(503).json({
      error: 'The editor is locked: EDITOR_ACCESS_KEY is not set on the server.',
      code: 'AUTH_NOT_CONFIGURED',
    });
    return;
  }

  const now = Date.now();
  if (now - failWindowStart > FAIL_WINDOW_MS) {
    failWindowStart = now;
    failCount = 0;
  }
  if (failCount >= MAX_FAILS_PER_WINDOW) {
    res.status(429).json({ error: 'Too many wrong keys. Try again in a minute.' });
    return;
  }

  const supplied = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  if (!supplied || !safeEqual(supplied, key)) {
    failCount++;
    console.warn(`[Auth] Rejected access key (${failCount} in the current minute)`);
    await new Promise(resolve => setTimeout(resolve, FAIL_DELAY_MS));
    res.status(401).json({ error: 'That access key is not right.' });
    return;
  }

  issueSession(res, key);
  res.json({ success: true });
});

export { router as authRouter };
