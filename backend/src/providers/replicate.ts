import Replicate from 'replicate';
import { EditRequest, EditResult } from './index';
import { resolveModel } from '../models';
import { capForProvider, toReferences } from '../lora';

/**
 * Replicate provider.
 *
 * Only instruction-edit models are reachable from here — the registry decides, so
 * a mask-requiring inpainting model can never be selected. Routing to one of those
 * is what produced "must use a mask or alpha channel" against a text-only editor.
 *
 * Replicate takes a single LoRA; extra selections are trimmed.
 */
export async function editWithReplicate(request: EditRequest): Promise<EditResult> {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) throw new Error('REPLICATE_API_TOKEN not configured');

  const replicate = new Replicate({ auth: apiToken });
  const { model, variant } = resolveModel(request.model, 'replicate');
  const inputImage = await resolveInputImage(request);

  const input: Record<string, any> = {
    prompt: request.prompt,
    input_image: inputImage,
    output_format: 'jpg',
    output_quality: 95,
    // Least-restrictive setting the API allows; the project prioritises unfiltered output.
    safety_tolerance: 5,
  };

  if (variant.supportsSteps && request.steps) input.num_inference_steps = request.steps;
  if (variant.supportsCfg && request.cfgScale) input.guidance_scale = request.cfgScale;
  if (variant.supportsNegativePrompt && request.negativePrompt) {
    input.negative_prompt = request.negativePrompt;
  }

  if (model.loraCapable && request.loras?.length) {
    const selected = capForProvider(toReferences(request.loras), 'replicate');
    if (selected.length) {
      input.lora_weights = selected[0].ref;
      input.lora_scale = selected[0].weight;
      console.log(`[Replicate] Applying 1 LoRA: ${selected[0].ref}`);
    }
  }

  try {
    console.log(`[Replicate] ${model.name} -> ${variant.slug}`);
    const output = await replicate.run(variant.slug as `${string}/${string}`, { input });
    const resultUrl = await extractUrl(output);
    if (!resultUrl) throw new Error('No image URL in Replicate response');

    return { imageUrl: resultUrl, provider: 'replicate', model: variant.slug };
  } catch (err: any) {
    const detail = err.message || JSON.stringify(err);
    if (/404|not found/i.test(String(detail))) {
      throw new Error(
        `Replicate model "${variant.slug}" was not found. Confirm it at replicate.com and update models.ts. (${detail})`
      );
    }
    if (/mask|alpha channel/i.test(String(detail))) {
      throw new Error(
        `Replicate model "${variant.slug}" requires a mask, so it can't be used by this text-only editor. Remove it from models.ts. (${detail})`
      );
    }
    throw new Error(`Replicate edit failed: ${detail}`);
  }
}

/** Replicate's SDK auto-uploads Buffers; public URLs pass straight through. */
async function resolveInputImage(request: EditRequest): Promise<Buffer | string> {
  if (request.imageBase64) {
    const base64Data = request.imageBase64.replace(/^data:image\/\w+;base64,/, '');
    return Buffer.from(base64Data, 'base64');
  }

  if (request.imageUrl) {
    if (request.imageUrl.startsWith('/') || request.imageUrl.startsWith('http://localhost')) {
      const internalUrl = request.imageUrl.startsWith('/')
        ? `http://localhost:${process.env.PORT || 3778}${request.imageUrl}`
        : request.imageUrl;
      const res = await fetch(internalUrl);
      if (!res.ok) throw new Error(`Failed to fetch internal image: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    return request.imageUrl;
  }

  throw new Error('imageUrl or imageBase64 required for Replicate');
}

/** Replicate returns strings, arrays, or FileOutput objects depending on the model. */
async function extractUrl(output: any): Promise<string> {
  if (Array.isArray(output)) return extractUrl(output[0]);
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object') {
    if (typeof output.url === 'function') return (await output.url()).toString();
    if (typeof output.url === 'string') return output.url;
  }
  return String(output ?? '');
}
