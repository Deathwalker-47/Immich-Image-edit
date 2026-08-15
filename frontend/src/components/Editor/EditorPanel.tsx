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
      const originalName = activeAsset?.originalFileName || 'edited.jpg';
      const name = `ai-edit-${Date.now()}-${originalName}`;

      // Hand the backend the URL and let it do the fetching. This used to
      // fetch(imageUrl) here and re-upload the bytes as base64, but provider
      // result URLs are cross-origin with no Access-Control-Allow-Origin
      // header, so that fetch was blocked by CORS and saving an edit always
      // failed. Server-side there is no CORS, and the image goes
      // provider -> server -> Immich instead of being pulled down to the phone
      // and pushed back up again.
      //
      // A data: URL (or anything else not http) has no server-fetchable
      // address, so those still go up as base64.
      const src = currentImage.imageUrl;
      const isFetchableUrl = /^https?:\/\//i.test(src);

      const payload = isFetchableUrl
        ? { imageUrl: src }
        : { imageBase64: await blobToBase64(await (await fetch(src)).blob()) };

      const { assetId } = await uploadEditedImage({
        ...payload,
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

  const handleDownload = useCallback(() => {
    if (!currentImage) return;
    const src = currentImage.imageUrl;
    const filename = `ai-edit-${Date.now()}.jpg`;

    // Provider result URLs (Atlas, Runware, Replicate, Fal) are cross-origin and
    // send no Access-Control-Allow-Origin header, so fetching them here to build
    // a blob was always blocked by CORS — that was the "Download failed" on Atlas
    // results. Anything not already same-origin goes through the backend proxy,
    // which refetches it server-side and returns it as an attachment.
    //
    // Navigating to a URL that responds with Content-Disposition: attachment also
    // behaves far better than a blob: link inside a mobile WebView, which is how
    // this app is actually used.
    const isSameOrigin = src.startsWith('/') || src.startsWith(window.location.origin);
    const href = isSameOrigin
      ? src
      : `/api/edit/download?url=${encodeURIComponent(src)}&filename=${encodeURIComponent(filename)}`;

    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    // Give the WebView a normal navigation to fall back on if it ignores
    // `download`; a same-tab navigation to an attachment still triggers its
    // download handling, where a blob: URL simply does nothing.
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [currentImage]);

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
