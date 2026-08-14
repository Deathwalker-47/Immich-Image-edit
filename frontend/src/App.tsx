import React, { useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Gallery } from './components/Gallery/Gallery';
import { EditorPanel } from './components/Editor/EditorPanel';
import { SettingsModal } from './components/Settings/SettingsModal';
import { ToastContainer } from './components/Toast/ToastContainer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { fetchSettings, fetchProviders } from './api/editor';
import { fetchAssetInfo } from './api/immich';

function AppShell() {
  const { state, dispatch, addToast } = useApp();

  // Load initial settings and providers on mount
  useEffect(() => {
    Promise.all([fetchSettings(), fetchProviders()])
      .then(([settings, providers]) => {
        dispatch({ type: 'SET_SETTINGS', settings });
        dispatch({ type: 'SET_PROVIDERS', providers });
        dispatch({ type: 'SET_PROVIDER', provider: settings.defaultProvider });
      })
      .catch(err => {
        console.error('Failed to load initial settings:', err);
        addToast({
          type: 'warning',
          title: 'Configure your settings',
          message: 'Click the ⚙ icon to set up your Immich URL and API keys',
        });
      });

    // Check for ?assetId= query param (e.g. from mobile app webview launch)
    const urlParams = new URLSearchParams(window.location.search);
    const assetIdParam = urlParams.get('assetId');
    if (assetIdParam) {
      fetchAssetInfo(assetIdParam)
        .then(asset => {
          const originalUrl = `/api/immich/assets/${asset.id}/original`;
          dispatch({ type: 'OPEN_EDITOR', asset, originalUrl });
        })
        .catch(err => {
          console.error('Failed to load asset from URL:', err);
          addToast({ type: 'error', title: 'Failed to load photo', message: err.message });
        });
    }
  }, []);

  return (
    <div className={`app-shell ${state.view}`}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M19 3v4M21 5h-4" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div className="sidebar-logo-text">Immich AI</div>
            <div className="sidebar-logo-sub">Photo Editor</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Navigate</div>

          <div
            className={`nav-item${state.view === 'gallery' ? ' active' : ''}`}
            onClick={() => {
              if (state.view === 'editor') dispatch({ type: 'CLOSE_EDITOR' });
            }}
            id="nav-gallery"
          >
            <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            Gallery
          </div>

          {state.view === 'editor' && state.activeAsset && (
            <div className={`nav-item active`} id="nav-editor">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" strokeLinecap="round"/>
              </svg>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                {state.activeAsset.originalFileName}
              </span>
            </div>
          )}

          <div className="divider" style={{ margin: '12px 0' }} />
          <div className="sidebar-section-label">AI Providers</div>

          {state.providers.map(p => (
            <div
              key={p.id}
              className={`nav-item${state.activeProvider === p.id ? ' active' : ''}`}
              onClick={() => dispatch({ type: 'SET_PROVIDER', provider: p.id })}
              id={`nav-provider-${p.id}`}
            >
              <div style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: p.configured ? 'var(--success)' : 'var(--error)',
                boxShadow: p.configured ? '0 0 6px var(--success)' : 'none',
              }} />
              {p.name}
              {state.activeProvider === p.id && (
                <span className="nav-badge">Active</span>
              )}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => dispatch({ type: 'SET_SETTINGS_OPEN', open: true })}
            id="sidebar-settings-btn"
            style={{ width: '100%', justifyContent: 'flex-start', gap: 'var(--space-2)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            Settings
          </button>
        </div>
      </aside>

      {/* Main content.
          Keyed per view so recovering from an editor crash gives a genuinely fresh
          subtree, and the reset drops back to the gallery — the one state we know
          renders, rather than re-rendering whatever just threw. */}
      <main className="main-content">
        <ErrorBoundary
          key={state.view}
          title={state.view === 'editor' ? 'The editor hit a problem' : 'The gallery hit a problem'}
          resetLabel="Back to gallery"
          onReset={() => dispatch({ type: 'CLOSE_EDITOR' })}
        >
          {state.view === 'gallery' && <Gallery />}
          {state.view === 'editor' && <EditorPanel />}
        </ErrorBoundary>
      </main>

      {/* Modals & Overlays */}
      <SettingsModal />
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
