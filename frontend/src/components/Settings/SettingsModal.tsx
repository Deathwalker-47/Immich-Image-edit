import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchSettings, saveSettings, fetchProviders, formatCost, formatDuration, AppSettings, ProviderInfo } from '../../api/editor';

export function SettingsModal() {
  const { state, dispatch, addToast } = useApp();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!state.settingsOpen) return;
    Promise.all([fetchSettings(), fetchProviders()])
      .then(([s, p]) => {
        setSettings(s);
        setProviders(p);
        dispatch({ type: 'SET_PROVIDERS', providers: p });
      })
      .catch(err => addToast({ type: 'error', title: 'Failed to load settings', message: err.message }));
  }, [state.settingsOpen]);

  if (!state.settingsOpen || !settings) return null;

  const updateSetting = (key: keyof AppSettings, value: any) => {
    setSettings(prev => prev ? { ...prev, [key]: value } : prev);
  };

  const updateProviderKey = (provider: 'fal' | 'runware' | 'replicate' | 'atlas', key: 'apiKey' | 'model', value: string) => {
    setSettings(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        providers: {
          ...prev.providers,
          [provider]: { ...prev.providers[provider], [key]: value },
        },
      };
    });
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await saveSettings(settings);
      dispatch({ type: 'SET_SETTINGS', settings });
      
      const updatedProviders = await fetchProviders();
      dispatch({ type: 'SET_PROVIDERS', providers: updatedProviders });
      
      const pInfo = updatedProviders.find(p => p.id === settings.defaultProvider);
      dispatch({ 
        type: 'SET_PROVIDER', 
        provider: settings.defaultProvider,
        model: pInfo?.model || settings.providers[settings.defaultProvider as keyof AppSettings['providers']]?.model
      });
      
      addToast({ type: 'success', title: 'Settings saved!' });
      dispatch({ type: 'SET_SETTINGS_OPEN', open: false });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Failed to save', message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const providerOrder: ('fal' | 'runware' | 'replicate' | 'atlas')[] = ['fal', 'runware', 'replicate', 'atlas'];
  const providerNames: Record<string, string> = {
    fal: 'Fal.ai',
    runware: 'Runware',
    replicate: 'Replicate',
    atlas: 'Atlas Cloud',
  };
  const providerLinks: Record<string, string> = {
    fal: 'https://fal.ai/dashboard/keys',
    runware: 'https://runware.ai/account/api-keys',
    replicate: 'https://replicate.com/account/api-tokens',
    atlas: 'https://www.atlascloud.ai/dashboard',
  };

  return (
    <div
      className="modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) dispatch({ type: 'SET_SETTINGS_OPEN', open: false }); }}
      id="settings-overlay"
    >
      <div className="modal" id="settings-modal">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <div style={{
              width: 32, height: 32,
              background: 'var(--accent-dim)',
              border: '1px solid var(--border-accent)',
              borderRadius: 'var(--radius-md)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-accent)" strokeWidth="2">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </div>
            <span className="modal-title">Settings</span>
          </div>
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => dispatch({ type: 'SET_SETTINGS_OPEN', open: false })}
            id="close-settings-btn"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="modal-body">
          {/* Immich Connection */}
          <div className="settings-section">
            <div className="settings-section-title">Immich Connection</div>
            <div className="form-group">
              <label className="form-label" htmlFor="immich-url">Immich Server URL</label>
              <input
                id="immich-url"
                className="form-input"
                type="url"
                placeholder="https://photos.yourdomain.com"
                value={settings.immichUrl}
                onChange={e => updateSetting('immichUrl', e.target.value)}
              />
              <div className="form-hint">Public URL of your Immich instance (for browser access)</div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="immich-api-key">Immich API Key</label>
              <input
                id="immich-api-key"
                className="form-input"
                type="password"
                placeholder="••••••••"
                value={settings.immichApiKey}
                onChange={e => updateSetting('immichApiKey', e.target.value)}
              />
              <div className="form-hint">Account Settings → API Keys in your Immich web UI</div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="ai-album-name">AI Edits Album Name</label>
              <input
                id="ai-album-name"
                className="form-input"
                type="text"
                value={settings.aiEditsAlbumName}
                onChange={e => updateSetting('aiEditsAlbumName', e.target.value)}
              />
            </div>
          </div>

          {/* Default Provider */}
          <div className="settings-section">
            <div className="settings-section-title">AI Provider</div>
            <div className="form-group">
              <label className="form-label" htmlFor="default-provider">Default Provider</label>
              <select
                id="default-provider"
                className="form-select"
                value={settings.defaultProvider}
                onChange={e => {
                  updateSetting('defaultProvider', e.target.value);
                  const p = providers.find(x => x.id === e.target.value);
                  if (p) updateSetting('defaultProvider', e.target.value);
                }}
              >
                {providerOrder.map(p => (
                  <option key={p} value={p}>{providerNames[p]}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="default-strength">Default Strength ({(settings.defaultStrength * 100).toFixed(0)}%)</label>
              <input
                id="default-strength"
                type="range"
                min="0.1" max="1" step="0.05"
                value={settings.defaultStrength}
                onChange={e => updateSetting('defaultStrength', parseFloat(e.target.value))}
              />
            </div>
          </div>

          {/* Provider API Keys */}
          <div className="settings-section">
            <div className="settings-section-title">Provider API Keys</div>
            {providerOrder.map(p => {
              const isConfigured = !!settings.providers[p].apiKey && !settings.providers[p].apiKey.includes('•••');
              const configuredFromLoad = providers.find(x => x.id === p)?.configured;
              const providerModels = providers.find(x => x.id === p)?.models || [];

              return (
                <div key={p} className={`provider-config-card${configuredFromLoad ? ' configured' : ''}`} id={`provider-config-${p}`}>
                  <div className="provider-config-header">
                    <span className="provider-config-name">{providerNames[p]}</span>
                    <span className={`status-badge${configuredFromLoad ? ' ok' : ' missing'}`}>
                      {configuredFromLoad ? '✓ Configured' : '⚠ Not set'}
                    </span>
                  </div>

                  <div className="form-group" style={{ marginBottom: 'var(--space-3)' }}>
                    <label className="form-label" htmlFor={`${p}-api-key`}>API Key</label>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <input
                        id={`${p}-api-key`}
                        className="form-input"
                        type="password"
                        placeholder="sk-..."
                        value={settings.providers[p].apiKey}
                        onChange={e => updateProviderKey(p, 'apiKey', e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <a
                        href={providerLinks[p]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm"
                        title="Get API key"
                        style={{ flexShrink: 0 }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" strokeLinecap="round" strokeLinejoin="round"/>
                          <polyline points="15 3 21 3 21 9" strokeLinecap="round" strokeLinejoin="round"/>
                          <line x1="10" x2="21" y1="14" y2="3" strokeLinecap="round"/>
                        </svg>
                      </a>
                    </div>
                  </div>

                  {providerModels.length > 0 && (
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" htmlFor={`${p}-model`}>Model</label>
                      <select
                        id={`${p}-model`}
                        className="form-select"
                        value={settings.providers[p].model}
                        onChange={e => updateProviderKey(p, 'model', e.target.value)}
                      >
                        {providerModels.map(m => (
                          <option key={m.id} value={m.id}>
                            {`${m.name} · ${formatDuration(m.avgSeconds)} · ${formatCost(m.costUsd)}`}
                          </option>
                        ))}
                      </select>
                      {(() => {
                        // Detail for the selected model only. A <option> can hold
                        // plain text and nothing more, so the caveats that matter
                        // — an unmeasured timing, a per-resolution price — live
                        // here instead of being silently dropped.
                        const sel = providerModels.find(m => m.id === settings.providers[p].model);
                        if (!sel) return null;
                        return (
                          <div className="model-meta">
                            <div className="model-meta-stats">
                              <span title="Measured mean time for one edit, provider queue included">
                                ⏱ {formatDuration(sel.avgSeconds)}
                              </span>
                              <span title="Provider's published price per image">
                                 {formatCost(sel.costUsd)}
                              </span>
                              {sel.loraCapable && <span className="model-meta-lora">LoRA</span>}
                            </div>
                            {sel.description && <div>{sel.description}</div>}
                            {sel.costNote && <div>{sel.costNote}</div>}
                            {sel.speedNote && <div className="model-meta-warn">{sel.speedNote}</div>}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="btn btn-ghost"
            onClick={() => dispatch({ type: 'SET_SETTINGS_OPEN', open: false })}
            id="cancel-settings-btn"
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
            id="save-settings-btn"
          >
            {saving ? (
              <>
                <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                Saving...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" strokeLinecap="round" strokeLinejoin="round"/>
                  <polyline points="17 21 17 13 7 13 7 21" strokeLinecap="round" strokeLinejoin="round"/>
                  <polyline points="7 3 7 8 15 8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Save Settings
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
