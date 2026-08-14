import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { EditRequest, EditResult } from './index';
import { resolveModel } from '../models';
import { resolveSize, readImageSize, Size } from '../sizing';
import { capForProvider, resolveRunwareLoras, toReferences } from '../lora';

const RUNWARE_API_URL = 'https://api.runware.ai/v1';

/**
 * Runware provider.
 *
 * Three things here were previously wrong and are worth not regressing:
 *
 *  1. Size was hardcoded to 1024x1024 for every model. Seedream 4.5 requires a
 *     total area of at least 3.69MP, so that request was rejected outright with
 *     `invalidPixels`. Sizing is now per model, derived from the source image's
 *     aspect ratio (see sizing.ts).
 *  2. The input image was sent as `inputImage`. Kontext, Seedream, Wan and Grok all
 *     take `inputs.referenceImages` — an array — per Runware's model docs.
 *  3. `steps`/`strength`/`negativePrompt` were sent to models that document none of
 *     them. Undocumented parameters can hard-fail the request, so they are now only
 *     included when the registry says the model accepts them.
 */

interface UploadedImage {
  uuid: string;
  size?: Size;
}

/** Store an image on Runware and return its imageUUID plus its pixel dimensions. */
async function uploadImage(base64: string, apiKey: string): Promise<UploadedImage> {
  const payload = [
    {
      taskType: 'imageUpload',
      taskUUID: uuidv4(),
      image: base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`,
    },
  ];

  const response = await axios.post(RUNWARE_API_URL, payload, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 120000,
  });

  const entry = (response.data?.data || []).find((item: any) => item?.imageUUID);
  if (!entry?.imageUUID) {
    throw new Error(`Runware imageUpload returned no imageUUID: ${JSON.stringify(response.data).slice(0, 300)}`);
  }

  const raw = base64.replace(/^data:image\/\w+;base64,/, '');
  return { uuid: entry.imageUUID, size: readImageSize(Buffer.from(raw, 'base64')) };
}

/** Fetch a URL the backend can reach and return it as base64 plus its dimensions. */
async function fetchAsBase64(url: string): Promise<{ base64: string; size?: Size }> {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
  const buffer = Buffer.from(response.data);
  return { base64: buffer.toString('base64'), size: readImageSize(buffer) };
}

function isInternalUrl(url: string): boolean {
  return url.startsWith('/') || url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
}

/** Surface task-level errors that Runware reports inside an otherwise-200 body. */
function errorTextFrom(payload: any): string | null {
  const errors = payload?.errors;
  if (!errors) return null;
  const list = Array.isArray(errors) ? errors : [errors];
  return list
    .map((error: any) =>
      typeof error === 'object'
        ? [error.message, error.parameter, error.code].filter(Boolean).join(' | ')
        : String(error)
    )
    .join('; ');
}

export async function editWithRunware(request: EditRequest): Promise<EditResult> {
  const apiKey = process.env.RUNWARE_API_KEY;
  if (!apiKey) throw new Error('RUNWARE_API_KEY not configured');

  const { model, variant } = resolveModel(request.model, 'runware');

  if (!request.imageUrl && !request.imageBase64) {
    throw new Error('imageUrl or imageBase64 required for Runware');
  }

  // ---- Resolve the source image to a Runware reference -------------------
  let referenceImage: string;
  let sourceSize: Size | undefined;

  if (request.imageBase64) {
    const uploaded = await uploadImage(request.imageBase64, apiKey);
    referenceImage = uploaded.uuid;
    sourceSize = uploaded.size;
  } else if (isInternalUrl(request.imageUrl!)) {
    // Runware can't reach our internal host, so pull the bytes and upload them.
    const internalUrl = request.imageUrl!.startsWith('/')
      ? `http://localhost:${process.env.PORT || 3778}${request.imageUrl}`
      : request.imageUrl!;
    const { base64, size } = await fetchAsBase64(internalUrl);
    const uploaded = await uploadImage(base64, apiKey);
    referenceImage = uploaded.uuid;
    sourceSize = uploaded.size ?? size;
  } else {
    // Publicly reachable URL: hand it straight over, but read the dimensions so
    // the output can keep the source aspect ratio.
    referenceImage = request.imageUrl!;
    try {
      const { size } = await fetchAsBase64(request.imageUrl!);
      sourceSize = size;
    } catch {
      // Sizing falls back to a square aspect; not worth failing the edit over.
    }
  }

  // ---- Build the inference task ------------------------------------------
  const inferenceUUID = uuidv4();
  const task: any = {
    taskType: 'imageInference',
    taskUUID: inferenceUUID,
    model: variant.slug,
    positivePrompt: request.prompt,
    numberResults: 1,
    outputFormat: 'JPEG',
    outputQuality: 95,
    inputs: { referenceImages: [referenceImage] },
  };

  const size = resolveSize(variant.dimensions, sourceSize);
  if (size.kind === 'dimensions') {
    task.width = size.width;
    task.height = size.height;
  } else if (size.kind === 'resolution') {
    task.resolution = size.resolution;
  }

  if (variant.runwareProviderSettingsKey && variant.runwareProviderSettings) {
    task.providerSettings = { [variant.runwareProviderSettingsKey]: variant.runwareProviderSettings };
  }

  if (variant.supportsSteps && request.steps) task.steps = request.steps;
  if (variant.supportsCfg && request.cfgScale) task.CFGScale = request.cfgScale;
  if (variant.supportsNegativePrompt && request.negativePrompt) {
    task.negativePrompt = request.negativePrompt;
  }

  // ---- LoRAs (Kontext LoRA variants only) --------------------------------
  //
  // If the user asked for LoRAs, every one of them failing to resolve must not
  // be allowed to silently fall through to a plain edit — that used to happen
  // here and is worse than an error: the response still says 200 with a real
  // image, so the caller has no way to know the LoRA was silently dropped.
  // Confirmed live against a genuine Runware platform limitation (see
  // uploadLoraToRunware's architecture comment): runware:106@1 (Kontext Dev)
  // rejects flux1d-tagged LoRAs at inference time with 'unsupportedLoraModel',
  // regardless of upload metadata — there is no retry that fixes this from here.
  if (model.loraCapable && request.loras?.length) {
    const selected = capForProvider(toReferences(request.loras), 'runware');
    const resolved = await resolveRunwareLoras(selected, apiKey);
    if (!resolved.length) {
      throw new Error(
        `Runware could not apply any of the requested LoRA(s) to ${variant.slug}. This is a known ` +
        `platform limitation — Runware currently rejects LoRAs on FLUX Kontext Dev at inference time ` +
        `even when the upload itself succeeds. Try Replicate or Atlas for LoRA edits instead.`
      );
    }
    task.lora = resolved.map((lora) => ({ model: lora.ref, weight: lora.weight }));
    console.log(`[Runware] Applying ${resolved.length} LoRA(s)`);
  }

  // ---- Call ---------------------------------------------------------------
  console.log(
    `[Runware] ${model.name} (${variant.slug}) ` +
      `${size.kind === 'dimensions' ? `${task.width}x${task.height}` : size.kind === 'resolution' ? task.resolution : 'provider default'}`
  );

  let response;
  try {
    response = await axios.post(RUNWARE_API_URL, [task], {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 180000,
    });
  } catch (err: any) {
    if (err.response) {
      const detail = errorTextFrom(err.response.data) || JSON.stringify(err.response.data).slice(0, 300);
      throw new Error(`Runware API error ${err.response.status}: ${detail}`);
    }
    throw new Error(`Runware edit failed: ${err.message}`);
  }

  const body = response.data;
  const taskError = errorTextFrom(body);
  if (taskError) throw new Error(`Runware error: ${taskError}`);

  return extractResult(body, inferenceUUID, variant.slug);
}

function extractResult(body: any, inferenceUUID: string, modelSlug: string): EditResult {
  const results = Array.isArray(body) ? body : body?.data || [];
  const result = results.find(
    (item: any) => item?.taskUUID === inferenceUUID || item?.taskType === 'imageInference'
  );
  if (!result) {
    throw new Error(`No inference result from Runware: ${JSON.stringify(body).slice(0, 300)}`);
  }
  if (result.error) {
    throw new Error(`Runware error: ${JSON.stringify(result.error)}`);
  }

  const outputUrl = result.imageURL || result.imageUrl || result.url;
  if (!outputUrl) {
    throw new Error(`No image URL in Runware response: ${JSON.stringify(result).slice(0, 300)}`);
  }

  return {
    imageUrl: outputUrl,
    provider: 'runware',
    model: modelSlug,
    width: result.width,
    height: result.height,
    seed: result.seed,
  };
}
