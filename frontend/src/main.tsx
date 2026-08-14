import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Outermost net. The boundary inside App covers the gallery/editor views and can
// recover by resetting state; this one catches anything above them (the provider,
// the sidebar) where there is no state left to reset, so a reload is the only
// meaningful recovery. Without it those throws blank the page, which in the mobile
// WebView means a full app restart.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary
      title="The app failed to load"
      resetLabel="Reload"
      onReset={() => window.location.reload()}
    >
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
