export interface EditParams {
  imageUrl?: string;
  imageBase64?: string;
  prompt: string;
  provider: string;
  model?: string;
  strength?: number;
  negativePrompt?: string;
  steps?: number;
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

  return res.json();
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

export interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  model: string;
  models: { id: string; name: string }[];
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
