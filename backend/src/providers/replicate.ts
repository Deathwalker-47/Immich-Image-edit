import Replicate from 'replicate';
import { EditRequest, EditResult } from './index';

export async function editWithReplicate(request: EditRequest): Promise<EditResult> {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) throw new Error('REPLICATE_API_TOKEN not configured');

  const replicate = new Replicate({ auth: apiToken });
  const model = request.model || 'black-forest-labs/flux-kontext-pro';

  // Resolve the input image to a Buffer (which the SDK auto-uploads)
  let inputImage: Buffer | string;
  if (request.imageBase64) {
    // Convert base64 to Buffer — Replicate SDK auto-uploads Buffers
    const base64Data = request.imageBase64.replace(/^data:image\/\w+;base64,/, '');
    inputImage = Buffer.from(base64Data, 'base64');
  } else if (request.imageUrl) {
    // If it's a relative/internal URL, fetch and convert to Buffer
    if (request.imageUrl.startsWith('/') || request.imageUrl.startsWith('http://localhost')) {
      const internalUrl = request.imageUrl.startsWith('/')
        ? `http://localhost:${process.env.PORT || 3778}${request.imageUrl}`
        : request.imageUrl;
      const res = await fetch(internalUrl);
      if (!res.ok) throw new Error(`Failed to fetch internal image: ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      inputImage = Buffer.from(arrayBuf);
    } else {
      // External URL — pass directly
      inputImage = request.imageUrl;
    }
  } else {
    throw new Error('imageUrl or imageBase64 required for Replicate');
  }

  try {
    let input: Record<string, any>;

    // FLUX Kontext — text-based editing with source image
    if (model.includes('flux-kontext')) {
      input = {
        prompt: request.prompt,
        input_image: inputImage,
        strength: request.strength ?? 0.75,
        output_format: 'jpg',
        output_quality: 95,
        safety_tolerance: 5,
      };
    } else if (model.includes('flux')) {
      // Generic FLUX image-to-image
      input = {
        prompt: request.prompt,
        image: inputImage,
        prompt_strength: request.strength ?? 0.75,
        num_inference_steps: request.steps ?? 30,
        guidance_scale: 3.5,
        output_format: 'jpg',
        output_quality: 95,
      };
    } else {
      // Generic stable diffusion image-to-image
      input = {
        prompt: request.prompt,
        image: inputImage,
        negative_prompt: request.negativePrompt || 'blurry, low quality',
        prompt_strength: request.strength ?? 0.75,
        num_inference_steps: request.steps ?? 30,
        guidance_scale: 7.5,
      };
    }

    console.log(`[Replicate] Running model: ${model}`);
    const output = await replicate.run(model as `${string}/${string}`, { input });

    // Replicate outputs can be arrays or single values or FileOutput objects
    let resultUrl: string;
    if (Array.isArray(output)) {
      const first = output[0] as any;
      if (first && typeof first === 'object' && typeof first.url === 'function') {
        resultUrl = (await first.url()).toString();
      } else {
        resultUrl = String(first);
      }
    } else if (typeof output === 'string') {
      resultUrl = output;
    } else if (output && typeof output === 'object') {
      const out = output as any;
      if (typeof out.url === 'function') {
        resultUrl = (await out.url()).toString();
      } else if (typeof out.url === 'string') {
        resultUrl = out.url;
      } else {
        // Sometimes the output IS a ReadableStream or FileOutput — try toString
        resultUrl = String(out);
      }
    } else {
      throw new Error('Unexpected Replicate output format: ' + JSON.stringify(output).substring(0, 200));
    }

    if (!resultUrl) {
      throw new Error('No image URL in Replicate response');
    }

    return {
      imageUrl: String(resultUrl),
      provider: 'replicate',
      model,
    };
  } catch (err: any) {
    throw new Error(`Replicate edit failed: ${err.message || JSON.stringify(err)}`);
  }
}
