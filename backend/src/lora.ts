/**
 * LoRA layer, ported from the proven implementation in the SillyTavern bridge
 * (`flux_lora_bridge.py`). The logic there is battle-tested against Runware, so
 * this is a port rather than a reimplementation.
 *
 * Two source files drive it:
 *  - master_lora_dict.json    the catalogue shown in the UI, with prompt fragments
 *  - runware_lora_mapping.json  HuggingFace URL -> Runware AIR id cache
 *
 * Runware needs an AIR id, so a LoRA has to be uploaded once and cached. Every
 * other provider takes the HuggingFace .safetensors URL directly.
 */

import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { LORA_CAPS, ProviderId } from './models';

const RUNWARE_API_URL = 'https://api.runware.ai/v1';

/** Runtime (writable, volume-mounted) location of the AIR cache. */
const DATA_DIR = path.join(__dirname, '../data');
const MAPPING_PATH = path.join(DATA_DIR, 'runware_lora_mapping.json');

/** Seed copies committed to the repo, used on first run. */
const SEED_MAPPING_PATH = path.join(__dirname, '../../runware_lora_mapping.json');
const LORA_DICT_PATH = path.join(__dirname, '../../master_lora_dict.json');

export interface LoraEntry {
  id: string;
  name: string;
  url: string;
  weight: number;
  category: string;
  triggerWords: string[];
  prependPrompt: string;
  appendPrompt: string;
  negativePrompt: string;
  permanent: boolean;
}

export interface LoraDictConfig {
  defaultSteps: number;
  defaultGuidanceScale: number;
  permanentLoras: string[];
  defaultNegativePrompt: string;
}

/** A LoRA as selected in a request: an id from the catalogue, or a raw URL/AIR. */
export interface LoraSelection {
  id?: string;
  url?: string;
  weight?: number;
}

export interface ResolvedLora {
  /** Runware AIR id, or a HuggingFace URL for the other providers. */
  ref: string;
  weight: number;
}

interface MappingEntry {
  runware_id: string;
  uploaded_at: string;
}

type Mapping = Record<string, MappingEntry>;

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

let catalogueCache: { entries: LoraEntry[]; config: LoraDictConfig } | null = null;

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch (err: any) {
    console.error(`[LoRA] Could not read ${filePath}: ${err.message}`);
    return fallback;
  }
}

export function loadCatalogue(): { entries: LoraEntry[]; config: LoraDictConfig } {
  if (catalogueCache) return catalogueCache;

  const raw = readJson<any>(LORA_DICT_PATH, { config: {}, loras: {} });
  const rawConfig = raw.config || {};

  const config: LoraDictConfig = {
    defaultSteps: rawConfig.default_steps ?? 40,
    defaultGuidanceScale: rawConfig.default_guidance_scale ?? 3.5,
    permanentLoras: rawConfig.permanent_loras || [],
    defaultNegativePrompt: rawConfig.default_negative_prompt || '',
  };

  const entries: LoraEntry[] = Object.entries(raw.loras || {}).map(([id, value]: [string, any]) => ({
    id,
    name: value.name || id,
    url: value.url || '',
    weight: typeof value.weight === 'number' ? value.weight : 1.0,
    category: value.category || 'general',
    triggerWords: value.trigger_words || [],
    prependPrompt: value.prepend_prompt || '',
    appendPrompt: value.append_prompt || '',
    negativePrompt: value.negative_prompt || '',
    permanent: !!value.permanent,
  })).filter((entry) => !!entry.url);

  catalogueCache = { entries, config };
  console.log(`[LoRA] Catalogue loaded: ${entries.length} LoRAs`);
  return catalogueCache;
}

