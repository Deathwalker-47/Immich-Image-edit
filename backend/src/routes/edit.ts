import { Router, Request, Response } from 'express';
import { runEdit } from '../providers';

const router = Router();

/**
 * POST /api/edit
 * Body: {
 *   imageUrl: string,        // URL to the source image (must be accessible by backend)
 *   imageBase64?: string,    // Alternative: base64 encoded image
 *   prompt: string,          // Text description of the edit
 *   provider: string,        // 'fal' | 'runware' | 'replicate' | 'atlas'
 *   model?: string,          // Optional model override
 *   strength?: number,       // 0.1 - 1.0, default 0.75
 *   negativePrompt?: string, // What to avoid
 *   steps?: number,          // Inference steps (default 30)
 * }
 */
router.post('/', async (req: Request, res: Response) => {
  const {
    imageUrl,
    imageBase64,
    prompt,
    provider,
    model,
    strength = 0.75,
    negativePrompt = 'blurry, low quality, artifacts, watermark',
    steps = 30,
  } = req.body;

  if (!prompt) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  if (!imageUrl && !imageBase64) {
    res.status(400).json({ error: 'imageUrl or imageBase64 is required' });
    return;
  }

  if (!provider) {
    res.status(400).json({ error: 'provider is required (fal | runware | replicate | atlas)' });
    return;
  }

  try {
    console.log(`[Edit] Starting edit — provider: ${provider}, model: ${model || 'default'}`);
    console.log(`[Edit] Prompt: "${prompt.substring(0, 80)}..."`);

    const result = await runEdit({
      imageUrl,
      imageBase64,
      prompt,
      provider,
      model,
      strength,
      negativePrompt,
      steps,
    });

    console.log(`[Edit] Success — provider: ${provider}`);
    res.json(result);
  } catch (err: any) {
    console.error(`[Edit] Error with provider ${provider}:`, err.message);
    res.status(500).json({
      error: err.message || 'Edit failed',
      provider,
      details: err.response?.data || err.details || undefined,
    });
  }
});

export { router as editRouter };
