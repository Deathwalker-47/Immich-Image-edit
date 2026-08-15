/**
 * Fetching provider result images server-side.
 *
 * Every provider returns its result as a URL on its own CDN, and none of those
 * responses carry an Access-Control-Allow-Origin header — verified against
 * Atlas's Alibaba OSS bucket, which serves the image happily to curl but sends
 * no CORS header at all. So the browser cannot fetch these itself. Both places
 * that need the bytes (downloading the file, and saving the edit back into
 * Immich) go through here instead, where CORS does not apply.
 */

/**
 * Hosts whose images may be fetched on a caller's behalf.
 *
 * This is an allowlist and must stay one. These fetches originate inside the
 * container, which sits on the immich_default docker network, so an
 * unrestricted version could be pointed at http://immich-server:2283, the cloud
 * metadata endpoint, or anything else reachable from here — and would hand the
 * response back to the caller. Matching is exact-host or dot-suffix, so
 * "evil-fal.media" cannot pass itself off as "fal.media".
 */
export const PROVIDER_RESULT_HOSTS = [
  'im.runware.ai',                          // Runware
  'atlas-media.oss-us-west-1.aliyuncs.com', // Atlas Cloud
  'replicate.delivery',                     // Replicate
  'fal.media',                              // Fal
];

export function isProviderResultHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return PROVIDER_RESULT_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

export class ProviderImageError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Validate a provider result URL and fetch its bytes.
 *
 * Throws ProviderImageError with an appropriate HTTP status rather than a bare
 * Error, so callers can pass the status straight through instead of flattening
 * a refused host into a generic 500.
 */
export async function fetchProviderImage(
  rawUrl: string
): Promise<{ buffer: Buffer; contentType: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ProviderImageError('Not a valid absolute URL', 400);
  }

  if (parsed.protocol !== 'https:') {
    throw new ProviderImageError('Only https URLs can be fetched', 400);
  }
  if (!isProviderResultHost(parsed.hostname)) {
    throw new ProviderImageError(
      `Refusing to fetch ${parsed.hostname}. Only provider result hosts are allowed.`,
      403
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString());
  } catch (err: any) {
    throw new ProviderImageError(`Could not reach ${parsed.hostname}: ${err.message}`, 502);
  }

  if (!upstream.ok) {
    throw new ProviderImageError(
      `Provider returned ${upstream.status} for the result image`,
      upstream.status
    );
  }

  return {
    buffer: Buffer.from(await upstream.arrayBuffer()),
    contentType: upstream.headers.get('content-type') || 'image/jpeg',
  };
}
