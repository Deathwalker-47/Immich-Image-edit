/**
 * Model registry — the single source of truth for what we can run where.
 *
 * Every slug here is either marked `verified: true`, meaning it was checked
 * against the provider's live catalogue/docs, or `verified: false`, meaning it is
 * a best guess that MUST be confirmed before being trusted. Trusting remembered
 * slugs is what produced the original round of "Not Found" / 404 bugs, so the flag
 * is deliberately explicit rather than implied.
 *
 * Dimension rules live here too, per model per provider. There is no single global
 * pixel rule — see `DimensionRule` below.
 */

export type ProviderId = 'runware' | 'fal' | 'replicate' | 'atlas';

/**
 * How a provider constrains output size for one model.
 *
 * The `invalidPixels` bug came from sending a hardcoded 1024x1024 to every Runware
 * model. The real constraints differ sharply per model:
 *
 *  - Seedream 4.5 requires a total AREA of 3.69-16.78 megapixels, so 1024x1024
 *    (1.05MP) is below its floor and is rejected.
 *  - FLUX Kontext accepts only 9 specific dimension pairs, topping out around
 *    1.05MP — so applying Seedream's floor to Kontext would break Kontext instead.
 *  - Wan 2.7 wants 768-2048 on each side in 16px steps.
 *  - Grok Imagine takes a `resolution` preset and rejects width/height alongside it.
 *
 * One global rule cannot satisfy all four, which is why this is per model.
 */
export type DimensionRule =
  | {
      kind: 'fixed-list';
      /** Only these exact (width, height) pairs are accepted. */
      pairs: [number, number][];
    }
  | {
      kind: 'range';
      minEdge: number;
      maxEdge: number;
      /** Both dimensions must be a multiple of this. */
      increment: number;
      /** Optional total-area band, in pixels. */
      minPixels?: number;
      maxPixels?: number;
    }
  | {
      kind: 'resolution-preset';
      /** Send this instead of width/height; the provider rejects both together. */
      preset: string;
    }
  | {
      kind: 'provider-default';
      /** Send no size at all and let the provider mirror the input. */
    };

/**
 * How a model's input image(s) are sent. Only Atlas varies this per model — Fal,
 * Runware and Replicate use one convention across their whole catalogue, so their
 * provider files hardcode it directly rather than reading it from here.
 */
export type ImageInputMode =
  | { kind: 'single'; field: string }
  | { kind: 'array'; field: string; max: number };

export interface ModelVariant {
  /** The provider-specific model identifier (AIR id, endpoint slug, etc). */
  slug: string;
  /** True only if checked against the provider's live catalogue or docs. */
  verified: boolean;
  /** Free-text note about what was checked, or what still needs checking. */
  note?: string;
  dimensions: DimensionRule;
  /** Whether the provider documents `steps` for this model. Sending an undocumented parameter can hard-fail the request. */
  supportsSteps: boolean;
  /** Whether the provider documents a guidance/CFG scale for this model. */
  supportsCfg: boolean;
  /** Whether a negative prompt is accepted. */
  supportsNegativePrompt: boolean;
  /** Max reference/input images the model accepts. */
  maxReferenceImages: number;
  /** Atlas only — see ImageInputMode. */
  imageInput?: ImageInputMode;
}

export interface EditModel {
  /** Our canonical, provider-independent id — what the UI stores. */
  id: string;
  name: string;
  description: string;
  /** LoRAs may only be applied to models flagged here. */
  loraCapable: boolean;
  providers: Partial<Record<ProviderId, ModelVariant>>;
}

/**
 * FLUX Kontext renders only these dimension pairs (Runware model docs).
 * Listed widest to tallest.
 */
export const KONTEXT_DIMENSION_PAIRS: [number, number][] = [
  [1568, 672],   // 21:9
  [1392, 752],   // 16:9
  [1248, 832],   // 3:2
  [1184, 880],   // 4:3
  [1024, 1024],  // 1:1
  [880, 1184],   // 3:4
  [832, 1248],   // 2:3
  [752, 1392],   // 9:16
  [672, 1568],   // 9:21
];

const KONTEXT_DIMENSIONS: DimensionRule = {
  kind: 'fixed-list',
  pairs: KONTEXT_DIMENSION_PAIRS,
};

