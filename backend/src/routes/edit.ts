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

export { router as editRouter };
