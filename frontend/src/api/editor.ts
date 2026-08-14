export interface LoraSelection {
  id: string;
  weight?: number;
}

export interface EditParams {
  imageUrl?: string;
  imageBase64?: string;
  prompt: string;
  provider: string;
  model?: string;
  strength?: number;
  negativePrompt?: string;
  steps?: number;
  cfgScale?: number;
  /** Only accepted by LoRA-capable models; the backend rejects them otherwise. */
  loras?: LoraSelection[];
}

export interface EditResult {
  imageUrl: string;
  imageBase64?: string;
  provider: string;
  model: string;
  width?: number;
  height?: number;
  seed?: number;
}

export async function runEdit(params: EditParams): Promise<EditResult> {
  const res = await fetch('/api/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Edit failed with status ${res.status}`);
  }

  const data = await res.json().catch(() => null);

  // Validate here rather than downstream. A partial response used to flow into the
  // edit history and then throw during render, which white-screens the whole app —
  // and a throw at render time is not caught by the caller's try/catch, because the
  // bad value has already been committed to state.
  if (!data || typeof data !== 'object') {
    throw new Error('The server returned an unreadable response.');
  }
  if (typeof data.imageUrl !== 'string' || !data.imageUrl) {
    throw new Error('The edit completed but returned no image.');
  }

  return {
    imageUrl: data.imageUrl,
    imageBase64: typeof data.imageBase64 === 'string' ? data.imageBase64 : undefined,
    // Defaulted rather than trusted: these are only labels, so a missing one
    // should never be able to break the UI.
    provider: typeof data.provider === 'string' && data.provider ? data.provider : params.provider,
    model: typeof data.model === 'string' && data.model ? data.model : (params.model || 'unknown'),
    width: typeof data.width === 'number' ? data.width : undefined,
    height: typeof data.height === 'number' ? data.height : undefined,
    seed: typeof data.seed === 'number' ? data.seed : undefined,
  };
}

export interface AppSettings {
  immichUrl: string;
  immichApiKey: string;
  defaultProvider: string;
  providers: {
    fal: { apiKey: string; model: string };
    runware: { apiKey: string; model: string };
    replicate: { apiKey: string; model: string };
    atlas: { apiKey: string; model: string };
  };
  aiEditsAlbumName: string;
  theme: string;
  defaultStrength: number;
  defaultSteps: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  /** Whether the LoRA picker applies to this model. */
  loraCapable?: boolean;
  /** False when the provider slug hasn't been confirmed against its live catalogue. */
  verified?: boolean;
}

export interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  model: string;
  models: ModelInfo[];
}

export interface LoraCatalogueEntry {
  id: string;
  name: string;
  weight: number;
  triggerWords: string[];
}

export interface LoraCatalogue {
  categories: Record<string, LoraCatalogueEntry[]>;
  caps: Record<string, number>;
}

export async function fetchLoraCatalogue(): Promise<LoraCatalogue> {
  const res = await fetch('/api/edit/loras');
  if (!res.ok) throw new Error('Failed to fetch LoRA catalogue');
  const data = await res.json();
  return {
    categories: data?.categories && typeof data.categories === 'object' ? data.categories : {},
    caps: data?.caps && typeof data.caps === 'object' ? data.caps : {},
  };
}

export async function fetchSettings(): Promise<AppSettings> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to save settings');
}

export async function fetchProviders(): Promise<ProviderInfo[]> {
  const res = await fetch('/api/settings/providers');
  if (!res.ok) throw new Error('Failed to fetch providers');
  return res.json();
}
