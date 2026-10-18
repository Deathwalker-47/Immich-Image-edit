import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AppSettings } from '../providers';
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER, ProviderId, providerModelList } from '../models';

const router = Router();
const SETTINGS_FILE = path.join(__dirname, '../../data/settings.json');

// Ensure data dir exists
if (!fs.existsSync(path.dirname(SETTINGS_FILE))) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
}

/**
 * Provider metadata. The model lists come from models.ts so there is exactly one
 * source of truth — an earlier inline copy here drifted into slugs that don't
 * resolve, which is what produced the 404 / "Not Found" failures.
 */
const PROVIDER_META: { id: ProviderId; name: string; envKey: string }[] = [
  { id: 'runware', name: 'Runware', envKey: 'RUNWARE_API_KEY' },
  { id: 'fal', name: 'Fal.ai', envKey: 'FAL_KEY' },
  { id: 'replicate', name: 'Replicate', envKey: 'REPLICATE_API_TOKEN' },
  { id: 'atlas', name: 'Atlas Cloud', envKey: 'ATLAS_API_KEY' },
];
const PROVIDER_IDS = PROVIDER_META.map(p => p.id);

const MASK = '••••••••••••••••';

/**
 * Settings as the environment defines them. The Immich URL and every API key
 * come only from here: they are the values every request actually uses
 * (routes/immich.ts and each provider read process.env directly), so the
 * Settings dialog shows them read-only rather than offering edits that would be
 * saved and then ignored.
 *
 * A function, not a constant, because index.ts runs dotenv.config() after its
 * imports have been evaluated.
 */
function envSettings(): AppSettings {
  return {
    // IMMICH_URL is not one of the variables docker-compose actually passes — the
    // deployed env defines IMMICH_PUBLIC_URL (browser-facing) and
    // IMMICH_INTERNAL_URL (container-to-container). Reading only IMMICH_URL left
    // this blank in the Settings dialog, which reads as unconfigured even though
    // every Immich call was working, since the backend routes them via
    // IMMICH_INTERNAL_URL and the frontend only ever calls its own /api proxy.
    // Prefer the public URL — this field is labelled "for browser access".
    immichUrl:
      process.env.IMMICH_URL ||
      process.env.IMMICH_PUBLIC_URL ||
      process.env.IMMICH_INTERNAL_URL ||
      '',
    immichApiKey: process.env.IMMICH_API_KEY || '',
    defaultProvider: DEFAULT_PROVIDER,
    defaultStrength: 0.75,
    defaultSteps: 30,
    aiEditsAlbumName: 'AI Edits',
    providers: {
      fal: { apiKey: process.env.FAL_KEY || '', model: DEFAULT_MODEL_ID },
      runware: { apiKey: process.env.RUNWARE_API_KEY || '', model: DEFAULT_MODEL_ID },
      replicate: { apiKey: process.env.REPLICATE_API_TOKEN || '', model: DEFAULT_MODEL_ID },
      atlas: { apiKey: process.env.ATLAS_API_KEY || '', model: DEFAULT_MODEL_ID },
    }
  };
}

