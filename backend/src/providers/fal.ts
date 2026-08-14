import { fal } from '@fal-ai/client';
import { EditRequest, EditResult } from './index';

export async function editWithFal(request: EditRequest): Promise<EditResult> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error('FAL_KEY not configured');

  fal.config({ credentials: apiKey });

  const model = request.model || 'fal-ai/flux-kontext/max';
  const imageUrl = await resolveImageUrl(request);

  let result: any;

  try {
    // FLUX Kontext models — in-context text editing
    if (model.includes('flux-kontext') || model.includes('kontext')) {
      result = await fal.subscribe(model, {
        input: {
          prompt: request.prompt,
          image_url: imageUrl,
          strength: request.strength ?? 0.75,
          num_inference_steps: request.steps ?? 30,
          guidance_scale: 3.5,
          output_format: 'jpeg',
          num_images: 1,
          enable_safety_checker: false,
        },
        logs: false,
      });
    } else if (model.includes('stable-diffusion')) {
      // Stable Diffusion models — use image-to-image endpoint variant
      // SD3 Medium needs the /image-to-image endpoint suffix
      const img2imgModel = model.endsWith('/image-to-image')
        ? model
        : `${model}/image-to-image`;
      
      result = await fal.subscribe(img2imgModel, {
        input: {
          prompt: request.prompt,
          image_url: imageUrl,
          strength: request.strength ?? 0.7,
          negative_prompt: request.negativePrompt || 'blurry, low quality, artifacts',
          num_inference_steps: request.steps ?? 28,
          guidance_scale: 7.5,
          num_images: 1,
          enable_safety_checker: false,
        },
        logs: false,
      });
    } else {
      // Generic image-to-image fallback
      result = await fal.subscribe(model, {
        input: {
          prompt: request.prompt,
          image_url: imageUrl,
          negative_prompt: request.negativePrompt,
          strength: request.strength ?? 0.75,
          num_inference_steps: request.steps ?? 30,
          num_images: 1,
          enable_safety_checker: false,
        },
        logs: false,
      });
    }

    const output = result.data || result;
    const outputImage = output?.images?.[0] || output?.image;

    if (!outputImage) {
      throw new Error('No image in Fal.ai response: ' + JSON.stringify(output).substring(0, 300));
    }

    const imageUrlOut = typeof outputImage === 'string' ? outputImage : outputImage.url;

    return {
      imageUrl: imageUrlOut,
      provider: 'fal',
      model,
      width: outputImage.width,
      height: outputImage.height,
    };
  } catch (err: any) {
    throw new Error(`Fal.ai edit failed: ${err.message || JSON.stringify(err)}`);
  }
}

async function resolveImageUrl(request: EditRequest): Promise<string> {
  if (request.imageUrl) {
    // If internal URL, fetch and upload to fal storage
    if (request.imageUrl.startsWith('/') || request.imageUrl.startsWith('http://localhost')) {
      const internalUrl = request.imageUrl.startsWith('/')
        ? `http://localhost:${process.env.PORT || 3778}${request.imageUrl}`
        : request.imageUrl;
      const res = await fetch(internalUrl);
      if (!res.ok) throw new Error(`Failed to fetch internal image: ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const blob = new Blob([buffer], { type: 'image/jpeg' });
      const uploaded = await fal.storage.upload(blob);
      return uploaded;
    }
    return request.imageUrl;
  }
  if (request.imageBase64) {
    // Upload to fal storage for base64 images
    const base64Data = request.imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    const uploaded = await fal.storage.upload(blob);
    return uploaded;
  }
  throw new Error('No image URL or base64 provided');
}