export const MODELS: EditModel[] = [
  {
    id: 'flux-kontext-dev',
    name: 'FLUX Kontext Dev',
    description: 'Instruction-based editing. Follows the prompt literally; say what to preserve.',
    loraCapable: false,
    providers: {
      runware: {
        slug: 'runware:106@1',
        verified: true,
        note: 'Confirmed in Runware model docs. Dev variant documents steps (1-50) and CFGScale (0-20).',
        dimensions: KONTEXT_DIMENSIONS,
        supportsSteps: true,
        supportsCfg: true,
        supportsNegativePrompt: true,
        maxReferenceImages: 2,
      },
      fal: {
        slug: 'fal-ai/flux-kontext/dev',
        verified: true,
        note: 'Confirmed live at fal.ai/models/fal-ai/flux-kontext/dev/api. Fields: image_url, prompt, ' +
          'num_inference_steps (default 28), guidance_scale (default 2.5), resolution_mode ' +
          '(default match_input — output already mirrors the source, no explicit sizing needed).',
        dimensions: { kind: 'provider-default' },
        supportsSteps: true,
        supportsCfg: true,
        supportsNegativePrompt: false,
        maxReferenceImages: 1,
      },
      replicate: {
        slug: 'black-forest-labs/flux-kontext-dev',
        verified: true,
        note: 'Live end-to-end test passed. Schema fetched via the authenticated GET /v1/models/{owner}/{name} ' +
          '(unauthenticated requests 404 rather than exposing it). Fields: input_image, prompt, guidance ' +
          '(not guidance_scale), disable_safety_checker (not safety_tolerance), aspect_ratio ' +
          '(default match_input_image — no width/height needed), num_inference_steps.',
        dimensions: { kind: 'provider-default' },
        supportsSteps: true,
        supportsCfg: true,
        supportsNegativePrompt: false,
        maxReferenceImages: 1,
      },
      atlas: {
        slug: 'black-forest-labs/flux-kontext-dev',
        verified: true,
        note: 'Live end-to-end test passed. Confirmed at atlascloud.ai/docs/more-models/black-forest-labs/' +
          'flux-kontext-dev/generateImage. $0.025/image. guidance_scale 1-20 (default 2.5), ' +
          'num_inference_steps 1-50 (default 28).',
        dimensions: { kind: 'provider-default' },
        supportsSteps: true,
        supportsCfg: true,
        supportsNegativePrompt: false,
        maxReferenceImages: 1,
        imageInput: { kind: 'single', field: 'image' },
      },
    },
  },
  {
    id: 'flux-kontext-dev-lora',
    name: 'FLUX Kontext Dev LoRA',
    description: 'Kontext Dev with LoRA adapters. The only model the LoRA picker applies to.',
    loraCapable: true,
    providers: {
      runware: {
        // Runware has no separate LoRA endpoint — it is the base model plus a lora array.
        slug: 'runware:106@1',
        verified: true,
        note: 'KNOWN PLATFORM LIMITATION, confirmed live: Runware rejects every LoRA tested against this base ' +
          'model with unsupportedLoraModel, even a freshly-uploaded, correctly-tagged (architecture: flux1d — ' +
          'the only FLUX option in Runware\'s own architecture enum, confirmed by deliberately sending an ' +
          'invalid value and reading back the full allowedValues list) LoRA. This is not a stale-cache problem ' +
          '(self-heal for the 7 hand-made bad AIRs still applies and is unrelated) and not fixable from the ' +
          'client side — Kontext\'s extra reference-image conditioning appears to make Runware treat it as ' +
          'incompatible with flux1d LoRAs at inference time, regardless of what BFL says elsewhere about ' +
          'FLUX.1-dev LoRAs loading on Kontext with a quality tradeoff (true on e.g. ComfyUI/diffusers, not ' +
          'true on Runware\'s platform). edit() throws a clear error rather than silently dropping the LoRA and ' +
          'returning an unmodified-by-LoRA edit as if it had succeeded — that silent-drop was the initial, ' +
          'more dangerous failure mode before this was understood. Replicate and Atlas both apply LoRAs to this ' +
          'same model family successfully; prefer them for LoRA edits until/unless Runware changes this.',
        dimensions: KONTEXT_DIMENSIONS,
        supportsSteps: true,
        supportsCfg: true,
        supportsNegativePrompt: true,
        maxReferenceImages: 2,
      },
      fal: {
        slug: 'fal-ai/flux-kontext-lora',
        verified: true,
        note: 'Confirmed live at fal.ai/models/fal-ai/flux-kontext-lora/api, built on FLUX.1 Kontext [dev]. ' +
          'Fields: image_url, prompt, loras (array).',
        dimensions: { kind: 'provider-default' },
        supportsSteps: true,
        supportsCfg: true,
        supportsNegativePrompt: false,
        maxReferenceImages: 1,
      },
      replicate: {
        slug: 'black-forest-labs/flux-kontext-dev-lora',
        verified: true,
        note: 'Schema fetched via the authenticated model API. Fields: input_image, prompt, lora_weights, ' +
          'lora_strength (NOT hf_lora/lora_scale — that was the sibling flux-dev-lora model\'s convention, ' +
          'different from this one). Confirmed live: the wrong field names reached the model with no LoRA ' +
          'loaded and crashed inside its own weight-quantization code rather than failing cleanly.',
        dimensions: { kind: 'provider-default' },
        supportsSteps: true,
        supportsCfg: true,
        supportsNegativePrompt: false,
        maxReferenceImages: 1,
      },
      atlas: {
        slug: 'black-forest-labs/flux-kontext-dev-lora',
        verified: true,
        note: 'Live-tested. The "-ultra-fast" variant has its own full docs page and looked like the safer bet ' +
          'sight-unseen, but the live API rejects it ({"code":400,"msg":"not found"}) — a docs page existing is ' +
          'not the same as the API recognising the slug as a "model" value. This plain slug is the one that ' +
          'actually resolves. Fields: image, loras (array, max 3).',
        dimensions: { kind: 'provider-default' },
        supportsSteps: true,
        supportsCfg: true,
        supportsNegativePrompt: false,
        maxReferenceImages: 1,
        imageInput: { kind: 'single', field: 'image' },
      },
    },
  },
  {
    id: 'seedream-4-5',
    name: 'Seedream 4.5',
    description: 'ByteDance unified generation and editing. Strong reference-detail retention.',
    loraCapable: false,
    providers: {
      runware: {
        slug: 'bytedance:seedream@4.5',
        verified: true,
        note: 'Live-tested end to end. Area must be 3.69-16.78MP — this is the model that produced invalidPixels ' +
          'at 1024x1024. No steps/CFGScale documented.',
        dimensions: {
          kind: 'range',
          minEdge: 256,
          maxEdge: 16383,
          increment: 1,
          minPixels: 3_686_400,
          maxPixels: 16_777_216,
        },
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 14,
      },
      fal: {
        slug: 'fal-ai/bytedance/seedream/v4.5/edit',
        verified: false,
        note: 'VERIFY against fal.ai/explore before trusting.',
        dimensions: { kind: 'provider-default' },
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 10,
      },
      replicate: {
        slug: 'bytedance/seedream-4.5',
        verified: false,
        note: 'Replicate carries the Seedream family; confirm whether the slug is seedream-4 or seedream-4.5.',
        dimensions: { kind: 'provider-default' },
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 10,
      },
      atlas: {
        slug: 'bytedance/seedream-v4.5/edit',
        verified: true,
        note: 'Live-tested end to end. Confirmed via atlascloud.ai/models/bytedance/seedream-v4.5/edit. ' +
          'Field: images (array, max 10). $0.04/image.',
        dimensions: { kind: 'provider-default' },
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 10,
        imageInput: { kind: 'array', field: 'images', max: 10 },
      },
    },
  },
  {
    id: 'wan-2-7-image',
    name: 'Wan 2.7 Image',
    description: 'Alibaba unified image generation and editing. Best NSFW edit quality per the project owner.',
    loraCapable: false,
    providers: {
      runware: {
        slug: 'alibaba:wan@2.7-image',
        verified: true,
        note: 'Live-tested end to end. 768-2048 per side in 16px increments.',
        dimensions: {
          kind: 'range',
          minEdge: 768,
          maxEdge: 2048,
          increment: 16,
        },
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 1,
      },
      fal: {
        slug: 'fal-ai/wan/v2.7/image-to-image',
        verified: false,
        note: 'VERIFY — the handoff itself flagged this fal slug as unknown.',
        dimensions: { kind: 'provider-default' },
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 1,
      },
      replicate: {
        slug: 'wan-video/wan-2.7-image',
        verified: false,
        note: 'VERIFY on replicate.com before trusting.',
        dimensions: { kind: 'provider-default' },
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 1,
      },
      atlas: {
        slug: 'alibaba/wan-2.7/image-edit',
        verified: true,
        note: 'Live-tested end to end. Confirmed via atlascloud.ai/models/alibaba/wan-2.7/image-edit. ' +
          'Field: images (array, min 1 max 9). size is "1K" or "2K" (default 2K) rather than explicit width/height.',
        dimensions: { kind: 'provider-default' },
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 9,
        imageInput: { kind: 'array', field: 'images', max: 9 },
      },
    },
  },
  {
    id: 'grok-imagine-image',
    name: 'Grok Imagine Image',
    description: 'xAI image editing. Takes up to 3 reference images.',
    loraCapable: false,
    providers: {
      runware: {
        slug: 'xai:grok-imagine@image',
        verified: true,
        note: 'Live-tested end to end. Uses a resolution preset; width/height cannot be sent alongside it. No steps/CFGScale.',
        dimensions: { kind: 'resolution-preset', preset: '1K' },
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 3,
      },
      fal: {
        slug: 'xai/grok-imagine-image/edit',
        verified: false,
        note: 'VERIFY against fal.ai/explore before trusting.',
        dimensions: { kind: 'provider-default' },
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 3,
      },
      replicate: {
        slug: 'xai/grok-imagine-image',
        verified: false,
        note: 'VERIFY on replicate.com before trusting.',
        dimensions: { kind: 'provider-default' },
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 3,
      },
      atlas: {
        slug: 'xai/grok-imagine-image-quality/edit',
        verified: true,
        note: 'Live-tested end to end. The image field name (single "image", matching Kontext) was an inferred ' +
          'guess going in — no generateImage docs page for this specific slug was found — and the live call ' +
          'confirmed it correct.',
        dimensions: { kind: 'provider-default' },
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 7,
        imageInput: { kind: 'single', field: 'image' },
      },
    },
  },
];

