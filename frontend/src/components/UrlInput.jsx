import { useRef } from 'react';
import { Clipboard, Search, X, Loader } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

export default function UrlInput({ url, setUrl, onAnalyze, loading, error }) {
  const { t } = useApp();
  const inputRef = useRef(null);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text.trim());
      inputRef.current?.focus();
    } catch {
      // Fallback: just focus so user can paste manually
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !loading) {
      onAnalyze();
    }
  };

  const handleChange = (e) => {
    setUrl(e.target.value);
  };

  const handleClear = () => {
    setUrl('');
    inputRef.current?.focus();
  };

  return (
    <div className="input-container">
      <div className="input-box">
        {/* URL text input */}
        <input
          ref={inputRef}
          type="url"
          className="url-input"
          placeholder={t.home.placeholder}
          value={url}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
          aria-label="URL del video o audio"
        />

        {/* Clear button (only shown when there's text) */}
        {url && (
          <>
            <div className="input-divider" />
            <button
              className="input-btn"
              onClick={handleClear}
              title={t.home.clearBtn}
              aria-label={t.home.clearBtn}
            >
              <X size={15} />
            </button>
          </>
        )}

        {/* Paste button */}
        <div className="input-divider" />
        <button
          className="input-btn paste-btn"
          onClick={handlePaste}
          title={t.home.pastBtn}
          aria-label={t.home.pastBtn}
        >
          <Clipboard size={15} />
          <span>{t.home.pastBtn}</span>
        </button>

        {/* Analyze/Download button */}
        <button
          className="input-btn primary"
          onClick={onAnalyze}
          disabled={loading || !url.trim()}
          aria-label={t.home.analyzeBtn}
        >
          {loading ? (
            <>
              <div className="spinner" />
              <span>{t.home.analyzing}</span>
            </>
          ) : (
            <>
              <Search size={15} />
              <span>{t.home.analyzeBtn}</span>
            </>
          )}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="input-error" role="alert">
          <X size={14} />
          {error}
        </div>
      )}
    </div>
  );
}
