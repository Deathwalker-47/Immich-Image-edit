import React from 'react';
import { useApp, EditStep } from '../../context/AppContext';

export function EditHistory() {
  const { state, dispatch } = useApp();
  const { editHistory, currentHistoryIndex } = state;

  if (editHistory.length <= 1) return null;

  return (
    <div className="edit-history">
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        marginRight: 'var(--space-3)',
        flexShrink: 0,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" strokeLinecap="round"/>
          <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M12 7v5l4 2" strokeLinecap="round"/>
        </svg>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
          History
        </span>
      </div>

      {editHistory.map((step, idx) => (
        <HistoryItem
          key={step.id}
          step={step}
          index={idx}
          isActive={idx === currentHistoryIndex}
          onClick={() => dispatch({ type: 'SET_HISTORY_INDEX', index: idx })}
        />
      ))}
    </div>
  );
}

interface HistoryItemProps {
  step: EditStep;
  index: number;
  isActive: boolean;
  onClick: () => void;
}

function HistoryItem({ step, index, isActive, onClick }: HistoryItemProps) {
  return (
    <div
      className={`history-item${step.isOriginal ? ' origin' : ''}${isActive ? ' active' : ''}`}
      onClick={onClick}
      title={step.label + (step.prompt && !step.isOriginal ? `\n"${step.prompt}"` : '')}
      id={`history-item-${index}`}
    >
      <img
        src={step.imageUrl}
        alt={step.label || 'Edit step'}
        loading="lazy"
        style={{ pointerEvents: 'none' }}
      />
      <div className="history-item-label">
        {/* Defaulted, not trusted: an undefined provider here used to throw during
            render and blank the entire app. */}
        {step.isOriginal ? '📷 Orig' : `#${index} ${(step.provider || 'AI').toUpperCase()}`}
      </div>
    </div>
  );
}
