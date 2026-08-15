const BASE = '/api/immich';

export interface ImmichAlbum {
  id: string;
  albumName: string;
  assetCount: number;
  albumThumbnailAssetId?: string;
  description?: string;
  createdAt?: string;
}

export interface ImmichAsset {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  originalFileName: string;
  originalPath?: string;
  fileCreatedAt: string;
  fileModifiedAt?: string;
  exifInfo?: {
    make?: string;
    model?: string;
    imageWidth?: number;
    imageHeight?: number;
  };
}

/**
 * Fetch with a small retry budget.
 *
 * The Immich timeline fetch fails intermittently, and a single failure used to
 * leave the gallery empty with no way forward. Retrying transient failures removes
 * most of those dead-ends before the UI ever has to show an error.
 *
 * Only network errors and 5xx/429 responses are retried — a 401 or 404 will not
 * fix itself, and retrying it just delays the real message.
 */
async function fetchWithRetry(url: string, attempts = 3, baseDelayMs = 400): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      // 400ms, 800ms — brief enough not to feel stalled.
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
    }

    try {
      const res = await fetch(url);
      if (res.ok) return res;

      const retriable = res.status >= 500 || res.status === 429;
      if (!retriable || attempt === attempts - 1) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err: any) {
      lastError = err;
      if (attempt === attempts - 1) throw err;
    }
  }

  throw lastError || new Error('Request failed');
}

/** Turn a non-ok response into an Error carrying the server's message. */
async function toError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  const detail = body?.detail || body?.error;
  if (res.status === 503) {
    return new Error(detail || 'Immich is unreachable from the server right now.');
  }
  return new Error(detail || `${fallback} (HTTP ${res.status})`);
}

export function getThumbnailUrl(assetId: string, size: 'thumbnail' | 'preview' = 'thumbnail'): string {
  return `${BASE}/assets/${assetId}/thumbnail?size=${size}`;
}

export function getOriginalUrl(assetId: string): string {
  return `${BASE}/assets/${assetId}/original`;
}

export async function fetchAlbums(): Promise<ImmichAlbum[]> {
  const res = await fetchWithRetry(`${BASE}/albums`);
  if (!res.ok) throw await toError(res, 'Failed to fetch albums');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function fetchAlbumAssets(albumId: string): Promise<{ assets: ImmichAsset[] } & ImmichAlbum> {
  const res = await fetchWithRetry(`${BASE}/albums/${albumId}`);
  if (!res.ok) throw await toError(res, 'Failed to fetch album');
  const data = await res.json();
  return {
    ...data,
    assets: Array.isArray(data?.assets) ? data.assets : [],
  };
}

export async function fetchAssetInfo(assetId: string): Promise<ImmichAsset> {
  const res = await fetchWithRetry(`${BASE}/assets/${assetId}`);
  if (!res.ok) throw await toError(res, 'Failed to fetch asset info');
  return res.json();
}

export async function fetchTimeline(page = 1, size = 60): Promise<ImmichAsset[]> {
  const res = await fetchWithRetry(`${BASE}/timeline?page=${page}&size=${size}`);
  if (!res.ok) throw await toError(res, 'Failed to fetch timeline');
  const data = await res.json();
  // The endpoint has returned a bare array and a paginated object at different
  // times; tolerate both, and anything else becomes an empty list rather than a
  // downstream "x.filter is not a function".
  //
  // `assets.items` is the shape Immich's search/metadata returns natively. The
  // backend now normalises it to a plain array, but this also handles it directly
  // — otherwise a nested payload reaching here would be read as a non-array and
  // silently render as "no photos found" on a successful fetch.
  if (Array.isArray(data)) return data;
  const items = data?.assets?.items ?? data?.items ?? data?.assets;
  return Array.isArray(items) ? items : [];
}

export async function uploadEditedImage(params: {
  imageBase64: string;
  filename?: string;
  albumId?: string;
}): Promise<{ assetId: string; success: boolean }> {
  const res = await fetch(`${BASE}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

export async function searchAssets(query: string): Promise<ImmichAsset[]> {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
  const data = await res.json();
  return data.assets?.items || [];
}
