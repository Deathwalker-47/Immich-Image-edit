import { editWithFal } from './fal';
import { editWithRunware } from './runware';
import { editWithReplicate } from './replicate';
import { editWithAtlas } from './atlas';

export interface EditRequest {
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

export interface ProviderInfo {
  id: string;
  name: string;
  model: string;
  configured: boolean;
  models: { id: string; name: string }[];
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
  defaultStrength: number;
  defaultSteps: number;
}

export async function runEdit(request: EditRequest): Promise<EditResult> {
  const { provider } = request;

  switch (provider.toLowerCase()) {
    case 'fal':
      return editWithFal(request);
    case 'runware':
      return editWithRunware(request);
    case 'replicate':
      return editWithReplicate(request);
    case 'atlas':
      return editWithAtlas(request);
    default:
      throw new Error(`Unknown provider: ${provider}. Valid options: fal, runware, replicate, atlas`);
  }
}
