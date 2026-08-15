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
  /**
   * Measured mean wall-clock seconds for one full edit through this app,
   * benchmarked 2026-08-15 (2 runs each, same 1536x2048 source photo, backend
   * called directly so no proxy timeout could truncate it). This is end-to-end
   * request time — provider queue included — not the provider's own "predict"
   * metric, because queue time is what the user actually waits through. Null
   * means not measurable at benchmark time (see `speedNote`).
   *
   * Kept as measured data rather than a guess: any model averaging over 150s
   * is removed, so these numbers are the evidence for what stays.
   */
  avgSeconds?: number | null;
  /** Why avgSeconds is null, or a caveat on the number. */
  speedNote?: string;
  /**
   * Approximate USD per image, from the provider's own published pricing (not
   * inferred). Null where the provider publishes no flat per-image figure.
   */
  costUsd?: number | null;
  /** Human-readable pricing detail — tiers, resolution caveats, extras. */
  costNote?: string;
  /**
   * Runware only. Some models take extra settings nested under
   * `providerSettings.<key>` (e.g. `providerSettings.bfl.safetyTolerance`).
   * Static values only — merged into the task as-is, not user-configurable per
   * request. Used here to set each model's documented content-filtering dial to
   * its most permissive value, the same pattern already used for Fal
   * (`enable_safety_checker: false`) and Replicate (`disable_safety_checker: true`).
   */
  runwareProviderSettingsKey?: string;
  runwareProviderSettings?: Record<string, unknown>;
  /**
   * Runware only. A distinct mechanism from the pair above: some models' extra
   * settings sit directly on the task object, not nested under
   * `providerSettings.<key>` — confirmed for Wan 2.7 Image Pro, whose docs say
   * plainly "no providerSettings parameter appears... safety configuration is
   * platform-level, not provider-specific," i.e. `task.safety.checkContent`
   * rather than `task.providerSettings.alibaba.checkContent`. Kept separate from
   * runwareProviderSettings rather than folding one into the other so each
   * model's note can point at the one that's actually true for it.
   */
  runwareExtraFields?: Record<string, unknown>;
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
        avgSeconds: 26.8,
        costUsd: null,
        costNote: 'Runware publishes no flat per-image price for Kontext dev — it is billed by compute/steps. Its own model docs page has no pricing section, unlike the pro/max pages.',
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
        avgSeconds: null,
        speedNote: 'Not measured — the Fal account is locked with an exhausted balance, so no timing exists for either Fal model. Top up and re-benchmark before trusting Fal for anything time-sensitive.',
        costUsd: null,
        costNote: 'Not recorded — account locked, pricing not confirmed live.',
      },
      // replicate REMOVED 2026-08-15 (latency). Benchmarked at 208.0s on the one
      // run that completed; the second exceeded 300s without returning. Far over
      // the 150s bar. Atlas runs the identical model in ~23.9s, so nothing is lost.
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
        avgSeconds: 23.9,
        costUsd: 0.025,
        costNote: '$0.025 per image.',
      },
    },
  },
  {
    id: 'flux-kontext-dev-lora',
    name: 'FLUX Kontext Dev LoRA',
    description: 'Kontext Dev with LoRA adapters. The only model the LoRA picker applies to.',
    loraCapable: true,
    providers: {
      // runware REMOVED 2026-08-15. Not a latency call — this variant failed 100%
      // of the time in 2.3s with `unsupportedLoraModel`. Runware cannot apply LoRAs
      // to Kontext (platform limitation, exhaustively confirmed; see the Removed
      // variants note at the bottom of this file). Offering it only produced a
      // guaranteed error, so it is no longer selectable. providers/runware.ts still
      // throws a clear error if a stale saved setting reaches it.
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
        avgSeconds: null,
        speedNote: 'Not measured — the Fal account is locked with an exhausted balance, so no timing exists for either Fal model. Top up and re-benchmark before trusting Fal for anything time-sensitive.',
        costUsd: null,
        costNote: 'Not recorded — account locked, pricing not confirmed live.',
      },
      // replicate REMOVED 2026-08-15 (latency). Benchmarked at 240.2s completing,
      // with another run exceeding 300s. Replicate's queue wait alone measured
      // 128-226s before the model even started, which is a platform characteristic
      // and not tunable from here. Atlas runs this same LoRA model in ~27.4s.
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
        avgSeconds: 27.4,
        costUsd: 0.03,
        costNote: '$0.03 per image.',
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
        avgSeconds: 33.9,
        costUsd: 0.04,
        costNote: '$0.04 per image at 2K and 4K.',
      },
      // fal + replicate REMOVED 2026-08-15 — see the "Removed variants" note at
      // the bottom of this file. Both endpoints exist but take an image field
      // this codebase does not send (fal wants `image_urls` as an array, not
      // `image_url`; Replicate wants `image_input`, not `input_image`), so both
      // would have ignored the user's photo instead of editing it.
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
        avgSeconds: 23.2,
        costUsd: 0.04,
        costNote: '$0.04 per image.',
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
        avgSeconds: 15.5,
        costUsd: 0.03,
        costNote: '$0.03 per image at 1024x1024.',
      },
      // fal + replicate REMOVED 2026-08-15 — see the "Removed variants" note at
      // the bottom of this file. fal has no Wan 2.7 image-to-image endpoint at
      // all (only text-to-image), and Replicate's takes `images`, not
      // `input_image`.
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
        avgSeconds: 23.0,
        costUsd: 0.03,
        costNote: '$0.03 per image.',
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
        avgSeconds: 16.0,
        costUsd: 0.02,
        costNote: '$0.02 per image at 1024x1024, plus $0.002 per input image when editing.',
      },
      // fal + replicate REMOVED 2026-08-15 — see the "Removed variants" note at
      // the bottom of this file. fal wants `image_urls` (array), Replicate wants
      // `image`; neither matches what those provider files send.
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
        avgSeconds: 15.1,
        costUsd: 0.05,
        costNote: '$0.05 per image at 1K, $0.07 at 2K.',
      },
    },
  },

  // ---------------------------------------------------------------------
  // Premium / higher-cost tier — Runware only, added on request as
  // standalone alternatives to Kontext Dev that don't depend on LoRA support
  // (which Runware doesn't have for Kontext Dev — see that model's note
  // above). Each sets its documented content-filtering dial to the most
  // permissive value it exposes, the same pattern already used for Fal
  // (enable_safety_checker: false) and Replicate (disable_safety_checker:
  // true). That is a provider-exposed setting, not a bypass of anything —
  // OpenAI's GPT Image 2 in particular still enforces its own policy
  // server-side regardless of the `moderation: "low"` request parameter, so
  // it is the most conservatively filtered of the five even with that set.
  // ---------------------------------------------------------------------
  {
    id: 'flux-kontext-pro',
    name: 'FLUX Kontext Pro',
    description: 'Hosted Kontext, better prompt adherence and detail than Dev. Pricier per edit.',
    loraCapable: false,
    providers: {
      runware: {
        slug: 'bfl:3@1',
        verified: true,
        note: 'Confirmed at runware.ai/docs/models/bfl-flux-1-kontext-pro. Up to 2 reference images, same 9 ' +
          'fixed Kontext dimension pairs as Dev. No steps/CFGScale documented (matches Dev\'s pro/max behaviour). ' +
          'providerSettings.bfl is flat — allowed keys are promptUpsampling, interval, raw, safetyTolerance ' +
          'ONLY. A nested safety.checkContent object was tried first (per doc-summary research) and rejected ' +
          'live with invalidProviderSettings naming the real key list; there is no separate checkContent field ' +
          'for this model. safetyTolerance 0-6, 6=most permissive (already the documented default; sent ' +
          'explicitly rather than relying on it staying that way).',
        dimensions: KONTEXT_DIMENSIONS,
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 2,
        avgSeconds: 13.9,
        costUsd: 0.04,
        costNote: '$0.04 per image at 1024x1024.',
        runwareProviderSettingsKey: 'bfl',
        runwareProviderSettings: { safetyTolerance: 6 },
      },
    },
  },
  {
    id: 'flux-kontext-max',
    name: 'FLUX Kontext Max',
    description: 'Top-tier Kontext. Best identity retention of the family. Most expensive Kontext option.',
    loraCapable: false,
    providers: {
      runware: {
        slug: 'bfl:4@1',
        verified: true,
        note: 'Confirmed at runware.ai/docs/models/bfl-flux-1-kontext-max. $0.08 at 1024x1024. Same shape as ' +
          'Kontext Pro otherwise (2 reference images, 9 fixed dimension pairs, no steps/CFGScale, flat ' +
          'providerSettings.bfl.safetyTolerance — see Kontext Pro\'s note for the invalidProviderSettings ' +
          'error a nested safety object produced live).',
        dimensions: KONTEXT_DIMENSIONS,
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 2,
        avgSeconds: 15.0,
        costUsd: 0.08,
        costNote: '$0.08 per image at 1024x1024.',
        runwareProviderSettingsKey: 'bfl',
        runwareProviderSettings: { safetyTolerance: 6 },
      },
    },
  },
  {
    id: 'seedream-5-pro',
    name: 'Seedream 5.0 Pro',
    description: 'ByteDance flagship. Up to 10 reference images, precise local edits. Newer and pricier than 4.5.',
    loraCapable: false,
    providers: {
      runware: {
        slug: 'bytedance:seedream@5.0-pro',
        verified: true,
        note: 'Confirmed at runware.ai/docs/models/bytedance-seedream-5-0-pro. Area 921,600-4,624,220px (a ' +
          'DIFFERENT band from Seedream 4.5\'s 3,686,400-16,777,216 — each model gets its own DimensionRule, ' +
          'not a shared constant, on purpose). $0.048/image at 1.5K, $0.096 at 2K. Up to 10 reference images. ' +
          'No content-filtering toggle for this model: providerSettings.bytedance was tried (per doc-summary ' +
          'research suggesting a checkContent field) and rejected live with invalidProviderSettings — the real ' +
          'allowed keys are maxSequentialImages, optimizePromptMode, byok, none of them safety-related. Runware ' +
          'exposes no override for this model\'s content filtering; no steps/CFGScale documented either. ' +
          'CAVEAT: the request shape itself is confirmed correct (passed validation cleanly both times, no 400), ' +
          'but two live attempts both failed the same way — a genuine server-side 504 from Runware ' +
          '(failedTaskTimeout, "results not received within the expected time window") at ~122s each time, not ' +
          'a client-side timeout. Reads as Runware infrastructure load for this specific model rather than ' +
          'anything fixable here; worth retrying at a different time rather than assuming it never works.',
        dimensions: {
          kind: 'range',
          minEdge: 256,
          maxEdge: 16383,
          increment: 1,
          minPixels: 921_600,
          maxPixels: 4_624_220,
        },
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 10,
        avgSeconds: 113.4,
        speedNote: 'By far the slowest surviving model (106.3s and 120.4s measured). Under the 150s bar so it stays, but expect a long wait. Two earlier attempts on a different day failed outright with a Runware-side 504 at ~122s.',
        costUsd: 0.048,
        costNote: '$0.04815 per image up to 2.36MP (1.5K), $0.0963 above that (2K). Extra reference images $0.00321 each; the first is free.',
      },
    },
  },
  {
    id: 'wan-2-7-image-pro',
    name: 'Wan 2.7 Image Pro',
    description: 'Alibaba. Pro tier of the standard Wan 2.7 Image model — enhanced detail preservation and up to 9 reference images for complex, multi-element edits. Pricier than the base Wan 2.7 model already in the default set.',
    loraCapable: false,
    providers: {
      runware: {
        slug: 'alibaba:wan@2.7-image-pro',
        verified: true,
        note: 'Confirmed at runware.ai/docs/models/alibaba-wan2-7-image-pro. Width/height 768-4096px in 16px ' +
          'steps UNEDITED, but "with reference images: both width and height capped at 2048" — this app always ' +
          'sends a reference image (it is an editor, never pure text-to-image), so 2048 is modelled as the real ' +
          'maxEdge here rather than the unconstrained 4096. No area-total requirement documented, unlike ' +
          'Seedream/GPT Image. Up to 9 reference images; also exposes settings.editRegions (bounding-box' +
          '-targeted edits) which this project does not use. No steps/CFGScale. Distinct from the other four ' +
          'premium models: safety.checkContent is a FLAT field directly on the task, not nested under ' +
          'providerSettings — the docs say plainly no providerSettings parameter exists for this model, safety ' +
          'is platform-level here rather than provider-specific (see runwareExtraFields in models.ts).',
        dimensions: { kind: 'range', minEdge: 768, maxEdge: 2048, increment: 16 },
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 9,
        avgSeconds: 19.8,
        speedNote: 'Single sample — the second benchmark run hit a Runware balance error, not a model failure.',
        costUsd: 0.075,
        costNote: '$0.075 per image at 1024x1024, 30 steps.',
        runwareExtraFields: { safety: { checkContent: false } },
      },
    },
  },
  {
    id: 'qwen-image-2-pro',
    name: 'Qwen Image 2.0 Pro',
    description: 'Alibaba. Optimized detail, layout and text accuracy for professional/enterprise-grade edits.',
    loraCapable: false,
    providers: {
      runware: {
        slug: 'alibaba:qwen-image@2.0-pro',
        verified: true,
        note: 'Confirmed at runware.ai/docs/models/alibaba-qwen-image-2-0-pro. Area cap 2,097,152px (2048x1024 ' +
          'equivalent); docs note a temporary backend limit of 2048 on either edge, planned for removal — using ' +
          '2048 as maxEdge for now rather than the area math\'s own higher ceiling, so a future Runware-side ' +
          'relaxation just makes requests slightly less tight instead of requiring a code change. Up to 3 ' +
          'reference images. No safety/moderation parameter was documented for this model — none added rather ' +
          'than guessing one. No steps/CFGScale documented.',
        dimensions: {
          kind: 'range',
          minEdge: 256,
          maxEdge: 2048,
          increment: 1,
          maxPixels: 2_097_152,
        },
        supportsSteps: false,
        supportsCfg: false,
        supportsNegativePrompt: false,
        maxReferenceImages: 3,
        avgSeconds: null,
        speedNote: 'Not measured — the Runware account ran out of credits before this model was reached. Every other Runware model came in between 13.9s and 33.9s except Seedream 5.0 Pro, so this is expected to be fast, but that is an expectation and not a measurement.',
        costUsd: 0.075,
        costNote: '$0.075 per image at 1024x1024, 30 steps.',
      },
    },
  },
];

