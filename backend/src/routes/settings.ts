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

export const defaultSettings: AppSettings = {
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

router.get('/', (req: Request, res: Response) => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      // Merge with defaults to ensure all fields exist
      const merged = { ...defaultSettings, ...data };
      
      // Mask API keys for frontend
      const masked = JSON.parse(JSON.stringify(merged));
      for (const [key, provider] of Object.entries(masked.providers)) {
        if ((provider as any).apiKey) {
          (provider as any).apiKey = '••••••••••••••••';
        }
      }
      if (masked.immichApiKey) masked.immichApiKey = '••••••••••••••••';
      
      res.json(masked);
    } else {
      const masked = JSON.parse(JSON.stringify(defaultSettings));
      for (const [key, provider] of Object.entries(masked.providers)) {
        if ((provider as any).apiKey) {
          (provider as any).apiKey = '••••••••••••••••';
        }
      }
      if (masked.immichApiKey) masked.immichApiKey = '••••••••••••••••';
      res.json(masked);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    let current = { ...defaultSettings };
    if (fs.existsSync(SETTINGS_FILE)) {
      current = { ...current, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) };
    }

    const updates = req.body;
    
    // Don't overwrite with masked keys
    if (updates.immichApiKey && updates.immichApiKey.includes('••••')) {
      delete updates.immichApiKey;
    }
    
    if (updates.providers) {
      for (const [key, provider] of Object.entries(updates.providers)) {
        if ((provider as any).apiKey && (provider as any).apiKey.includes('••••')) {
          delete (provider as any).apiKey;
        }
      }
    }

    // Merge deeply for providers
    const newSettings = { ...current, ...updates };
    if (updates.providers) {
      newSettings.providers = {
        fal: { ...current.providers.fal, ...(updates.providers.fal || {}) },
        runware: { ...current.providers.runware, ...(updates.providers.runware || {}) },
        replicate: { ...current.providers.replicate, ...(updates.providers.replicate || {}) },
        atlas: { ...current.providers.atlas, ...(updates.providers.atlas || {}) },
      };
    }

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(newSettings, null, 2));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/providers', (req: Request, res: Response) => {
  try {
    let current = { ...defaultSettings };
    if (fs.existsSync(SETTINGS_FILE)) {
      current = { ...current, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) };
    }

    const result = PROVIDER_META.map(p => {
      const pKey = p.id as keyof typeof current.providers;
      return {
        id: p.id,
        name: p.name,
        configured: !!current.providers[pKey]?.apiKey,
        model: current.providers[pKey]?.model || DEFAULT_MODEL_ID,
        models: providerModelList(p.id),
      };
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as settingsRouter };
