import { useState } from 'react';
import { Clock, User, Monitor, Play } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

function formatDuration(seconds) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getYouTubeId(url) {
  const match = url?.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]{11})/
  );
  return match?.[1] || null;
}

export default function MediaPanel({ info, sourceUrl }) {
  const { t } = useApp();
  const [playerActive, setPlayerActive] = useState(false);

  const youtubeId = getYouTubeId(sourceUrl);
  const duration = formatDuration(info.duration);

  return (
    <div className="panel-info">

      {/* ── Mini player ── */}
      <div className="mini-player">
        {playerActive && youtubeId ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&modestbranding=1&rel=0`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            title={info.title}
          />
        ) : (
          <>
            {info.thumbnail && (
              <img src={info.thumbnail} alt={info.title} loading="lazy" />
            )}
            {youtubeId && (
              <div
                className="play-overlay"
                onClick={() => setPlayerActive(true)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && setPlayerActive(true)}
                aria-label={t.media.preview}
              >
                <div className="play-btn-circle">
                  <Play size={20} fill="currentColor" color="#06060D" style={{ marginLeft: 2 }} />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Title ── */}
      <p className="video-meta-title">{info.title}</p>

      {/* ── Description ── */}
      <p className="video-meta-desc">
        {info.description || t.media.noDescription}
      </p>

      {/* ── Chips row ── */}
      <div className="video-meta-row">
        {info.uploader && (
          <span className="meta-chip">
            <User size={11} />
            <span className="label">{t.media.by}</span>
            {info.uploader}
          </span>
        )}
        {duration && (
          <span className="meta-chip">
            <Clock size={11} />
            <span className="label">{t.media.duration}</span>
            {duration}
          </span>
        )}
        {info.platform && (
          <span className="meta-chip">
            <Monitor size={11} />
            <span className="label">{t.media.platform}</span>
            {info.platform}
          </span>
        )}
      </div>
    </div>
  );
}
