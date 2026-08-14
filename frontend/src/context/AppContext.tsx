import React, { createContext, useContext, useReducer, useCallback, ReactNode } from 'react';
import { ImmichAsset } from '../api/immich';
import { AppSettings, ProviderInfo } from '../api/editor';

// ── Toast ──────────────────────────────────────────────────
export type ToastType = 'success' | 'error' | 'info' | 'warning';
export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

// ── Edit history ───────────────────────────────────────────
export interface EditStep {
  id: string;
  imageUrl: string;
  prompt: string;
  provider: string;
  model: string;
  label: string;
  isOriginal?: boolean;
}

// ── App state ──────────────────────────────────────────────
interface AppState {
  // Gallery
  selectedAlbumId: string | null;
  view: 'gallery' | 'editor';

  // Editor
  activeAsset: ImmichAsset | null;
  editHistory: EditStep[];
  currentHistoryIndex: number;
  isEditing: boolean;
  editProgress: string;

  // Settings
  settings: AppSettings | null;
  providers: ProviderInfo[];
  activeProvider: string;
  activeModel: string;
  strength: number;
  steps: number;
  settingsOpen: boolean;

  // UI
  toasts: Toast[];
}

type AppAction =
  | { type: 'SET_ALBUM'; albumId: string | null }
  | { type: 'OPEN_EDITOR'; asset: ImmichAsset; originalUrl: string }
  | { type: 'CLOSE_EDITOR' }
  | { type: 'SET_VIEW'; view: 'gallery' | 'editor' }
  | { type: 'ADD_EDIT_STEP'; step: EditStep }
  | { type: 'SET_HISTORY_INDEX'; index: number }
  | { type: 'SET_EDITING'; editing: boolean; progress?: string }
  | { type: 'SET_SETTINGS'; settings: AppSettings }
  | { type: 'SET_PROVIDERS'; providers: ProviderInfo[] }
  | { type: 'SET_PROVIDER'; provider: string; model?: string }
  | { type: 'SET_MODEL'; model: string }
  | { type: 'SET_STRENGTH'; strength: number }
  | { type: 'SET_STEPS'; steps: number }
  | { type: 'SET_SETTINGS_OPEN'; open: boolean }
  | { type: 'ADD_TOAST'; toast: Toast }
  | { type: 'REMOVE_TOAST'; id: string };

const initialState: AppState = {
  selectedAlbumId: null,
  view: (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('assetId')) ? 'editor' : 'gallery',
  activeAsset: null,
  editHistory: [],
  currentHistoryIndex: -1,
  isEditing: false,
  editProgress: '',
  settings: null,
  providers: [],
  activeProvider: 'fal',
  activeModel: 'fal-ai/flux-kontext/max',
  strength: 0.75,
  steps: 30,
  settingsOpen: false,
  toasts: [],
};

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_ALBUM':
      return { ...state, selectedAlbumId: action.albumId, view: 'gallery' };

    case 'OPEN_EDITOR':
      const originStep: EditStep = {
        id: 'origin',
        imageUrl: action.originalUrl,
        prompt: 'Original',
        provider: '',
        model: '',
        label: 'Original',
        isOriginal: true,
      };
      return {
        ...state,
        activeAsset: action.asset,
        view: 'editor',
        editHistory: [originStep],
        currentHistoryIndex: 0,
      };

    case 'CLOSE_EDITOR':
      return {
        ...state,
        activeAsset: null,
        view: 'gallery',
        editHistory: [],
        currentHistoryIndex: -1,
      };

    case 'SET_VIEW':
      return { ...state, view: action.view };

    case 'ADD_EDIT_STEP': {
      const newHistory = state.editHistory.slice(0, state.currentHistoryIndex + 1);
      newHistory.push(action.step);
      return {
        ...state,
        editHistory: newHistory,
        currentHistoryIndex: newHistory.length - 1,
      };
    }

    case 'SET_HISTORY_INDEX':
      return { ...state, currentHistoryIndex: action.index };

    case 'SET_EDITING':
      return { ...state, isEditing: action.editing, editProgress: action.progress || '' };

    case 'SET_SETTINGS':
      return {
        ...state,
        settings: action.settings,
        activeProvider: action.settings.defaultProvider || state.activeProvider,
        strength: action.settings.defaultStrength ?? state.strength,
        steps: action.settings.defaultSteps ?? state.steps,
      };

    case 'SET_PROVIDERS':
      return { ...state, providers: action.providers };

    case 'SET_PROVIDER': {
      const provider = action.provider;
      const providerInfo = state.providers.find(p => p.id === provider);
      const model = action.model || providerInfo?.model || state.activeModel;
      return { ...state, activeProvider: provider, activeModel: model };
    }

    case 'SET_MODEL':
      return { ...state, activeModel: action.model };

    case 'SET_STRENGTH':
      return { ...state, strength: action.strength };

    case 'SET_STEPS':
      return { ...state, steps: action.steps };

    case 'SET_SETTINGS_OPEN':
      return { ...state, settingsOpen: action.open };

    case 'ADD_TOAST':
      return { ...state, toasts: [...state.toasts, action.toast] };

    case 'REMOVE_TOAST':
      return { ...state, toasts: state.toasts.filter(t => t.id !== action.id) };

    default:
      return state;
  }
}

// ── Context ────────────────────────────────────────────────
interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  currentImage: EditStep | null;
  originalImage: EditStep | null;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substr(2, 9);
    dispatch({ type: 'ADD_TOAST', toast: { ...toast, id } });
    setTimeout(() => dispatch({ type: 'REMOVE_TOAST', id }), 5000);
  }, []);

  const currentImage = state.editHistory[state.currentHistoryIndex] ?? null;
  const originalImage = state.editHistory[0] ?? null;

  return (
    <AppContext.Provider value={{ state, dispatch, addToast, currentImage, originalImage }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
