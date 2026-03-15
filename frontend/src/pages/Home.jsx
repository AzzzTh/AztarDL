import { useState, useEffect } from 'react';
import UrlInput from '../components/UrlInput.jsx';
import MediaPanel from '../components/MediaPanel.jsx';
import DownloadOptions from '../components/DownloadOptions.jsx';
import PlaylistPanel from '../components/PlaylistPanel.jsx';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api.js';

export default function Home() {
  const { t } = useApp();
  const [url,       setUrl]       = useState('');
  const [videoInfo, setVideoInfo] = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  // Clear panel when URL is wiped
  useEffect(() => {
    if (!url.trim()) { setVideoInfo(null); setError(''); }
  }, [url]);

  const handleAnalyze = async () => {
    const trimmed = url.trim();
    if (!trimmed) { setError(t.errors.emptyUrl); return; }
    try { new URL(trimmed); } catch { setError(t.errors.invalid); return; }

    setError('');
    setLoading(true);
    setVideoInfo(null);

    try {
      const res  = await fetch(api.infoUrl(trimmed));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.errors.fetch);
      setVideoInfo(data);
    } catch (err) {
      setError(err.message || t.errors.fetch);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="home-hero">
      <div className="hero-badge">◆ {t.home.badge} ◆</div>

      <h1 className="hero-title">
        {t.home.title}
        <span className="accent">{t.home.titleAccent}</span>
      </h1>

      <p className="hero-subtitle">{t.home.subtitle}</p>

      <UrlInput
        url={url} setUrl={setUrl}
        onAnalyze={handleAnalyze}
        loading={loading} error={error}
      />

      {/* Single video panel */}
      {videoInfo && !videoInfo.isPlaylist && (
        <div className="media-panel">
          <div className="panel-grid">
            <MediaPanel info={videoInfo} sourceUrl={url} />
            <DownloadOptions info={videoInfo} sourceUrl={url} />
          </div>
        </div>
      )}

      {/* Playlist panel */}
      {videoInfo && videoInfo.isPlaylist && (
        <div className="media-panel">
          <PlaylistPanel info={videoInfo} />
        </div>
      )}
    </main>
  );
}
