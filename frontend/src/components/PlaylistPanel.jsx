import { useState, useMemo } from 'react';
import { ListVideo, Film, Music, Plus, User, CheckSquare, Square, MinusSquare } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { useQueue } from '../context/QueueContext.jsx';

function formatDuration(sec) {
  if (!sec) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PlaylistPanel({ info }) {
  const { t } = useApp();
  const { addToQueue } = useQueue();

  // Download options
  const [dlType,   setDlType]   = useState('video');
  const [videoFmt, setVideoFmt] = useState('mp4');
  const [audioFmt, setAudioFmt] = useState('mp3');
  const [added,    setAdded]    = useState(false);

  // Selection: Set of entry IDs that are checked
  const [selected, setSelected] = useState(
    () => new Set(info.entries.map(e => e.id))   // all selected by default
  );

  const allSelected  = selected.size === info.entries.length;
  const noneSelected = selected.size === 0;
  const someSelected = !allSelected && !noneSelected;

  const toggleEntry = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll   = () => setSelected(new Set(info.entries.map(e => e.id)));
  const deselectAll = () => setSelected(new Set());
  const toggleAll   = () => allSelected ? deselectAll() : selectAll();

  const selectedEntries = useMemo(
    () => info.entries.filter(e => selected.has(e.id)),
    [info.entries, selected]
  );

  const handleAddSelected = () => {
    if (!selectedEntries.length) return;
    const queueItems = selectedEntries.map(e => ({
      title:   e.title,
      url:     e.url,
      type:    dlType,
      format:  dlType === 'audio' ? audioFmt : videoFmt,
      quality: '1080',
    }));
    addToQueue(queueItems);
    setAdded(true);
    setTimeout(() => setAdded(false), 3000);
  };

  const videoFormats = ['mp4', 'webm'];
  const audioFormats = ['mp3', 'm4a', 'flac', 'wav', 'ogg'];

  return (
    <div className="playlist-panel">

      {/* ── Header ── */}
      <div className="playlist-header">
        <div className="playlist-thumb-wrap">
          {info.thumbnail
            ? <img src={info.thumbnail} alt={info.title} className="playlist-thumb" />
            : <div className="playlist-thumb-placeholder"><ListVideo size={32} /></div>
          }
          <div className="playlist-count-badge">{info.entryCount}</div>
        </div>
        <div className="playlist-meta">
          <p className="playlist-tag">◆ {t.playlist.tag}</p>
          <h2 className="playlist-title">{info.title}</h2>
          {info.uploader && (
            <span className="meta-chip" style={{ marginTop: 6, display: 'inline-flex' }}>
              <User size={11} />
              <span className="label">{t.media.by}</span>
              {info.uploader}
            </span>
          )}
          <p className="playlist-count">{info.entryCount} {t.playlist.videos}</p>
        </div>
      </div>

      {/* ── Format options ── */}
      <div className="playlist-options">
        <div>
          <p className="panel-section-title">{t.download.title}</p>
          <div className="type-tabs" role="tablist">
            <button role="tab" aria-selected={dlType === 'video'}
              className={`type-tab${dlType === 'video' ? ' active' : ''}`}
              onClick={() => setDlType('video')}>
              <Film size={14} /> {t.download.typeVideo}
            </button>
            <button role="tab" aria-selected={dlType === 'audio'}
              className={`type-tab${dlType === 'audio' ? ' active' : ''}`}
              onClick={() => setDlType('audio')}>
              <Music size={14} /> {t.download.typeAudio}
            </button>
          </div>
        </div>

        <div>
          <p className="panel-section-title">{t.download.selectFormat}</p>
          <div className="format-grid" role="radiogroup">
            {(dlType === 'video' ? videoFormats : audioFormats).map(f => {
              const sel = dlType === 'video' ? videoFmt === f : audioFmt === f;
              return (
                <button key={f} role="radio" aria-checked={sel}
                  className={`format-chip${sel ? ' selected' : ''}`}
                  onClick={() => dlType === 'video' ? setVideoFmt(f) : setAudioFmt(f)}>
                  {f.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>

        <button
          className="download-btn"
          onClick={handleAddSelected}
          disabled={added || selectedEntries.length === 0}>
          <Plus size={17} />
          <span>
            {added
              ? `✓ ${selectedEntries.length} ${t.playlist.added}`
              : `${t.playlist.addAll} (${selectedEntries.length})`}
          </span>
        </button>
      </div>

      {/* ── Entry list with checkboxes ── */}
      <div className="playlist-entries">
        {/* Select all row */}
        <div className="playlist-select-all-row">
          <button
            className="pl-select-all-btn"
            onClick={toggleAll}
            title={allSelected ? t.playlist.deselectAll : t.playlist.selectAll}>
            {allSelected   ? <CheckSquare size={15} style={{ color: 'var(--gold)' }} /> :
             someSelected  ? <MinusSquare size={15} style={{ color: 'var(--gold)' }} /> :
                             <Square      size={15} />}
            <span>
              {allSelected ? t.playlist.deselectAll : t.playlist.selectAll}
              {' '}
              <span className="pl-count-label">
                ({selected.size}/{info.entries.length})
              </span>
            </span>
          </button>
        </div>

        {/* Entries */}
        <div className="playlist-entry-list">
          {info.entries.map((e, i) => {
            const isChecked = selected.has(e.id);
            return (
              <div
                key={e.id}
                className={`playlist-entry playlist-entry--selectable${isChecked ? ' playlist-entry--checked' : ''}`}
                onClick={() => toggleEntry(e.id)}
                role="checkbox"
                aria-checked={isChecked}
                tabIndex={0}
                onKeyDown={ev => ev.key === ' ' && toggleEntry(e.id)}
              >
                {/* Checkbox */}
                <div className="pe-checkbox">
                  {isChecked
                    ? <CheckSquare size={14} style={{ color: 'var(--gold)' }} />
                    : <Square      size={14} style={{ color: 'var(--text-3)' }} />}
                </div>

                {/* Index */}
                <span className="pe-index">{i + 1}</span>

                {/* Thumbnail */}
                {e.thumbnail && (
                  <img src={e.thumbnail} alt="" className="pe-thumb" loading="lazy" />
                )}

                {/* Title + duration */}
                <div className="pe-info">
                  <span className="pe-title" title={e.title}>{e.title}</span>
                  {e.duration && (
                    <span className="pe-dur">{formatDuration(e.duration)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
