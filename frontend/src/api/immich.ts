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

export function getThumbnailUrl(assetId: string, size: 'thumbnail' | 'preview' = 'thumbnail'): string {
  return `${BASE}/assets/${assetId}/thumbnail?size=${size}`;
}

export function getOriginalUrl(assetId: string): string {
  return `${BASE}/assets/${assetId}/original`;
}

export async function fetchAlbums(): Promise<ImmichAlbum[]> {
  const res = await fetch(`${BASE}/albums`);
  if (!res.ok) throw new Error(`Failed to fetch albums: ${res.statusText}`);
  return res.json();
}

export async function fetchAlbumAssets(albumId: string): Promise<{ assets: ImmichAsset[] } & ImmichAlbum> {
  const res = await fetch(`${BASE}/albums/${albumId}`);
  if (!res.ok) throw new Error(`Failed to fetch album: ${res.statusText}`);
  const data = await res.json();
  return {
    ...data,
    assets: data.assets || [],
  };
}

export async function fetchAssetInfo(assetId: string): Promise<ImmichAsset> {
  const res = await fetch(`${BASE}/assets/${assetId}`);
  if (!res.ok) throw new Error(`Failed to fetch asset info: ${res.statusText}`);
  return res.json();
}

export async function fetchTimeline(page = 1, size = 60): Promise<ImmichAsset[]> {
  const res = await fetch(`${BASE}/timeline?page=${page}&size=${size}`);
  if (!res.ok) throw new Error(`Failed to fetch timeline: ${res.statusText}`);
  const data = await res.json();
  // Handle both array and paginated response
  return Array.isArray(data) ? data : (data.assets || data.items || []);
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
