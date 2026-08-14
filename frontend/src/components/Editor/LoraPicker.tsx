import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchLoraCatalogue, LoraCatalogue, LoraCatalogueEntry } from '../../api/editor';

/**
 * Multi-select for LoRAs, grouped by category.
 *
 * Only enabled when the active model is LoRA-capable — the backend rejects LoRAs
 * on other models, so offering them there would just produce an error. The cap
 * comes from the provider (Runware stacks freely, fal and Atlas take 3, Replicate 1).
 */
export function LoraPicker() {
  const { state, dispatch, addToast } = useApp();
  const [catalogue, setCatalogue] = useState<LoraCatalogue | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const activeProviderInfo = state.providers.find(p => p.id === state.activeProvider);
  const activeModelInfo = activeProviderInfo?.models?.find(m => m.id === state.activeModel);
  const loraCapable = !!activeModelInfo?.loraCapable;

  const cap = useMemo(() => {
    const raw = catalogue?.caps?.[state.activeProvider];
    // The API sends Infinity for Runware, which JSON turns into null.
    if (raw === null || raw === undefined) return Number.POSITIVE_INFINITY;
    return typeof raw === 'number' ? raw : Number.POSITIVE_INFINITY;
  }, [catalogue, state.activeProvider]);

  useEffect(() => {
    if (!loraCapable || catalogue) return;
    fetchLoraCatalogue()
      .then(setCatalogue)
      .catch(err =>
        addToast({ type: 'error', title: 'Failed to load LoRAs', message: err.message })
      );
  }, [loraCapable, catalogue]);

  // Close the panel when the model stops supporting LoRAs.
  useEffect(() => {
    if (!loraCapable) setOpen(false);
  }, [loraCapable]);

  if (!loraCapable) return null;

  const selectedCount = state.selectedLoras.length;
  const capLabel = Number.isFinite(cap) ? `${selectedCount}/${cap}` : `${selectedCount}`;

  const categories = catalogue?.categories || {};
  const query = filter.trim().toLowerCase();

  const toggle = (entry: LoraCatalogueEntry) => {
    dispatch({
      type: 'TOGGLE_LORA',
      lora: { id: entry.id, weight: entry.weight },
      cap: Number.isFinite(cap) ? cap : Number.MAX_SAFE_INTEGER,
    });
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="provider-badge"
        onClick={() => setOpen(o => !o)}
        id="lora-picker-btn"
        title="Choose LoRAs for this edit"
      >
        <span style={{ fontSize: 12 }}>🎭</span>
        <span>LoRAs</span>
        <span style={{ color: selectedCount ? 'var(--accent-primary)' : 'var(--text-muted)', fontSize: 10 }}>
          {capLabel}
        </span>
      </button>

      {open && (
        <div
          id="lora-picker-panel"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: 0,
            width: 340,
            maxHeight: 380,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-soft)',
            borderRadius: 'var(--radius-lg, 10px)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            zIndex: 40,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter LoRAs..."
              id="lora-filter"
              style={{
                flex: 1,
                background: 'var(--bg-active)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 6,
                padding: '6px 8px',
                color: 'inherit',
                font: 'inherit',
                fontSize: 12,
              }}
            />
            {selectedCount > 0 && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => dispatch({ type: 'CLEAR_LORAS' })}
                id="lora-clear-btn"
                style={{ fontSize: 11 }}
              >
                Clear
              </button>
            )}
          </div>

          <div style={{ overflowY: 'auto', padding: '6px 0' }}>
            {!catalogue ? (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
            ) : Object.keys(categories).length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>
                No LoRAs available.
              </div>
            ) : (
              Object.entries(categories).map(([category, entries]) => {
                const visible = (entries || []).filter(entry =>
                  query ? entry.name.toLowerCase().includes(query) || entry.id.toLowerCase().includes(query) : true
                );
                if (!visible.length) return null;

                return (
                  <div key={category}>
                    <div
                      style={{
                        padding: '6px 12px',
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {category}
                    </div>
                    {visible.map(entry => {
                      const checked = state.selectedLoras.some(l => l.id === entry.id);
                      return (
                        <label
                          key={entry.id}
                          htmlFor={`lora-${entry.id}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '7px 12px',
                            cursor: 'pointer',
                            background: checked ? 'var(--bg-active)' : 'transparent',
                            fontSize: 12,
                          }}
                        >
                          <input
                            type="checkbox"
                            id={`lora-${entry.id}`}
                            checked={checked}
                            onChange={() => toggle(entry)}
                            style={{ flexShrink: 0 }}
                          />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {entry.name}
                          </span>
                          {entry.triggerWords?.length > 0 && (
                            <span
                              style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}
                              title={`Trigger: ${entry.triggerWords.join(', ')}`}
                            >
                              {entry.triggerWords[0]}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          {Number.isFinite(cap) && (
            <div
              style={{
                padding: '8px 12px',
                borderTop: '1px solid var(--border-subtle)',
                fontSize: 11,
                color: 'var(--text-muted)',
              }}
            >
              {activeProviderInfo?.name || state.activeProvider} accepts up to {cap} LoRA
              {cap === 1 ? '' : 's'}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
