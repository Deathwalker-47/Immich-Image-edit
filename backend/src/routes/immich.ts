import { Router, Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';

const router = Router();

const getImmichClient = () => {
  const baseURL = process.env.IMMICH_INTERNAL_URL || 'http://immich-server:2283';
  const apiKey = process.env.IMMICH_API_KEY || '';
  return axios.create({
    baseURL: `${baseURL}/api`,
    headers: {
      'x-api-key': apiKey,
      'Accept': 'application/json',
    },
    timeout: 30000,
  });
};

// GET /api/immich/albums — list all albums
router.get('/albums', async (_req: Request, res: Response) => {
  try {
    const client = getImmichClient();
    const { data } = await client.get('/albums');
    res.json(data);
  } catch (err: any) {
    console.error('[Immich] GET /albums error:', err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// Immich caps a single search page at 1000. Albums larger than that need paging.
const ALBUM_PAGE_SIZE = 1000;
// Safety stop so a pathologically large album can't spin here forever. If it trips
// we log it — a silently truncated album would look identical to a complete one.
const ALBUM_MAX_ASSETS = 5000;

// GET /api/immich/albums/:id — album metadata plus its (image) assets
router.get('/albums/:id', async (req: Request, res: Response) => {
  try {
    const client = getImmichClient();
    const albumId = req.params.id;

    // GET /albums/:id no longer returns an `assets` array on current Immich —
    // verified live: with `?withoutAssets=false`, `?withoutAssets=true`, and with
    // no parameter at all, the response carries `assetCount` but no `assets` key.
    // It is the same class of breakage as the removed getAllAssets endpoint that
    // killed the timeline (see the /timeline handler below): the album kept
    // *loading* while showing zero photos, so it read as a rendering bug rather
    // than an API change. Assets now come from search/metadata — the same
    // endpoint the timeline uses — filtered by albumIds.
    const { data: album } = await client.get(`/albums/${albumId}`);

    const assets: any[] = [];
    let page = 1;
    let truncated = false;

    while (true) {
      const { data } = await client.post('/search/metadata', {
        albumIds: [albumId],
        page,
        size: ALBUM_PAGE_SIZE,
        // This is a photo editor — videos in an album are not editable, so they
        // are filtered out here rather than rendered as dead tiles.
        type: 'IMAGE',
        order: 'desc',
        withExif: false,
      });

      const bucket = data?.assets;
      assets.push(...(bucket?.items ?? []));

      if (assets.length >= ALBUM_MAX_ASSETS) {
        truncated = true;
        break;
      }
      // Immich returns nextPage: null on the final page.
      const next = bucket?.nextPage;
      if (!next) break;
      page = Number(next);
      if (!Number.isFinite(page)) break;
    }

    if (truncated) {
      console.warn(
        `[Immich] Album ${albumId} exceeded ${ALBUM_MAX_ASSETS} images; returning a truncated list.`
      );
    }

    res.json({ ...album, assets, assetsTruncated: truncated });
  } catch (err: any) {
    console.error('[Immich] GET /albums/:id error:', err.message, err.response?.data);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/immich/timeline — get recent assets
router.get('/timeline', async (req: Request, res: Response) => {
  try {
    const client = getImmichClient();
    const page = Number(req.query.page) || 1;
    const size = Number(req.query.size) || 50;

    // POST /search/metadata, NOT GET /assets?page=&size=. The latter is the
    // long-removed getAllAssets endpoint (dropped in immich-app/immich#9715);
    // on current Immich it 404s, which is the likely real cause of the
    // "Failed to load photos" dead-end described in HANDOFF.md §6.5 — that was
    // characterised as an intermittent failure, but a removed endpoint fails
    // every time for the "Recent Photos" view while albums keep working, which
    // presents the same way. search/metadata is the documented replacement and
    // is the same endpoint verified working in the sibling bridge project.
    const { data } = await client.post('/search/metadata', {
      page,
      size,
      order: 'desc',
      type: 'IMAGE',
      withExif: false,
    });

    // search/metadata nests results as { assets: { items: [...] } }. Normalise to
    // a plain array here so the frontend gets one predictable shape.
    const items = data?.assets?.items ?? data?.items ?? data;
    res.json(Array.isArray(items) ? items : []);
  } catch (err: any) {
    console.error('[Immich] GET /timeline error:', err.message, err.response?.data);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/immich/assets/:id — asset info
router.get('/assets/:id', async (req: Request, res: Response) => {
  try {
    const client = getImmichClient();
    const { data } = await client.get(`/assets/${req.params.id}`);
    res.json(data);
  } catch (err: any) {
    console.error('[Immich] GET /assets/:id error:', err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/immich/assets/:id/thumbnail — proxy thumbnail
router.get('/assets/:id/thumbnail', async (req: Request, res: Response) => {
  try {
    const client = getImmichClient();
    const size = req.query.size || 'thumbnail';
    const response = await client.get(`/assets/${req.params.id}/thumbnail?size=${size}`, {
      responseType: 'stream',
    });
    res.set('Content-Type', (response.headers['content-type'] as string) || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    response.data.pipe(res);
  } catch (err: any) {
    console.error('[Immich] GET thumbnail error:', err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/immich/assets/:id/original — proxy original image
router.get('/assets/:id/original', async (req: Request, res: Response) => {
  try {
    const client = getImmichClient();
    const response = await client.get(`/assets/${req.params.id}/original`, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    const contentType = (response.headers['content-type'] as string) || 'image/jpeg';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(response.data));
  } catch (err: any) {
    console.error('[Immich] GET original error:', err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// POST /api/immich/upload — upload edited image back to Immich
router.post('/upload', async (req: Request, res: Response) => {
  try {
    const { imageBase64, filename, albumId, deviceAssetId } = req.body;

    if (!imageBase64) {
      res.status(400).json({ error: 'imageBase64 is required' });
      return;
    }

    const client = getImmichClient();

    // Convert base64 to buffer
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Determine content type
    const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const ext = mimeType.split('/')[1];

    const assetFilename = filename || `ai-edit-${Date.now()}.${ext}`;
    const assetDeviceId = deviceAssetId || `immich-ai-editor-${Date.now()}`;

    const formData = new FormData();
    formData.append('assetData', imageBuffer, {
      filename: assetFilename,
      contentType: mimeType,
    });
    formData.append('deviceAssetId', assetDeviceId);
    formData.append('deviceId', 'immich-ai-editor');
    formData.append('fileCreatedAt', new Date().toISOString());
    formData.append('fileModifiedAt', new Date().toISOString());
    formData.append('isFavorite', 'false');

    const uploadResponse = await client.post('/assets', formData, {
      headers: {
        ...formData.getHeaders(),
      },
      maxBodyLength: Infinity,
    });

    const newAssetId = uploadResponse.data.id;

    // If albumId specified, add to that album
    if (albumId && newAssetId) {
      try {
        await client.put(`/albums/${albumId}/assets`, { ids: [newAssetId] });
      } catch (albumErr: any) {
        console.warn('[Immich] Could not add to album:', albumErr.message);
      }
    } else if (newAssetId) {
      // Try to add to AI Edits album
      await ensureAndAddToAiEditsAlbum(client, newAssetId);
    }

    res.json({ success: true, assetId: newAssetId, data: uploadResponse.data });
  } catch (err: any) {
    console.error('[Immich] POST /upload error:', err.message, err.response?.data);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

async function ensureAndAddToAiEditsAlbum(client: ReturnType<typeof getImmichClient>, assetId: string) {
  const albumName = process.env.AI_EDITS_ALBUM_NAME || 'AI Edits';
  try {
    const { data: albums } = await client.get('/albums');
    let aiAlbum = albums.find((a: any) => a.albumName === albumName);

    if (!aiAlbum) {
      const { data: created } = await client.post('/albums', {
        albumName,
        description: 'Photos edited with Immich AI Photo Editor',
      });
      aiAlbum = created;
    }

    if (aiAlbum?.id) {
      await client.put(`/albums/${aiAlbum.id}/assets`, { ids: [assetId] });
    }
  } catch (err: any) {
    console.warn('[Immich] ensureAndAddToAiEditsAlbum error:', err.message);
  }
}

// GET /api/immich/search — search assets
router.get('/search', async (req: Request, res: Response) => {
  try {
    const client = getImmichClient();
    const { q, page = 1, size = 50 } = req.query;
    const { data } = await client.post('/search/smart', {
      query: q,
      page: Number(page),
      size: Number(size),
    });
    res.json(data);
  } catch (err: any) {
    console.error('[Immich] GET /search error:', err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

export { router as immichRouter };
