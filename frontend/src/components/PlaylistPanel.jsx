import { useState } from 'react';
import { ListVideo, Film, Music, Plus, User } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { useQueue } from '../context/QueueContext.jsx';

export default function PlaylistPanel({ info }) {
  const { t } = useApp();
  const { addToQueue } = useQueue();

  const [dlType,   setDlType]   = useState('video');
  const [videoFmt, setVideoFmt] = useState('mp4');
  const [audioFmt, setAudioFmt] = useState('mp3');
  const [added,    setAdded]    = useState(false);

  const handleAddAll = () => {
    const queueItems = info.entries.map(e => ({
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
      {/* Header info */}
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

      {/* Download options */}
      <div className="playlist-options">
        <div>
          <p className="panel-section-title">{t.download.title}</p>
          <div className="type-tabs" role="tablist">
            <button role="tab" aria-selected={dlType === 'video'}
              className={`type-tab${dlType === 'video' ? ' active' : ''}`}
              onClick={() => setDlType('video')}
            >
              <Film size={14} /> {t.download.typeVideo}
            </button>
            <button role="tab" aria-selected={dlType === 'audio'}
              className={`type-tab${dlType === 'audio' ? ' active' : ''}`}
              onClick={() => setDlType('audio')}
            >
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
                  onClick={() => dlType === 'video' ? setVideoFmt(f) : setAudioFmt(f)}
                >
                  {f.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>

        <button className="download-btn" onClick={handleAddAll} disabled={added}>
          <Plus size={17} />
          <span>
            {added
              ? `✓ ${info.entryCount} ${t.playlist.added}`
              : `${t.playlist.addAll} (${info.entryCount})`}
          </span>
        </button>
      </div>

      {/* Preview of entries */}
      <div className="playlist-entries">
        <p className="panel-section-title">{t.playlist.contents}</p>
        <div className="playlist-entry-list">
          {info.entries.slice(0, 10).map((e, i) => (
            <div key={e.id} className="playlist-entry">
              <span className="pe-index">{i + 1}</span>
              {e.thumbnail && <img src={e.thumbnail} alt="" className="pe-thumb" loading="lazy" />}
              <span className="pe-title" title={e.title}>{e.title}</span>
            </div>
          ))}
          {info.entries.length > 10 && (
            <div className="playlist-entry playlist-entry--more">
              + {info.entries.length - 10} {t.playlist.more}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
