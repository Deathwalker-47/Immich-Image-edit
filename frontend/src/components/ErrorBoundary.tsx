import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown above the error. Defaults to a generic message. */
  title?: string;
  /**
   * Called when the user chooses to recover. Use it to reset whatever state
   * caused the throw; without it, recovery just re-renders the same children and
   * will usually throw again.
   */
  onReset?: () => void;
  /** Label for the recovery button. */
  resetLabel?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time exceptions so one bad value doesn't white-screen the app.
 *
 * This exists because an unhandled throw in render unmounts the whole React tree,
 * leaving a blank page that (in the mobile WebView) needs a full app restart to
 * clear. A try/catch in an event handler does not help: if the handler has already
 * dispatched bad data into state, the throw happens later, during render.
 *
 * The boundary is the safety net, not the fix — guard the data going into state as
 * well, so this stays a last resort.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Render failed:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-6)',
          height: '100%',
          minHeight: 260,
          textAlign: 'center',
        }}
        id="error-boundary"
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.3)',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--error, #ef4444)" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" x2="12" y1="8" y2="12" strokeLinecap="round" />
            <line x1="12" x2="12.01" y1="16" y2="16" strokeLinecap="round" />
          </svg>
        </div>

        <div style={{ fontSize: 15, fontWeight: 600 }}>
          {this.props.title || 'Something went wrong'}
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 420, lineHeight: 1.5 }}>
          {error.message || 'An unexpected error occurred while rendering.'}
        </div>

        <button className="btn btn-primary btn-sm" onClick={this.handleReset} id="error-boundary-reset">
          {this.props.resetLabel || 'Try again'}
        </button>
      </div>
    );
  }
}
