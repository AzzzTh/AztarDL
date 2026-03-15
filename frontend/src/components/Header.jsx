import { useState, useRef, useEffect } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { Globe, Moon, Sun, ExternalLink, Cookie } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { langNames } from '../i18n/translations.js';

// Browsers supported by yt-dlp --cookies-from-browser
const BROWSERS = [
  { id: 'none',     label: 'Sin cookies',  emoji: '🚫' },
  { id: 'chrome',   label: 'Chrome',       emoji: '🌐' },
  { id: 'firefox',  label: 'Firefox',      emoji: '🦊' },
  { id: 'edge',     label: 'Edge',         emoji: '🌀' },
  { id: 'brave',    label: 'Brave',        emoji: '🦁' },
  { id: 'opera',    label: 'Opera',        emoji: '🅾️'  },
  { id: 'vivaldi',  label: 'Vivaldi',      emoji: '🎵' },
  { id: 'safari',   label: 'Safari',       emoji: '🧭' },
];

function Dropdown({ open, children, style }) {
  if (!open) return null;
  return (
    <div className="lang-menu" style={style}>
      {children}
    </div>
  );
}

export default function Header() {
  const { theme, toggleTheme, lang, setLang, t, browser, setBrowser } = useApp();

  const [langOpen,    setLangOpen]    = useState(false);
  const [cookieOpen,  setCookieOpen]  = useState(false);

  const langRef   = useRef(null);
  const cookieRef = useRef(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (langRef.current   && !langRef.current.contains(e.target))   setLangOpen(false);
      if (cookieRef.current && !cookieRef.current.contains(e.target)) setCookieOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const currentBrowser = BROWSERS.find(b => b.id === browser) || BROWSERS[0];
  const cookieActive   = browser !== 'none';

  return (
    <header className="header">
      {/* Logo */}
      <Link to="/" className="header-logo">
        <div className="logo-diamond" />
        AztarDL
      </Link>

      {/* Center nav */}
      <nav className="header-center">
        <NavLink to="/como-se-usa" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          {t.nav.howTo}
        </NavLink>
      </nav>

      {/* Right actions */}
      <div className="header-actions">

        {/* ── Language selector ── */}
        <div className="lang-dropdown" ref={langRef}>
          <button className="icon-btn" title={t.lang} onClick={() => { setLangOpen(v => !v); setCookieOpen(false); }}>
            <Globe size={16} />
          </button>
          <Dropdown open={langOpen}>
            {Object.entries(langNames).map(([code, { label, flag }]) => (
              <button key={code} className={`lang-option${lang === code ? ' selected' : ''}`}
                onClick={() => { setLang(code); setLangOpen(false); }}>
                <span>{flag}</span><span>{label}</span>
              </button>
            ))}
          </Dropdown>
        </div>

        {/* ── Theme toggle ── */}
        <button className="icon-btn" title={theme === 'dark' ? t.theme.light : t.theme.dark} onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {/* ── Cookie / Browser selector ── */}
        <div className="lang-dropdown" ref={cookieRef}>
          <button
            className="icon-btn"
            title={t.cookies.title}
            onClick={() => { setCookieOpen(v => !v); setLangOpen(false); }}
            style={cookieActive ? { borderColor: 'var(--gold)', color: 'var(--gold)', background: 'var(--gold-dim)' } : {}}
            aria-label={t.cookies.title}
          >
            {cookieActive
              ? <span style={{ fontSize: '14px', lineHeight: 1 }}>{currentBrowser.emoji}</span>
              : <Cookie size={16} />
            }
          </button>

          <Dropdown open={cookieOpen} style={{ minWidth: 220 }}>
            {/* Header row */}
            <div style={{ padding: '10px 16px 6px', borderBottom: '1px solid var(--border)' }}>
              <p style={{ fontFamily: 'var(--font-head)', fontSize: '0.75rem', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                🍪 {t.cookies.title}
              </p>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-2)', marginTop: 4, lineHeight: 1.4 }}>
                {t.cookies.hint}
              </p>
            </div>

            {BROWSERS.map(b => (
              <button key={b.id} className={`lang-option${browser === b.id ? ' selected' : ''}`}
                onClick={() => { setBrowser(b.id); setCookieOpen(false); }}>
                <span style={{ fontSize: '15px' }}>{b.emoji}</span>
                <span>{b.label}</span>
                {b.id !== 'none' && <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>cookies</span>}
              </button>
            ))}
          </Dropdown>
        </div>

        {/* ── Contact ── */}
        <a href="https://aztaroth.carrd.co/" target="_blank" rel="noopener noreferrer"
          className="icon-btn" title={t.nav.contact}>
          <ExternalLink size={16} />
        </a>

      </div>
    </header>
  );
}
