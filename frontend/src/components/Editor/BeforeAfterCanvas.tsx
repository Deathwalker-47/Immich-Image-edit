import React, { useState, useEffect, useRef } from 'react';

interface BeforeAfterProps {
  beforeUrl: string;
  afterUrl: string | null;
  isLoading?: boolean;
  loadingText?: string;
  provider?: string;
}

export function BeforeAfterCanvas({ beforeUrl, afterUrl, isLoading, loadingText, provider }: BeforeAfterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sliderPos, setSliderPos] = useState(50); // percent
  const [isDragging, setIsDragging] = useState(false);
  const [imgDimensions, setImgDimensions] = useState({ width: 0, height: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      setSliderPos((x / rect.width) * 100);
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Touch support
  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    handleTouchMove(e);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    const x = Math.max(0, Math.min(touch.clientX - rect.left, rect.width));
    setSliderPos((x / rect.width) * 100);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', maxHeight: '100%' }}>
      <div
        ref={containerRef}
        className="before-after-container"
        style={{ cursor: isDragging ? 'ew-resize' : 'default', position: 'relative', display: 'block' }}
        onTouchMove={handleTouchMove}
        onTouchEnd={() => setIsDragging(false)}
      >
        {/* Before image */}
        <img
          src={beforeUrl}
          alt="Original"
          className="before-img"
          onLoad={(e) => {
            const img = e.currentTarget;
            setImgDimensions({ width: img.naturalWidth, height: img.naturalHeight });
          }}
          draggable={false}
          style={{ display: 'block', userSelect: 'none' }}
        />

        {/* After image overlay (clipped) */}
        {afterUrl && (
          <div
            className="after-img-overlay"
            style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
          >
            <img src={afterUrl} alt="Edited" className="after-img" draggable={false} />
          </div>
        )}

        {/* Labels */}
        <span className="before-label">Before</span>
        {afterUrl && <span className="after-label">After</span>}

        {/* Divider + handle */}
        {afterUrl && (
          <div
            className="divider-line"
            style={{ left: `calc(${sliderPos}% - 1px)` }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
          >
            <div className="divider-handle">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M8 12l-4 0M20 12l-4 0M4 12l4-4M4 12l4 4M20 12l-4-4M20 12l-4 4" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="editor-loading" style={{ borderRadius: '14px' }}>
          <div className="pulse-ring">
            <div className="spinner" style={{ width: 36, height: 36 }} />
          </div>
          <div className="editor-loading-text">{loadingText || 'Applying AI edit...'}</div>
          {provider && <div className="editor-loading-provider">via {provider}</div>}
        </div>
      )}
    </div>
  );
}
