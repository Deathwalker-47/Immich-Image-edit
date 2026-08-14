import { fal } from '@fal-ai/client';
import { EditRequest, EditResult } from './index';
import { resolveModel } from '../models';
import { capForProvider, toReferences } from '../lora';

/**
 * Fal.ai provider.
 *
 * The endpoint slug comes from the registry rather than being pattern-matched out
 * of the model string — guessing endpoint shapes from substrings is what produced
 * the original "Not Found" errors.
 *
 * `enable_safety_checker: false` is deliberate and must not be removed: fal's NSFW
 * filter returns a solid black image rather than an error, which reads as a broken
 * edit.
 */
export async function editWithFal(request: EditRequest): Promise<EditResult> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error('FAL_KEY not configured');

  fal.config({ credentials: apiKey });

  const { model, variant } = resolveModel(request.model, 'fal');
  const imageUrl = await resolveImageUrl(request);

  const input: Record<string, any> = {
    prompt: request.prompt,
    image_url: imageUrl,
    num_images: 1,
    output_format: 'jpeg',
    enable_safety_checker: false,
  };

  if (variant.supportsSteps && request.steps) input.num_inference_steps = request.steps;
  if (variant.supportsCfg && request.cfgScale) input.guidance_scale = request.cfgScale;
  if (variant.supportsNegativePrompt && request.negativePrompt) {
    input.negative_prompt = request.negativePrompt;
  }
  // Kontext edits from the instruction; strength only applies to true img2img models.
  if (request.strength !== undefined && !model.id.startsWith('flux-kontext')) {
    input.strength = request.strength;
  }

  if (model.loraCapable && request.loras?.length) {
    const selected = capForProvider(toReferences(request.loras), 'fal');
    if (selected.length) {
      input.loras = selected.map((lora) => ({ path: lora.ref, scale: lora.weight }));
      console.log(`[Fal] Applying ${selected.length} LoRA(s)`);
    }
  }

  try {
    console.log(`[Fal] ${model.name} -> ${variant.slug}`);
    const result: any = await fal.subscribe(variant.slug, { input, logs: false });

    const output = result?.data || result;
    const outputImage = output?.images?.[0] || output?.image;
    if (!outputImage) {
      throw new Error(`No image in response: ${JSON.stringify(output).slice(0, 300)}`);
    }

    const url = typeof outputImage === 'string' ? outputImage : outputImage.url;
    if (!url) {
      throw new Error(`No image URL in response: ${JSON.stringify(outputImage).slice(0, 300)}`);
    }

    return {
      imageUrl: url,
      provider: 'fal',
      model: variant.slug,
      width: outputImage.width,
      height: outputImage.height,
    };
  } catch (err: any) {
    const detail = err?.body ? JSON.stringify(err.body).slice(0, 300) : err.message || JSON.stringify(err);
    // A 404 here almost always means the registry slug is stale.
    if (String(detail).includes('404') || /not found/i.test(String(detail))) {
      throw new Error(
        `Fal endpoint "${variant.slug}" was not found. Confirm the slug at fal.ai/explore and update models.ts. (${detail})`
      );
    }
    throw new Error(`Fal.ai edit failed: ${detail}`);
  }
}

async function resolveImageUrl(request: EditRequest): Promise<string> {
  if (request.imageUrl) {
    // fal can't reach our internal host, so upload the bytes to fal storage.
    if (request.imageUrl.startsWith('/') || request.imageUrl.startsWith('http://localhost')) {
      const internalUrl = request.imageUrl.startsWith('/')
        ? `http://localhost:${process.env.PORT || 3778}${request.imageUrl}`
        : request.imageUrl;
      const res = await fetch(internalUrl);
      if (!res.ok) throw new Error(`Failed to fetch internal image: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      return fal.storage.upload(new Blob([buffer], { type: 'image/jpeg' }));
    }
    return request.imageUrl;
  }

  if (request.imageBase64) {
    const base64Data = request.imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    return fal.storage.upload(new Blob([buffer], { type: 'image/jpeg' }));
  }

  throw new Error('No image URL or base64 provided');
}