export const DEFAULT_PROVIDER: ProviderId = 'runware';
export const DEFAULT_MODEL_ID = 'flux-kontext-dev';

/** Per-provider ceiling on how many LoRAs may be stacked in one request. */
export const LORA_CAPS: Record<ProviderId, number> = {
  runware: Infinity,
  fal: 3,
  atlas: 3,
  replicate: 1,
};

export function getModel(modelId: string): EditModel | undefined {
  return MODELS.find((m) => m.id === modelId);
}

export function getVariant(modelId: string, provider: ProviderId): ModelVariant | undefined {
  return getModel(modelId)?.providers[provider];
}

/** True when this model can actually be run on this provider. */
export function isSupported(modelId: string, provider: ProviderId): boolean {
  return !!getVariant(modelId, provider);
}

/**
 * Resolve a caller-supplied model id to a provider variant.
 *
 * Also accepts a raw provider slug, so settings saved before this registry existed
 * (which stored e.g. "runware:106@1" directly) keep working instead of hard-failing.
 */
export function resolveModel(
  modelId: string | undefined,
  provider: ProviderId
): { model: EditModel; variant: ModelVariant } {
  const requested = modelId || DEFAULT_MODEL_ID;

  const direct = getModel(requested);
  if (direct) {
    const variant = direct.providers[provider];
    if (!variant) {
      const available = Object.keys(direct.providers).join(', ');
      throw new Error(
        `Model "${direct.name}" is not available on ${provider}. Available on: ${available || 'no providers'}.`
      );
    }
    return { model: direct, variant };
  }

  // Legacy: a raw provider slug rather than one of our canonical ids.
  for (const model of MODELS) {
    const variant = model.providers[provider];
    if (variant && variant.slug === requested) {
      return { model, variant };
    }
  }

  const known = MODELS.filter((m) => m.providers[provider]).map((m) => m.id).join(', ');
  throw new Error(`Unknown model "${requested}" for ${provider}. Known models: ${known}.`);
}

/**
 * The shape the settings API exposes to the UI: one entry per provider, listing
 * only the models that provider can actually run.
 */
export function providerModelList(provider: ProviderId) {
  return MODELS.filter((m) => m.providers[provider]).map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    loraCapable: m.loraCapable,
    verified: !!m.providers[provider]?.verified,
  }));
}