/**
 * Removed variants — audited live on 2026-08-15. Do not re-add from memory.
 *
 * Six entries were carrying `verified: false` with "VERIFY before trusting"
 * notes. Every one was checked against the provider's live API. The slugs were
 * mostly *right*, which is exactly why this was worth checking: five of the six
 * endpoints genuinely exist, so a smoke test that only asked "does the slug
 * resolve?" would have passed them all. They were removed because this codebase
 * cannot send them a usable image, not because they are fictional.
 *
 *   Replicate — schemas read from GET /v1/models/{owner}/{name}:
 *     bytedance/seedream-4.5      exists; image field is `image_input`
 *     wan-video/wan-2.7-image     exists; image field is `images`
 *     xai/grok-imagine-image      exists; image field is `image`
 *   providers/replicate.ts sends `input_image` (correct for Kontext, which is
 *   all it was ever verified against). Cog SILENTLY DROPS unknown top-level
 *   fields — the same trap that produced the earlier guidance_scale and
 *   safety_tolerance bugs — so these would not have errored. They would have
 *   ignored the user's photo and returned a fresh text-to-image generation that
 *   looks like a plausible edit. That is the worst failure mode available.
 *
 *   Fal — schemas read from fal.ai/api/openapi/queue/openapi.json:
 *     fal-ai/bytedance/seedream/v4.5/edit   exists; wants `image_urls` (ARRAY)
 *     xai/grok-imagine-image/edit           exists; wants `image_urls` (ARRAY)
 *     fal-ai/wan/v2.7/image-to-image        DOES NOT EXIST (404). Only
 *       fal-ai/wan/v2.7/text-to-image is published, which cannot edit at all.
 *   providers/fal.ts sends `image_url` (singular).
 *
 * Re-adding any of these means teaching the provider file that model's image
 * field — the registry already models this for Atlas via `imageInput`, so
 * extend that to Replicate/Fal rather than hardcoding a second convention — and
 * then confirming it live with a real edit before setting `verified: true`.
 *
 * ---------------------------------------------------------------------------
 * SECOND PASS, same day — removed on measured LATENCY, not on correctness.
 *
 * Every surviving combination was benchmarked end to end (2 runs each, one
 * 1536x2048 source photo, backend called directly so no proxy could truncate
 * the timing). The bar: drop anything averaging over 150s.
 *
 *   Replicate flux-kontext-dev       208.0s completing; a second run passed 300s
 *   Replicate flux-kontext-dev-lora  240.2s completing; a second run passed 300s
 *
 * Both are gone, which leaves Replicate with no models at all — deliberate.
 * The cause is Replicate's queue, not the models: prediction metrics showed
 * 128-226s of QUEUE WAIT before inference even began, against predict times of
 * 4.6-237.6s. Nothing in this codebase can shorten that. No capability is lost,
 * because Atlas serves both of those exact models at ~23.9s and ~27.4s.
 * providers/replicate.ts is intentionally left in place, so restoring Replicate
 * is just re-adding variants here if its queue behaviour ever improves.
 *
 *   Runware flux-kontext-dev-lora    removed, but for correctness not speed: it
 *   failed 100% of runs in ~2.3s with `unsupportedLoraModel`. See that model's
 *   inline note. It was a guaranteed-error menu entry.
 *
 * Kept despite being slow: Runware Seedream 5.0 Pro at 113.4s (106.3 / 120.4).
 * Under the bar, and it is a flagship-quality option, so it stays — its
 * avgSeconds is surfaced in the UI so the wait is visible before committing.
 *
 * Resulting catalogue: Runware 9, Atlas 5, Fal 2 (unmeasured, account locked),
 * Replicate 0.
 */

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
  return MODELS.filter((m) => m.providers[provider]).map((m) => {
    const v = m.providers[provider]!;
    return {
      id: m.id,
      name: m.name,
      description: m.description,
      loraCapable: m.loraCapable,
      verified: !!v.verified,
      // Surfaced in the model picker so the speed/price tradeoff is visible at
      // the point of choosing, rather than discovered by waiting.
      avgSeconds: v.avgSeconds ?? null,
      speedNote: v.speedNote ?? null,
      costUsd: v.costUsd ?? null,
      costNote: v.costNote ?? null,
    };
  });
}

/** Providers that actually have at least one runnable model. */
export function providersWithModels(): ProviderId[] {
  const all: ProviderId[] = ['runware', 'fal', 'replicate', 'atlas'];
  return all.filter((p) => MODELS.some((m) => m.providers[p]));
}