function readSavedFile(): Record<string, any> {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

/**
 * Environment values overlaid with the saved preferences. Only preference fields
 * are taken from settings.json — copies of keys or an Immich URL that older
 * versions of this route wrote there are ignored, never served or trusted.
 */
function currentSettings(): AppSettings {
  const settings = envSettings();
  const saved = readSavedFile();

  if (PROVIDER_IDS.includes(saved.defaultProvider)) settings.defaultProvider = saved.defaultProvider;
  if (typeof saved.defaultStrength === 'number') settings.defaultStrength = saved.defaultStrength;
  if (typeof saved.defaultSteps === 'number') settings.defaultSteps = saved.defaultSteps;
  if (typeof saved.aiEditsAlbumName === 'string') settings.aiEditsAlbumName = saved.aiEditsAlbumName;
  for (const id of PROVIDER_IDS) {
    const model = saved.providers?.[id]?.model;
    if (typeof model === 'string') settings.providers[id].model = model;
  }
  return settings;
}

type PrefsUpdate = {
  defaultProvider?: ProviderId;
  defaultStrength?: number;
  defaultSteps?: number;
  aiEditsAlbumName?: string;
  providers?: Partial<Record<ProviderId, { model: string }>>;
};

const ENV_ONLY_MESSAGE = 'is set in the server\'s .env file and cannot be changed from the browser';

/**
 * Validate a POST body against the preference allowlist. Anything else — the
 * Immich URL, any API key, or an unknown field — is refused outright rather than
 * dropped, so a client can't believe it changed something it didn't.
 */
function parsePrefsUpdate(body: any): { prefs: PrefsUpdate } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Expected a JSON object' };
  }

  const prefs: PrefsUpdate = {};
  for (const [field, value] of Object.entries(body)) {
    switch (field) {
      case 'immichUrl':
      case 'immichApiKey':
        return { error: `${field} ${ENV_ONLY_MESSAGE}` };

      case 'defaultProvider':
        if (!PROVIDER_IDS.includes(value as ProviderId)) return { error: `Unknown provider: ${String(value)}` };
        prefs.defaultProvider = value as ProviderId;
        break;

      case 'defaultStrength':
        if (typeof value !== 'number' || !(value >= 0 && value <= 1)) {
          return { error: 'defaultStrength must be a number from 0 to 1' };
        }
        prefs.defaultStrength = value;
        break;

      case 'defaultSteps':
        if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 150) {
          return { error: 'defaultSteps must be a whole number from 1 to 150' };
        }
        prefs.defaultSteps = value as number;
        break;

      case 'aiEditsAlbumName': {
        const name = typeof value === 'string' ? value.trim() : '';
        if (!name || name.length > 100) return { error: 'aiEditsAlbumName must be 1-100 characters' };
        prefs.aiEditsAlbumName = name;
        break;
      }

      case 'providers': {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return { error: 'providers must be an object' };
        }
        prefs.providers = {};
        for (const [id, provider] of Object.entries(value as Record<string, any>)) {
          if (!PROVIDER_IDS.includes(id as ProviderId)) return { error: `Unknown provider: ${id}` };
          if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
            return { error: `providers.${id} must be an object` };
          }
          for (const key of Object.keys(provider)) {
            if (key === 'apiKey') return { error: `providers.${id}.apiKey ${ENV_ONLY_MESSAGE}` };
            if (key !== 'model') return { error: `Unknown setting: providers.${id}.${key}` };
          }
          if (provider.model === undefined) continue;
          if (typeof provider.model !== 'string' || !provider.model || provider.model.length > 200) {
            return { error: `providers.${id}.model must be a non-empty string` };
          }
          prefs.providers[id as ProviderId] = { model: provider.model };
        }
        break;
      }

      default:
        return { error: `Unknown setting: ${field}` };
    }
  }
  return { prefs };
}

router.get('/', (req: Request, res: Response) => {
  try {
    // Mask API keys for frontend
    const masked = currentSettings();
    for (const provider of Object.values(masked.providers)) {
      if (provider.apiKey) provider.apiKey = MASK;
    }
    if (masked.immichApiKey) masked.immichApiKey = MASK;
    res.json(masked);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const parsed = parsePrefsUpdate(req.body);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { providers, ...topLevel } = parsed.prefs;

    // Other fields already in the file (including key copies an older version
    // wrote) are preserved as-is: they are ignored on read, and this route has no
    // business deleting data it didn't put there.
    const saved = readSavedFile();
    const next: Record<string, any> = { ...saved, ...topLevel };
    if (providers) {
      next.providers = { ...(saved.providers || {}) };
      for (const [id, { model }] of Object.entries(providers)) {
        next.providers[id] = { ...(saved.providers?.[id] || {}), model };
      }
    }

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/providers', (req: Request, res: Response) => {
  try {
    const current = currentSettings();

    // Providers with an empty model list are hidden rather than shown as a
    // selectable provider you can't actually run anything on. Replicate is in
    // that state deliberately — every model it offered averaged over 150s and
    // was removed (see models.ts). Its credentials and provider code remain, so
    // re-adding variants there brings it straight back into this list.
    const result = PROVIDER_META.filter(p => providerModelList(p.id).length > 0).map(p => {
      const models = providerModelList(p.id);
      const saved = current.providers[p.id]?.model;
      return {
        id: p.id,
        name: p.name,
        configured: !!process.env[p.envKey],
        // Never hand back a model this provider can no longer run — a setting
        // saved before a variant was removed would otherwise keep pointing at
        // it and fail on every edit.
        model: models.some(m => m.id === saved)
          ? saved
          : (models.some(m => m.id === DEFAULT_MODEL_ID) ? DEFAULT_MODEL_ID : models[0].id),
        models,
      };
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as settingsRouter };
