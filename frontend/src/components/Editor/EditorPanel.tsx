import React, { useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { BeforeAfterCanvas } from './BeforeAfterCanvas';
import { PromptInput } from './PromptInput';
import { EditHistory } from './EditHistory';
import { runEdit, EditResult } from '../../api/editor';
import { uploadEditedImage, getThumbnailUrl } from '../../api/immich';

export function EditorPanel() {
  const { state, dispatch, addToast, currentImage, originalImage } = useApp();
  const { activeAsset, isEditing, editProgress } = state;

  const handleEdit = useCallback(async (prompt: string) => {
    if (!activeAsset || isEditing) return;

    dispatch({ type: 'SET_EDITING', editing: true, progress: 'Sending to AI...' });

    try {
      // Use the current image URL as source (allows chaining edits)
      const sourceUrl = currentImage?.imageUrl || `/api/immich/assets/${activeAsset.id}/original`;

      // The backend rejects LoRAs on models that don't support them, so only send
      // them when the active model actually is LoRA-capable.
      const activeModelInfo = state.providers
        .find(p => p.id === state.activeProvider)
        ?.models?.find(m => m.id === state.activeModel);

      const result: EditResult = await runEdit({
        imageUrl: sourceUrl,
        prompt,
        provider: state.activeProvider,
        model: state.activeModel,
        strength: state.strength,
        steps: state.steps,
        negativePrompt: 'blurry, low quality, artifacts, watermark, overexposed, underexposed',
        loras: activeModelInfo?.loraCapable ? state.selectedLoras : undefined,
      });

      const newStep = {
        id: Math.random().toString(36).substr(2, 9),
        imageUrl: result.imageUrl,
        prompt,
        provider: result.provider || state.activeProvider,
        model: result.model || state.activeModel,
        label: `Edit ${prompt.substring(0, 30)}...`,
      };

      dispatch({ type: 'ADD_EDIT_STEP', step: newStep });
      // Cosmetic only — never let formatting the success message throw after the
      // step has already been committed to state.
      const modelLabel = String(newStep.model).split('/').pop();
      addToast({ type: 'success', title: 'Edit applied!', message: `via ${newStep.provider} · ${modelLabel}` });
    } catch (err: any) {
      console.error('[Editor] Edit failed:', err);
      addToast({ type: 'error', title: 'Edit failed', message: err.message });
    } finally {
      dispatch({ type: 'SET_EDITING', editing: false });
    }
  }, [activeAsset, isEditing, currentImage, state, dispatch, addToast]);

  const handleSaveToImmich = useCallback(async () => {
    if (!currentImage || currentImage.isOriginal) {
      addToast({ type: 'warning', title: 'Nothing to save', message: 'Apply an edit first' });
      return;
    }

    dispatch({ type: 'SET_EDITING', editing: true, progress: 'Saving to Immich...' });

    try {
      // Fetch the result image as base64
      const imgRes = await fetch(currentImage.imageUrl);
      const blob = await imgRes.blob();
      const base64 = await blobToBase64(blob);

      const originalName = activeAsset?.originalFileName || 'edited.jpg';
      const name = `ai-edit-${Date.now()}-${originalName}`;

      const { assetId } = await uploadEditedImage({
        imageBase64: base64,
        filename: name,
        albumId: state.selectedAlbumId || undefined,
      });

      addToast({
        type: 'success',
        title: 'Saved to Immich!',
        message: assetId
          ? `Asset ID: ${String(assetId).substring(0, 8)}... added to "${state.settings?.aiEditsAlbumName || 'AI Edits'}" album`
          : `Added to "${state.settings?.aiEditsAlbumName || 'AI Edits'}" album`,
      });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Save failed', message: err.message });
    } finally {
      dispatch({ type: 'SET_EDITING', editing: false });
    }
  }, [currentImage, activeAsset, state, dispatch, addToast]);

  const handleDownload = useCallback(async () => {
    if (!currentImage) return;
    try {
      const res = await fetch(currentImage.imageUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-edit-${Date.now()}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
      addToast({ type: 'success', title: 'Downloaded!' });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Download failed', message: err.message });
    }
  }, [currentImage, addToast]);

  if (!activeAsset) return null;

  const originalUrl = originalImage?.imageUrl || `/api/immich/assets/${activeAsset.id}/original`;
  const editedUrl = currentImage && !currentImage.isOriginal ? currentImage.imageUrl : null;
  const activeProviderInfo = state.providers.find(p => p.id === state.activeProvider);

  return (
    <div className="editor-layout">
      {/* Top bar */}
      <div className="topbar">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => dispatch({ type: 'CLOSE_EDITOR' })}
          id="back-to-gallery-btn"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Gallery
        </button>

        <div className="topbar-breadcrumb">
          <span>{activeAsset.originalFileName}</span>
          {activeAsset.exifInfo?.imageWidth && (
            <>
              <span style={{ opacity: 0.4 }}>•</span>
              <span style={{ color: 'var(--text-muted)' }}>
                {activeAsset.exifInfo.imageWidth}×{activeAsset.exifInfo.imageHeight}
              </span>
            </>
          )}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
          {editedUrl && (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleDownload}
                id="download-btn"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round"/>
                  <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="12" x2="12" y1="15" y2="3" strokeLinecap="round"/>
                </svg>
                Download
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveToImmich}
                disabled={isEditing}
                id="save-to-immich-btn"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" strokeLinecap="round" strokeLinejoin="round"/>
                  <polyline points="17 21 17 13 7 13 7 21" strokeLinecap="round" strokeLinejoin="round"/>
                  <polyline points="7 3 7 8 15 8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Save to Immich
              </button>
            </>
          )}

          <button
            className="btn btn-ghost btn-sm"
            onClick={() => dispatch({ type: 'SET_SETTINGS_OPEN', open: true })}
            id="settings-btn"
            title="Settings"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" strokeLinecap="round"/>
              <circle cx="12" cy="12" r="3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div className={`editor-canvas-area${originalUrl ? ' has-image' : ''}`}>
        <BeforeAfterCanvas
          beforeUrl={originalUrl}
          afterUrl={editedUrl}
          isLoading={isEditing}
          loadingText={editProgress || 'Applying AI magic...'}
          provider={activeProviderInfo?.name}
        />

        {/* Empty hint */}
        {!isEditing && !editedUrl && (
          <div style={{
            position: 'absolute',
            bottom: 'var(--space-6)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(13,17,32,0.8)',
            backdropFilter: 'blur(8px)',
            border: '1px solid var(--border-soft)',
            borderRadius: 'var(--radius-full)',
            padding: '6px 16px',
            fontSize: 12,
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}>
            Type a prompt below and click "Apply AI Edit" ↓
          </div>
        )}
      </div>

      {/* Edit history strip */}
      <EditHistory />

      {/* Prompt + controls */}
      <PromptInput onEdit={handleEdit} isEditing={isEditing} />
    </div>
  );
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
