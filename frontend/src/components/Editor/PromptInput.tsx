import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { LoraPicker } from './LoraPicker';

const PRESET_PROMPTS = [
  { emoji: '🌅', label: 'Golden Hour', prompt: 'Transform to golden hour lighting with warm orange and golden tones, beautiful sunset ambiance' },
  { emoji: '🎬', label: 'Cinematic', prompt: 'Apply cinematic color grading with teal and orange tones, professional film look with letterbox mood' },
  { emoji: '✨', label: 'Vibrant', prompt: 'Make colors more vibrant, saturated and punchy while keeping it natural' },
  { emoji: '🌸', label: 'Soft Portrait', prompt: 'Soft portrait photography style with gentle bokeh, creamy skin tones and dreamy atmosphere' },
  { emoji: '📽️', label: 'Matte Film', prompt: 'Analog film look with matte tones, subtle grain, lifted shadows and faded colors like 35mm film' },
  { emoji: '🌙', label: 'Night Scene', prompt: 'Transform to moody night scene with deep blues, glowing lights and atmospheric darkness' },
  { emoji: '🏔️', label: 'Landscape', prompt: 'Epic landscape photography style with enhanced sky, vivid colors and dramatic atmosphere' },
  { emoji: '🖤', label: 'B&W', prompt: 'Convert to dramatic black and white with high contrast, deep shadows and bright highlights' },
  { emoji: '🌊', label: 'Teal & Blue', prompt: 'Cool teal and blue color grade with crisp clarity and fresh atmosphere' },
  { emoji: '🍂', label: 'Autumn', prompt: 'Warm autumn color palette with rich oranges, reds and browns, cozy fall mood' },
];

interface PromptInputProps {
  onEdit: (prompt: string) => void;
  isEditing: boolean;
}

export function PromptInput({ onEdit, isEditing }: PromptInputProps) {
  const { state, dispatch } = useApp();
  const [prompt, setPrompt] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  const handlePresetClick = (preset: typeof PRESET_PROMPTS[0]) => {
    if (selectedPreset === preset.label) {
      // Deselect
      setSelectedPreset(null);
      setPrompt('');
    } else {
      setSelectedPreset(preset.label);
      setPrompt(preset.prompt);
    }
  };

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || isEditing) return;
    onEdit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSliderChange = (value: number) => {
    dispatch({ type: 'SET_STRENGTH', strength: value });
  };

  const handleStepsChange = (value: number) => {
    dispatch({ type: 'SET_STEPS', steps: value });
  };

  const activeProviderInfo = state.providers.find(p => p.id === state.activeProvider);

  return (
    <div className="editor-controls">
      {/* Preset chips */}
      <div className="presets-row">
        {PRESET_PROMPTS.map(preset => (
          <button
            key={preset.label}
            className={`preset-chip ${selectedPreset === preset.label ? 'selected' : ''}`}
            onClick={() => handlePresetClick(preset)}
            id={`preset-${preset.label.toLowerCase().replace(/\s/g, '-')}`}
            title={preset.prompt}
          >
            <span>{preset.emoji}</span>
            <span>{preset.label}</span>
          </button>
        ))}
      </div>

      {/* Prompt input row */}
      <div className="prompt-row">
        <div className="prompt-input-wrap">
          <textarea
            className="prompt-input"
            value={prompt}
            onChange={e => {
              setPrompt(e.target.value);
              if (selectedPreset) setSelectedPreset(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Describe your edit... e.g. 'Make the sky more dramatic with purple clouds'"
            disabled={isEditing}
            rows={1}
            id="prompt-input"
            style={{ resize: 'none', paddingTop: '12px', paddingBottom: '12px', lineHeight: '1.5' }}
          />
        </div>

        <button
          className={`btn btn-primary${isEditing ? ' disabled' : ''}`}
          onClick={handleSubmit}
          disabled={isEditing || !prompt.trim()}
          id="apply-edit-btn"
          style={{ height: 'auto', minHeight: 44, alignSelf: 'stretch' }}
        >
          {isEditing ? (
            <>
              <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              Processing
            </>
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M19 3v4M21 5h-4" strokeLinecap="round"/>
              </svg>
              Apply AI Edit
            </>
          )}
        </button>
      </div>

      {/* Controls row */}
      <div className="controls-row">
        {/* Provider badge */}
        <button
          className="provider-badge"
          onClick={() => dispatch({ type: 'SET_SETTINGS_OPEN', open: true })}
          id="provider-badge"
          title="Click to change provider in Settings"
        >
          <span className={`provider-dot${activeProviderInfo?.configured ? '' : ' offline'}`} />
          <span>{activeProviderInfo?.name || state.activeProvider}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
            {String(state.activeModel).split('/').pop()?.replace('flux-kontext-', 'kontext-') || state.activeModel}
          </span>
        </button>

        {/* Renders only when the active model is LoRA-capable. */}
        <LoraPicker />

        {/* Strength slider */}
        <div className="slider-wrap">
          <span className="slider-label">Strength</span>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={state.strength}
            onChange={e => handleSliderChange(parseFloat(e.target.value))}
            id="strength-slider"
            style={{
              background: `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${((state.strength - 0.1) / 0.9) * 100}%, var(--bg-active) ${((state.strength - 0.1) / 0.9) * 100}%, var(--bg-active) 100%)`
            }}
          />
          <span className="slider-value">{(state.strength * 100).toFixed(0)}%</span>
        </div>

        {/* Steps slider */}
        <div className="slider-wrap" style={{ maxWidth: 200 }}>
          <span className="slider-label">Steps</span>
          <input
            type="range"
            min="10"
            max="50"
            step="5"
            value={state.steps}
            onChange={e => handleStepsChange(parseInt(e.target.value))}
            id="steps-slider"
            style={{
              background: `linear-gradient(to right, var(--accent-secondary) 0%, var(--accent-secondary) ${((state.steps - 10) / 40) * 100}%, var(--bg-active) ${((state.steps - 10) / 40) * 100}%, var(--bg-active) 100%)`
            }}
          />
          <span className="slider-value">{state.steps}</span>
        </div>
      </div>
    </div>
  );
}