export function findLora(selection: LoraSelection): LoraEntry | undefined {
  const { entries } = loadCatalogue();
  if (selection.id) {
    const byId = entries.find((entry) => entry.id === selection.id);
    if (byId) return byId;
  }
  if (selection.url) {
    return entries.find((entry) => entry.url === selection.url);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// AIR ids and the mapping cache
// ---------------------------------------------------------------------------

/**
 * AIR ids are derived from the URL, so the same LoRA always maps to the same id
 * on Runware and re-uploading is idempotent.
 */
export function generateAirId(hfUrl: string): { airId: string; hash: string } {
  const hash = crypto
    .createHash('sha256')
    .update(hfUrl.trim().toLowerCase(), 'utf-8')
    .digest('hex')
    .slice(0, 12);
  return { airId: `deathwalker:${hash}@1`, hash };
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadMapping(): Mapping {
  ensureDataDir();
  if (!fs.existsSync(MAPPING_PATH)) {
    // First run inside a fresh container: seed from the committed copy so we don't
    // re-upload every LoRA that has already been uploaded once.
    const seed = readJson<Mapping>(SEED_MAPPING_PATH, {});
    if (Object.keys(seed).length) {
      fs.writeFileSync(MAPPING_PATH, JSON.stringify(seed, null, 2));
      console.log(`[LoRA] Seeded AIR cache with ${Object.keys(seed).length} entries`);
    }
    return seed;
  }
  return readJson<Mapping>(MAPPING_PATH, {});
}

export function saveMapping(mapping: Mapping): void {
  ensureDataDir();
  fs.writeFileSync(MAPPING_PATH, JSON.stringify(mapping, null, 2));
}

/**
 * Drop cache entries whose AIR id isn't the deterministic hash of their URL.
 *
 * Seven entries were hand-created through Postman early in the project with
 * made-up ids (deathwalker:424242@1 and friends). Runware has no such models, so
 * selecting those LoRAs silently produces an unmodified image. Removing them here
 * forces a correct re-upload on next use.
 *
 * Returns the ids that were evicted, for logging.
 */
export function healMapping(mapping: Mapping): string[] {
  const evicted: string[] = [];
  for (const [url, entry] of Object.entries(mapping)) {
    const { airId } = generateAirId(url);
    if (entry?.runware_id !== airId) {
      evicted.push(entry?.runware_id || '(empty)');
      delete mapping[url];
    }
  }
  if (evicted.length) {
    console.warn(
      `[LoRA] Evicted ${evicted.length} invalid AIR id(s) from the cache; they will be re-uploaded: ${evicted.join(', ')}`
    );
  }
  return evicted;
}

// ---------------------------------------------------------------------------
// Runware upload
// ---------------------------------------------------------------------------

export async function uploadLoraToRunware(hfUrl: string, apiKey: string): Promise<string> {
  const { airId, hash } = generateAirId(hfUrl);
  const modelName = decodeURIComponent(hfUrl.split('/').pop() || 'lora')
    .replace(/\.safetensors$/i, '')
    .replace(/[ %]/g, '_');

  const payload = [
    {
      taskType: 'modelUpload',
      taskUUID: uuidv4(),
      deliveryMethod: 'sync',
      category: 'lora',
      // 'flux1d' is correct — confirmed against Runware's own error response,
      // which lists every valid architecture value (GET the full enum by sending
      // an invalid one; it echoes the complete allowedValues list). There is no
      // separate "kontext" tag: the FLUX family only has 'flux1s' and 'flux1d'.
      // A LoRA uploaded here still gets rejected at INFERENCE time when attached
      // to runware:106@1 (Kontext Dev) with 'unsupportedLoraModel' — that is a
      // real Runware platform limitation (Kontext's extra reference-image
      // conditioning makes it structurally different from plain FLUX.1-dev, even
      // though BFL's own position — cited in this project's HANDOFF.md — is that
      // FLUX.1-dev LoRAs load on Kontext elsewhere, e.g. ComfyUI/diffusers, with a
      // quality tradeoff). Runware enforces stricter compatibility than that.
      // Confirmed live: no upload-metadata change fixes it, so the retry logic in
      // runware.ts's edit() does not attempt one for this specific error anymore.
      architecture: 'flux1d',
      format: 'safetensors',
      air: airId,
      uniqueIdentifier: hash,
      name: modelName,
      version: '1.0',
      downloadURL: hfUrl,
      defaultWeight: 1.0,
      private: true,
    },
  ];

  console.log(`[LoRA] Uploading ${modelName} as ${airId}`);
  try {
    const response = await axios.post(RUNWARE_API_URL, payload, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000,
    });
    const first = response.data?.data?.[0];
    if (first?.error) {
      throw new Error(`Runware rejected the upload: ${JSON.stringify(first.error)}`);
    }
    console.log(`[LoRA] Uploaded ${airId} (status: ${first?.status ?? 'unknown'})`);
    return airId;
  } catch (err: any) {
    // A timeout usually means the upload is still running server-side. The AIR is
    // deterministic, so returning it lets the inference call proceed and the model
    // resolve once Runware finishes ingesting it.
    if (err.code === 'ECONNABORTED') {
      console.warn(`[LoRA] Upload timed out; proceeding with ${airId}`);
      return airId;
    }
    const detail = err.response ? JSON.stringify(err.response.data).slice(0, 300) : err.message;
    throw new Error(`LoRA upload failed for ${modelName}: ${detail}`);
  }
}

/** True for a reference that is already a provider-qualified model id. */
function isProviderRef(value: string): boolean {
  return (
    /^(runware|civitai|hfk|deathwalker|bfl|bytedance|alibaba|xai):/i.test(value) ||
    (value.includes(':') && value.includes('@') && !value.startsWith('http'))
  );
}

/**
 * Turn selected LoRAs into Runware AIR ids, uploading and caching any that haven't
 * been seen before. Self-healing runs first so bad cache entries are re-uploaded.
 */
export async function resolveRunwareLoras(
  loras: ResolvedLora[],
  apiKey: string
): Promise<ResolvedLora[]> {
  if (!loras.length) return [];

  const mapping = loadMapping();
  healMapping(mapping);

  const resolved: ResolvedLora[] = [];
  let dirty = false;

  for (const lora of loras) {
    const ref = (lora.ref || '').trim();
    if (!ref) continue;

    if (isProviderRef(ref)) {
      resolved.push({ ref, weight: lora.weight });
      continue;
    }

    if (!ref.startsWith('http')) {
      console.warn(`[LoRA] Skipping unrecognised reference: ${ref}`);
      continue;
    }

    const cached = mapping[ref];
    if (cached?.runware_id) {
      resolved.push({ ref: cached.runware_id, weight: lora.weight });
      continue;
    }

    try {
      const airId = await uploadLoraToRunware(ref, apiKey);
      mapping[ref] = { runware_id: airId, uploaded_at: new Date().toISOString() };
      dirty = true;
      resolved.push({ ref: airId, weight: lora.weight });
    } catch (err: any) {
      // One failed LoRA shouldn't sink the whole edit.
      console.error(`[LoRA] ${err.message}`);
    }
  }

  if (dirty) saveMapping(mapping);
  return resolved;
}

// ---------------------------------------------------------------------------
// Selection -> per-provider references
// ---------------------------------------------------------------------------

/**
 * Apply the provider's LoRA ceiling. Runware stacks without limit; fal and Atlas
 * take 3; Replicate takes 1. Over-cap selections are trimmed rather than rejected,
 * so a user who picks four LoRAs still gets an edit.
 */
export function capForProvider(loras: ResolvedLora[], provider: ProviderId): ResolvedLora[] {
  const cap = LORA_CAPS[provider] ?? 1;
  if (loras.length <= cap) return loras;
  console.warn(`[LoRA] ${provider} accepts at most ${cap}; using the first ${cap} of ${loras.length}`);
  return loras.slice(0, cap);
}

/**
 * Expand the selections into concrete references (HuggingFace URLs), resolving ids
 * against the catalogue and falling back to each LoRA's catalogue weight.
 */
export function toReferences(selections: LoraSelection[]): ResolvedLora[] {
  const out: ResolvedLora[] = [];
  for (const selection of selections || []) {
    const entry = findLora(selection);
    const ref = entry?.url || selection.url;
    if (!ref) {
      console.warn(`[LoRA] Could not resolve selection: ${JSON.stringify(selection)}`);
      continue;
    }
    out.push({ ref, weight: selection.weight ?? entry?.weight ?? 1.0 });
  }
  return out;
}

/**
 * Wrap the user's instruction in the trigger words the selected LoRAs need.
 *
 * Ported from the bridge's `build_enhanced_prompt`. Picking "Sara Ali Khan" and
 * typing "make her wear a red saree" has to reach the model as
 * "Sara ali khan, make her wear a red saree" or the LoRA never activates.
 */
export function buildEnhancedPrompt(
  prompt: string,
  selections: LoraSelection[]
): { prompt: string; negativePrompt: string } {
  const { config } = loadCatalogue();
  const prepends: string[] = [];
  const appends: string[] = [];
  const negatives: string[] = [];

  for (const selection of selections || []) {
    const entry = findLora(selection);
    if (!entry) continue;
    if (entry.prependPrompt) prepends.push(entry.prependPrompt);
    if (entry.appendPrompt) appends.push(entry.appendPrompt);
    if (entry.negativePrompt) negatives.push(entry.negativePrompt);
  }

  const enhanced = [...prepends, prompt.trim(), ...appends]
    .filter((part) => !!part && part.length > 0)
    .join(', ');

  if (config.defaultNegativePrompt) negatives.push(config.defaultNegativePrompt);
  const negativePrompt = Array.from(new Set(negatives.join(', ').split(', ').filter(Boolean))).join(', ');

  return { prompt: enhanced || prompt, negativePrompt };
}

/** Catalogue shaped for the UI dropdown, grouped by category. */
export function catalogueForUi() {
  const { entries, config } = loadCatalogue();
  const grouped: Record<string, { id: string; name: string; weight: number; triggerWords: string[] }[]> = {};
  for (const entry of entries) {
    (grouped[entry.category] ||= []).push({
      id: entry.id,
      name: entry.name,
      weight: entry.weight,
      triggerWords: entry.triggerWords,
    });
  }
  return { categories: grouped, caps: LORA_CAPS, config };
}
