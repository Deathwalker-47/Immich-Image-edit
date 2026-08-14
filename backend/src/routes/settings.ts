import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AppSettings, ProviderInfo } from '../providers'; // adjust imports if needed

const router = Router();
const SETTINGS_FILE = path.join(__dirname, '../../data/settings.json');

// Ensure data dir exists
if (!fs.existsSync(path.dirname(SETTINGS_FILE))) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
}

// Default models by provider
const PROVIDER_MODELS: ProviderInfo[] = [
  {
    id: 'fal',
    name: 'Fal.ai',
    model: 'fal-ai/flux/dev/image-to-image',
    configured: false,
    models: [
      { id: 'fal-ai/flux/dev/image-to-image', name: 'FLUX Dev' },
      { id: 'fal-ai/flux-pro/v1.1/image-to-image', name: 'FLUX Pro 1.1' },
      { id: 'fal-ai/stable-diffusion-v3-medium/image-to-image', name: 'SD3 Medium' },
      { id: 'fal-ai/stable-diffusion-v35-large/image-to-image', name: 'SD3.5 Large' },
    ]
  },
  {
    id: 'runware',
    name: 'Runware',
    model: 'runware:106@1',
    configured: false,
    models: [
      { id: 'runware:106@1', name: 'FLUX Kontext Dev' },
      { id: 'runware:101@1', name: 'FLUX Dev' },
      { id: 'bytedance:seedream@4.5', name: 'Seedream 4.5' },
      { id: 'alibaba:wan@2.7-image-pro', name: 'Wan 2.7 Image Pro' },
    ]
  },
  {
    id: 'replicate',
    name: 'Replicate',
    model: 'black-forest-labs/flux-kontext-pro',
    configured: false,
    models: [
      { id: 'black-forest-labs/flux-kontext-pro', name: 'FLUX Kontext Pro' },
      { id: 'black-forest-labs/flux-fill-pro', name: 'FLUX Fill Pro' },
      { id: 'stability-ai/stable-diffusion-3-medium', name: 'SD3 Medium' },
    ]
  },
  {
    id: 'atlas',
    name: 'Atlas Cloud',
    model: 'flux-kontext-pro',
    configured: false,
    models: [
      { id: 'flux-kontext-pro', name: 'FLUX Kontext Pro' },
      { id: 'bytedance/doubao-seed-evolving', name: 'Seedream (Doubao Seed)' },
      { id: 'alibaba/wan-2.7-image', name: 'Wan 2.7 Image' },
      { id: 'xai/grok-imagine', name: 'Grok Imagine' },
      { id: 'google/gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image' },
    ]
  }
];

export const defaultSettings: AppSettings = {
  immichUrl: process.env.IMMICH_URL || '',
  immichApiKey: process.env.IMMICH_API_KEY || '',
  defaultProvider: 'fal',
  defaultStrength: 0.75,
  defaultSteps: 30,
  aiEditsAlbumName: 'AI Edits',
  providers: {
    fal: { apiKey: process.env.FAL_KEY || '', model: 'fal-ai/flux/dev/image-to-image' },
    runware: { apiKey: process.env.RUNWARE_API_KEY || '', model: 'runware:106@1' },
    replicate: { apiKey: process.env.REPLICATE_API_TOKEN || '', model: 'black-forest-labs/flux-kontext-pro' },
    atlas: { apiKey: process.env.ATLAS_API_KEY || '', model: 'flux-kontext-pro' },
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

    const result = PROVIDER_MODELS.map(p => {
      const pKey = p.id as keyof typeof current.providers;
      const hasKey = !!current.providers[pKey]?.apiKey;
      return {
        ...p,
        configured: hasKey,
        model: current.providers[pKey]?.model || p.model,
      };
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as settingsRouter };
