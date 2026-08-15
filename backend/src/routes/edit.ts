import { Router, Request, Response } from 'express';
import { runEdit } from '../providers';
import { buildEnhancedPrompt, catalogueForUi } from '../lora';
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER, ProviderId, getModel, isSupported } from '../models';

const router = Router();

const VALID_PROVIDERS: ProviderId[] = ['runware', 'fal', 'replicate', 'atlas'];

/**
 * POST /api/edit
 *
 * Body:
 *   imageUrl | imageBase64  the source image (one is required)
 *   prompt                  the edit instruction
 *   provider                runware | fal | replicate | atlas
 *   model                   canonical model id from models.ts
 *   loras                   [{ id | url, weight? }] — LoRA-capable models only
 *   strength, steps, cfgScale, negativePrompt   optional, applied where supported
 */
router.post('/', async (req: Request, res: Response) => {
  const {
    imageUrl,
    imageBase64,
    prompt,
    provider = DEFAULT_PROVIDER,
    model = DEFAULT_MODEL_ID,
    strength,
    negativePrompt,
    steps,
    cfgScale,
    loras = [],
  } = req.body || {};

  if (!prompt || !String(prompt).trim()) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }
  if (!imageUrl && !imageBase64) {
    res.status(400).json({ error: 'imageUrl or imageBase64 is required' });
    return;
  }
  if (!VALID_PROVIDERS.includes(provider)) {
    res.status(400).json({ error: `Unknown provider "${provider}". Valid: ${VALID_PROVIDERS.join(' | ')}` });
    return;
  }
  if (!isSupported(model, provider)) {
    const known = getModel(model);
    res.status(400).json({
      error: known
        ? `Model "${known.name}" is not available on ${provider}.`
        : `Unknown model "${model}".`,
    });
    return;
  }

  // LoRAs only mean anything on a LoRA-capable model; silently ignoring them would
  // leave the user wondering why their selection did nothing.
  const modelInfo = getModel(model);
  const selectedLoras = Array.isArray(loras) ? loras : [];
  if (selectedLoras.length && !modelInfo?.loraCapable) {
    res.status(400).json({
      error: `Model "${modelInfo?.name || model}" does not support LoRAs. Use FLUX Kontext Dev LoRA.`,
    });
    return;
  }

  // Trigger words have to reach the model or the LoRA never activates.
  const { prompt: finalPrompt, negativePrompt: loraNegative } = modelInfo?.loraCapable
    ? buildEnhancedPrompt(String(prompt), selectedLoras)
    : { prompt: String(prompt), negativePrompt: '' };

  try {
    console.log(`[Edit] ${provider} / ${model}${selectedLoras.length ? ` + ${selectedLoras.length} LoRA(s)` : ''}`);
    console.log(`[Edit] Prompt: "${finalPrompt.slice(0, 120)}"`);

    const result = await runEdit({
      imageUrl,
      imageBase64,
      prompt: finalPrompt,
      provider,
      model,
      strength,
      negativePrompt: negativePrompt || loraNegative || undefined,
      steps,
      cfgScale,
      loras: selectedLoras,
    });

    console.log(`[Edit] Success — ${provider} / ${result.model}`);
    res.json(result);
  } catch (err: any) {
    console.error(`[Edit] Failed on ${provider}:`, err.message);
    // The frontend renders this string directly, so keep it human-readable.
    res.status(502).json({
      error: err.message || 'Edit failed',
      provider,
      model,
      details: err.response?.data || err.details || undefined,
    });
  }
});

/** GET /api/edit/loras — catalogue for the LoRA picker, grouped by category. */
router.get('/loras', (_req: Request, res: Response) => {
  try {
    res.json(catalogueForUi());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Hosts whose result images may be proxied by /download.
 *
 * This is an allowlist, not a filter, and it must stay that way. The endpoint
 * fetches a caller-supplied URL from inside the container, which sits on the
 * immich_default docker network — an unrestricted version would happily fetch
 * http://immich-server:2283, the Docker/cloud metadata endpoint, or anything
 * else reachable from here and hand the body back to the browser. Matching is
 * on exact host or a dot-suffix, so "evil-fal.media" cannot pass as "fal.media".
 */
const DOWNLOADABLE_HOSTS = [
  'im.runware.ai',              // Runware
  'atlas-media.oss-us-west-1.aliyuncs.com', // Atlas
  'replicate.delivery',         // Replicate
  'fal.media',                  // Fal
];

function isDownloadableHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return DOWNLOADABLE_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

/**
 * GET /api/edit/download?url=...&filename=... — stream a provider result back
 * as an attachment.
 *
 * The browser cannot download these directly. Provider result URLs are
 * cross-origin and send no Access-Control-Allow-Origin header — confirmed
 * against Atlas's Alibaba OSS bucket, which returns the image fine to curl but
 * has no CORS header at all — so the frontend's fetch() was being blocked and
 * surfaced as a bare "Download failed". Fetching server-side sidesteps CORS
 * entirely, and returning Content-Disposition: attachment means the response is
 * a real file download rather than a blob: URL, which also gives an Android
 * WebView something it can actually handle.
 */
router.get('/download', async (req: Request, res: Response) => {
  const rawUrl = String(req.query.url || '');
  if (!rawUrl) {
    res.status(400).json({ error: 'url query parameter is required' });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: 'url is not a valid absolute URL' });
    return;
  }

  if (parsed.protocol !== 'https:') {
    res.status(400).json({ error: 'Only https URLs can be downloaded' });
    return;
  }
  if (!isDownloadableHost(parsed.hostname)) {
    res.status(403).json({
      error: `Refusing to proxy ${parsed.hostname}. Only provider result hosts can be downloaded.`,
    });
    return;
  }

  try {
    const upstream = await fetch(parsed.toString());
    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status || 502).json({
        error: `Provider returned ${upstream.status} for the result image`,
      });
      return;
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    // Strip anything path-like or quote-like out of the caller's filename — it
    // goes into a response header, so it is not a place to trust input.
    const safeName =
      String(req.query.filename || '')
        .replace(/[^A-Za-z0-9._-]/g, '')
        .slice(0, 100) || `ai-edit-${Date.now()}.jpg`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (err: any) {
    console.error('[Download] proxy error:', err.message);
    res.status(502).json({ error: `Could not fetch the result image: ${err.message}` });
  }
});

export { router as editRouter };
