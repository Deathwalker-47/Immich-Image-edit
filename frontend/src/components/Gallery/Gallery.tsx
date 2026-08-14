import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchAlbums, fetchTimeline, fetchAlbumAssets, getThumbnailUrl, ImmichAsset, ImmichAlbum } from '../../api/immich';

export function Gallery() {
  const { state, dispatch, addToast } = useApp();
  const [albums, setAlbums] = useState<ImmichAlbum[]>([]);
  const [assets, setAssets] = useState<ImmichAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentAlbumName, setCurrentAlbumName] = useState('All Photos');

  // Load albums
  useEffect(() => {
    fetchAlbums()
      .then(setAlbums)
      .catch(err => addToast({ type: 'error', title: 'Failed to load albums', message: err.message }));
  }, []);

  // Load assets when album changes
  useEffect(() => {
    setLoading(true);
    const load = async () => {
      try {
        if (state.selectedAlbumId) {
          const data = await fetchAlbumAssets(state.selectedAlbumId);
          setAssets(data.assets.filter((a: ImmichAsset) => a.type === 'IMAGE'));
          setCurrentAlbumName(data.albumName);
        } else {
          const data = await fetchTimeline(1, 100);
          setAssets(data.filter((a: ImmichAsset) => a.type === 'IMAGE'));
          setCurrentAlbumName('Recent Photos');
        }
      } catch (err: any) {
        addToast({ type: 'error', title: 'Failed to load photos', message: err.message });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [state.selectedAlbumId]);

  const handleOpenEditor = (asset: ImmichAsset) => {
    const originalUrl = `/api/immich/assets/${asset.id}/original`;
    dispatch({ type: 'OPEN_EDITOR', asset, originalUrl });
  };

  const filtered = assets.filter(a =>
    searchQuery
      ? a.originalFileName.toLowerCase().includes(searchQuery.toLowerCase())
      : true
  );

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Album sidebar column */}
      <div style={{
        width: 220,
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-surface)',
        flexShrink: 0,
      }}>
        <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
            Albums
          </div>
        </div>

        <div className="album-list">
          {/* All Photos */}
          <div
            className={`album-item${!state.selectedAlbumId ? ' active' : ''}`}
            onClick={() => dispatch({ type: 'SET_ALBUM', albumId: null })}
            id="album-all"
          >
            <div className="album-thumb" style={{ background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <div className="album-info">
              <div className="album-name">Recent Photos</div>
            </div>
          </div>

          {albums.map(album => (
            <div
              key={album.id}
              className={`album-item${state.selectedAlbumId === album.id ? ' active' : ''}`}
              onClick={() => dispatch({ type: 'SET_ALBUM', albumId: album.id })}
              id={`album-${album.id}`}
            >
              {album.albumThumbnailAssetId ? (
                <img
                  src={getThumbnailUrl(album.albumThumbnailAssetId, 'thumbnail')}
                  className="album-thumb"
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="album-thumb" style={{ background: 'var(--bg-active)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                    <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/>
                  </svg>
                </div>
              )}
              <div className="album-info">
                <div className="album-name">{album.albumName}</div>
                <div className="album-count">{album.assetCount} photos</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Photo grid */}
      <div className="gallery-area">
        <div className="gallery-header">
          <div>
            <div className="gallery-title">{currentAlbumName}</div>
            <div className="gallery-subtitle">{assets.length} photos</div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <div className="search-input">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35" strokeLinecap="round"/>
              </svg>
              <input
                type="text"
                placeholder="Filter photos..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                id="photo-search"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="photo-grid">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="photo-card skeleton" id={`skeleton-${i}`} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <div className="empty-state-title">No photos found</div>
            <div className="empty-state-desc">
              {searchQuery ? `No photos matching "${searchQuery}"` : 'This album is empty'}
            </div>
          </div>
        ) : (
          <div className="photo-grid">
            {filtered.map((asset, i) => (
              <PhotoCard
                key={asset.id}
                asset={asset}
                index={i}
                onEdit={handleOpenEditor}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface PhotoCardProps {
  asset: ImmichAsset;
  index: number;
  onEdit: (asset: ImmichAsset) => void;
}

function PhotoCard({ asset, index, onEdit }: PhotoCardProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      className={`photo-card${!loaded ? ' skeleton' : ''}`}
      style={{ animationDelay: `${(index % 20) * 30}ms` }}
      id={`photo-${asset.id}`}
    >
      <img
        src={getThumbnailUrl(asset.id, 'thumbnail')}
        alt={asset.originalFileName}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
      />
      <div className="photo-card-overlay">
        <div className="photo-card-actions">
          <button
            className="photo-card-action-btn edit"
            onClick={() => onEdit(asset)}
            id={`edit-${asset.id}`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" strokeLinecap="round"/>
            </svg>
            Edit with AI
          </button>
        </div>
      </div>
    </div>
  );
}
