import axios from 'axios';
import FormData from 'form-data';
import { EditRequest, EditResult } from './index';

const ATLAS_BASE_URL = 'https://api.atlascloud.ai/v1';

export async function editWithAtlas(request: EditRequest): Promise<EditResult> {
  const apiKey = process.env.ATLAS_API_KEY;
  if (!apiKey) throw new Error('ATLAS_API_KEY not configured');

  const model = request.model || 'flux-kontext-pro';
  const imageUrl = request.imageUrl;
  const imageBase64 = request.imageBase64;

  if (!imageUrl && !imageBase64) {
    throw new Error('imageUrl or imageBase64 required for Atlas Cloud');
  }

  // Convert image to Buffer
  let imageBuffer: Buffer;
  let finalBase64Url = imageBase64;

  if (imageBase64) {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    imageBuffer = Buffer.from(base64Data, 'base64');
    if (!finalBase64Url?.startsWith('data:image')) {
      finalBase64Url = `data:image/jpeg;base64,${base64Data}`;
    }
  } else if (imageUrl && (imageUrl.startsWith('/') || imageUrl.startsWith('http://localhost'))) {
    const internalUrl = imageUrl.startsWith('/')
      ? `http://localhost:${process.env.PORT || 3778}${imageUrl}`
      : imageUrl;
    const res = await axios.get(internalUrl, { responseType: 'arraybuffer' });
    imageBuffer = Buffer.from(res.data);
    finalBase64Url = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
  } else {
    // Try to fetch external URL to upload as file
    const res = await axios.get(imageUrl as string, { responseType: 'arraybuffer' });
    imageBuffer = Buffer.from(res.data);
    finalBase64Url = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
  }

  try {
    let endpoint: string;
    let response: any;

    if (model.includes('kontext') || model.includes('flux')) {
      // FLUX Kontext — image-to-image editing (multipart/form-data)
      endpoint = '/images/edits';
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', request.prompt);
      form.append('n', 1);
      form.append('size', '1024x1024');
      form.append('response_format', 'url');
      form.append('image', imageBuffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
      
      if (request.strength) form.append('strength', request.strength);
      if (request.steps) form.append('steps', request.steps);
      
      const headers = {
        'Authorization': `Bearer ${apiKey}`,
        ...form.getHeaders(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      };

      console.log(`[Atlas Cloud] Sending to ${endpoint}, model: ${model} (FormData)`);
      response = await axios.post(`${ATLAS_BASE_URL}${endpoint}`, form, { headers, timeout: 120000 });
      
    } else {
      // For Seedream, Wan, Grok, Gemini, etc. - generation with image prompt (application/json)
      endpoint = '/images/generations';
      const payload = {
        model,
        prompt: request.prompt,
        n: 1,
        size: '1024x1024',
        response_format: 'url',
        image_url: finalBase64Url,
      };

      const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      };

      console.log(`[Atlas Cloud] Sending to ${endpoint}, model: ${model} (JSON)`);
      response = await axios.post(`${ATLAS_BASE_URL}${endpoint}`, payload, { headers, timeout: 120000 });
    }

    const data = response.data;
    const imageData = data?.data?.[0];
    if (!imageData) {
      throw new Error('No image data in Atlas Cloud response: ' + JSON.stringify(data).substring(0, 300));
    }

    const resultUrl = imageData.url || imageData.b64_json;
    if (!resultUrl) {
      throw new Error('No image URL or b64 in Atlas Cloud response');
    }

    const finalUrl = imageData.b64_json
      ? `data:image/jpeg;base64,${imageData.b64_json}`
      : resultUrl;

    return {
      imageUrl: finalUrl,
      provider: 'atlas',
      model,
    };
  } catch (err: any) {
    if (err.response) {
      throw new Error(
        `Atlas Cloud API error ${err.response.status}: ${JSON.stringify(err.response.data).substring(0, 300)}`
      );
    }
    throw new Error(`Atlas Cloud edit failed: ${err.message}`);
  }
}
