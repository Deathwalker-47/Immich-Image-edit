import React from 'react';
import { useApp } from '../../context/AppContext';

export function ToastContainer() {
  const { state, dispatch } = useApp();

  if (state.toasts.length === 0) return null;

  return (
    <div className="toast-container" id="toast-container">
      {state.toasts.map(toast => (
        <div key={toast.id} className={`toast ${toast.type}`} id={`toast-${toast.id}`}>
          <div className="toast-icon">
            {toast.type === 'success' && (
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round"/>
                <polyline points="22 4 12 14.01 9 11.01" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            {toast.type === 'error' && (
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" x2="9" y1="9" y2="15" strokeLinecap="round"/>
                <line x1="9" x2="15" y1="9" y2="15" strokeLinecap="round"/>
              </svg>
            )}
            {toast.type === 'warning' && (
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2.5">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 9v4" strokeLinecap="round"/>
                <path d="M12 17h.01" strokeLinecap="round"/>
              </svg>
            )}
            {toast.type === 'info' && (
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--info)" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4" strokeLinecap="round"/>
                <path d="M12 8h.01" strokeLinecap="round"/>
              </svg>
            )}
          </div>
          <div className="toast-content">
            <div className="toast-title">{toast.title}</div>
            {toast.message && <div className="toast-message">{toast.message}</div>}
          </div>
          <button
            className="toast-dismiss"
            onClick={() => dispatch({ type: 'REMOVE_TOAST', id: toast.id })}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
