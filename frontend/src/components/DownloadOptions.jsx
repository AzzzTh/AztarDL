import { useState } from 'react';
import { Download, Music, Film, Plus, CheckCircle, AlertCircle, Loader, Clock } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { useQueue } from '../context/QueueContext.jsx';

export default function DownloadOptions({ info, sourceUrl }) {
  const { t }          = useApp();
  const { addToQueue, items } = useQueue();

  const [dlType,    setDlType]    = useState(info.isAudioOnly ? 'audio' : 'video');
  const [quality,   setQuality]   = useState(info.videoQualities?.[0]?.height?.toString() || 'best');
  const [videoFmt,  setVideoFmt]  = useState('mp4');
  const [audioFmt,  setAudioFmt]  = useState(info.audioExportFormats?.[0] || 'm4a');

  // Track the qid returned by addToQueue for inline progress display
  const [trackedQid, setTrackedQid] = useState(null);

  const handleAddToQueue = () => {
    const qid = addToQueue([{
      title:   info.title,
      url:     sourceUrl,
      type:    dlType,
      format:  dlType === 'audio' ? audioFmt : videoFmt,
      quality: dlType === 'audio' ? 'best' : quality,
    }]);
    setTrackedQid(qid);
  };

  // Live-updated item from the queue
  const activeItem = trackedQid ? items.find(i => i.qid === trackedQid) : null;

  const isReady =
    (dlType === 'video' && info.videoQualities?.length > 0 && quality) ||
    (dlType === 'audio' && audioFmt);

  const videoFormats = ['mp4', 'webm'];

  return (
    <div className="panel-download">

      {/* ── Type tabs ── */}
      {!info.isAudioOnly && (
        <>
          <p className="panel-section-title">{t.download.title}</p>
          <div className="type-tabs" role="tablist">
            <button
              role="tab" aria-selected={dlType === 'video'}
              className={`type-tab${dlType === 'video' ? ' active' : ''}`}
              onClick={() => setDlType('video')}
            >
              <Film size={14} /> {t.download.typeVideo}
            </button>
            <button
              role="tab" aria-selected={dlType === 'audio'}
              className={`type-tab${dlType === 'audio' ? ' active' : ''}`}
              onClick={() => setDlType('audio')}
            >
              <Music size={14} /> {t.download.typeAudio}
            </button>
          </div>
        </>
      )}

      {info.isAudioOnly && (
        <p className="panel-section-title">{t.download.audioOnly}</p>
      )}

      {/* ── Quality grid ── */}
      {dlType === 'video' && info.videoQualities?.length > 0 && (
        <div>
          <p className="panel-section-title">{t.download.selectQuality}</p>
          <div className="quality-grid" role="radiogroup">
            {info.videoQualities.map(q => (
              <button
                key={q.height}
                role="radio" aria-checked={quality === q.height.toString()}
                className={`quality-chip${quality === q.height.toString() ? ' selected' : ''}`}
                onClick={() => setQuality(q.height.toString())}
              >
                <span className="q-label">{q.label}</span>
                {q.filesize && <span className="q-size">{q.filesize}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Video format ── */}
      {dlType === 'video' && (
        <div>
          <p className="panel-section-title">{t.download.selectFormat}</p>
          <div className="format-grid" role="radiogroup">
            {videoFormats.map(f => (
              <button key={f} role="radio" aria-checked={videoFmt === f}
                className={`format-chip${videoFmt === f ? ' selected' : ''}`}
                onClick={() => setVideoFmt(f)}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Audio format ── */}
      {dlType === 'audio' && (
        <div>
          <p className="panel-section-title">{t.download.audioFormats}</p>
          <div className="format-grid" role="radiogroup">
            {(info.audioExportFormats || ['m4a']).map(f => (
              <button key={f} role="radio" aria-checked={audioFmt === f}
                className={`format-chip${audioFmt === f ? ' selected' : ''}`}
                onClick={() => setAudioFmt(f)}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Add to queue button ── */}
      <div className="download-action-area">
        <button
          className="download-btn"
          onClick={handleAddToQueue}
          disabled={!isReady}
        >
          <Plus size={17} />
          <span>{t.download.addToQueue}</span>
        </button>

        {/* ── Inline progress for the most recently queued item ── */}
        {activeItem && (
          <div className={`inline-progress inline-progress--${activeItem.status}`}>
            {activeItem.status === 'pending' && (
              <><Clock size={13} /> <span>{t.queue.waiting}</span></>
            )}
            {activeItem.status === 'downloading' && (
              <>
                <Loader size={13} className="spin-anim" />
                <div className="ip-bar-wrap">
                  <div className="ip-bar"><div className="ip-fill" style={{ width: `${activeItem.progress}%` }} /></div>
                  <div className="ip-text">
                    <span>{Math.round(activeItem.progress)}%</span>
                    {activeItem.speed && <span>{activeItem.speed}</span>}
                    {activeItem.eta   && <span>{t.queue.eta}: <strong>{activeItem.eta}</strong></span>}
                  </div>
                </div>
              </>
            )}
            {activeItem.status === 'done' && (
              <><CheckCircle size={13} /> <span>{t.download.done}</span></>
            )}
            {activeItem.status === 'error' && (
              <><AlertCircle size={13} /> <span>{activeItem.error}</span></>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
