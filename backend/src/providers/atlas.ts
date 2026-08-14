import axios from 'axios';
import { EditRequest, EditResult } from './index';
import { resolveModel } from '../models';
import { resolveSize } from '../sizing';
import { capForProvider, toReferences } from '../lora';

/**
 * Atlas Cloud provider.
 *
 * Previously entirely unbuilt (HANDOFF.md §6.4: "Atlas endpoint/payload wiring is
 * wrong... the newest provider, least tested, and the bridge has NO atlas
 * reference"). Built here against Atlas's live docs rather than guessed, per the
 * same policy as the other three providers — see the `note` field on each Atlas
 * entry in models.ts for what was independently confirmed vs inferred.
 *
 * One quirk unique to Atlas among the four providers: the field name for the
 * input image is NOT constant across models. Kontext takes a single `image`
 * string; Wan and Seedream edit take an `images` array. That's carried per model
 * in models.ts as `imageInput` and read here rather than hardcoded.
 *
 * Atlas jobs can resolve synchronously (small/fast models) or asynchronously
 * (returned with a "processing" status and a poll URL) — the exact behaviour per
 * model isn't documented, so this handles both: check whether the initial POST
 * already carries a finished result, and poll only if it doesn't.
 */

const ATLAS_API_URL = 'https://api.atlascloud.ai/api/v1';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120000;

interface AtlasJob {
  id?: string;
  status?: string;
  output?: string[];
  outputs?: string[];
  urls?: { result?: string; get?: string };
  error?: string;
}

/**
 * Every Atlas response is wrapped as `{code, message, data: {...}}` — confirmed
 * live: a real generateImage call returned `{"code":200,"message":"",
 * "data":{"id":...,"status":"processing","outputs":null,...}}`. Reading job
 * fields off the top level (rather than `.data`) meant `id` was always
 * undefined, so the code below never polled and reported "no image" on every
 * async job.
 */
function unwrap(payload: any): AtlasJob {
  return (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object')
    ? payload.data
    : payload || {};
}

const TERMINAL_FAILURE = /fail|error|cancel/i;
const TERMINAL_SUCCESS = /complete|succeed|success|finish/i;

/** A live flux-kontext-dev call returned `outputs` (plural); docs elsewhere showed
 * `output` (singular). Both are checked since it isn't documented which models
 * use which. */
function firstImage(job: AtlasJob): string | undefined {
  return job.outputs?.[0] || job.output?.[0] || job.urls?.result;
}

function isDone(job: AtlasJob): boolean {
  // An output already present is authoritative regardless of what `status` says —
  // the exact set of status strings per model isn't documented, but a real output
  // URL is unambiguous.
  if (firstImage(job)) return true;
  return TERMINAL_SUCCESS.test(job.status || '') || TERMINAL_FAILURE.test(job.status || '');
}

function isFailure(job: AtlasJob): boolean {
  return !firstImage(job) && TERMINAL_FAILURE.test(job.status || '');
}

export async function editWithAtlas(request: EditRequest): Promise<EditResult> {
  const apiKey = process.env.ATLAS_API_KEY;
  if (!apiKey) throw new Error('ATLAS_API_KEY not configured');

  const { model, variant } = resolveModel(request.model, 'atlas');
  const imageValue = await resolveImageInput(request);

  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const body: Record<string, any> = {
    model: variant.slug,
    prompt: request.prompt,
    num_images: 1,
    enable_safety_checker: false,
  };

  // Atlas's field for the input image varies per model — see the ImageInputMode
  // comment in models.ts. Default to the single-image convention if a model entry
  // doesn't specify one, since that covers the Kontext family.
  const inputMode = variant.imageInput || { kind: 'single' as const, field: 'image' };
  if (inputMode.kind === 'array') {
    body[inputMode.field] = [imageValue].slice(0, inputMode.max);
  } else {
    body[inputMode.field] = imageValue;
  }

  const size = resolveSize(variant.dimensions, undefined);
  if (size.kind === 'dimensions') {
    body.size = `${size.width}x${size.height}`;
  }

  if (variant.supportsSteps && request.steps) body.num_inference_steps = request.steps;
  if (variant.supportsCfg && request.cfgScale) body.guidance_scale = request.cfgScale;

  if (model.loraCapable && request.loras?.length) {
    const selected = capForProvider(toReferences(request.loras), 'atlas');
    if (selected.length) {
      // Atlas's own LoRA guide documents a per-item `scale` (default 1.0) and
      // accepts either a HuggingFace path or a direct URL for the LoRA itself;
      // `path` is the field name used in that guide's own examples.
      body.loras = selected.map((lora) => ({ path: lora.ref, scale: lora.weight }));
      console.log(`[Atlas] Applying ${selected.length} LoRA(s)`);
    }
  }

  console.log(`[Atlas] ${model.name} -> ${variant.slug}`);

  let job: AtlasJob;
  try {
    const response = await axios.post(`${ATLAS_API_URL}/model/generateImage`, body, {
      headers,
      timeout: 120000,
    });
    job = unwrap(response.data);
  } catch (err: any) {
    const detail = err.response ? JSON.stringify(err.response.data).slice(0, 400) : err.message;
    if (err.response?.status === 404) {
      throw new Error(
        `Atlas model "${variant.slug}" was not found. Confirm it at atlascloud.ai/docs and update models.ts. (${detail})`
      );
    }
    throw new Error(`Atlas edit failed: ${detail}`);
  }

  if (!isDone(job) && job.id) {
    job = await pollAtlasJob(job.id, headers);
  }

  if (isFailure(job)) {
    throw new Error(`Atlas job failed: ${job.error || JSON.stringify(job).slice(0, 300)}`);
  }

  const outputUrl = firstImage(job);
  if (!outputUrl) {
    throw new Error(`No image in Atlas response: ${JSON.stringify(job).slice(0, 300)}`);
  }

  return { imageUrl: outputUrl, provider: 'atlas', model: variant.slug };
}

async function pollAtlasJob(jobId: string, headers: Record<string, string>): Promise<AtlasJob> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const response = await axios.get(`${ATLAS_API_URL}/model/prediction/${jobId}`, {
      headers,
      timeout: 30000,
    });
    const job = unwrap(response.data);
    if (isDone(job)) return job;
  }

  throw new Error(`Atlas job ${jobId} did not finish within ${POLL_TIMEOUT_MS / 1000}s`);
}

/** Atlas needs a URL or base64 data URI it can fetch; internal paths are resolved first. */
async function resolveImageInput(request: EditRequest): Promise<string> {
  if (request.imageBase64) {
    return request.imageBase64.startsWith('data:')
      ? request.imageBase64
      : `data:image/jpeg;base64,${request.imageBase64}`;
  }

  if (request.imageUrl) {
    if (request.imageUrl.startsWith('/') || request.imageUrl.startsWith('http://localhost')) {
      const internalUrl = request.imageUrl.startsWith('/')
        ? `http://localhost:${process.env.PORT || 3778}${request.imageUrl}`
        : request.imageUrl;
      const res = await axios.get(internalUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const base64 = Buffer.from(res.data).toString('base64');
      const contentType = res.headers['content-type'] || 'image/jpeg';
      return `data:${contentType};base64,${base64}`;
    }
    return request.imageUrl;
  }

  throw new Error('imageUrl or imageBase64 required for Atlas');
}
