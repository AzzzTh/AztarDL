import { createContext, useContext, useState, useEffect } from 'react';
import { translations } from '../i18n/translations.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [theme,   setTheme]   = useState(() => localStorage.getItem('aztardl-theme')   || 'dark');
  const [lang,    setLang]    = useState(() => localStorage.getItem('aztardl-lang')    || 'es');
  // 'none' means no cookies. Other values: 'chrome', 'firefox', 'edge', 'brave', 'opera', 'safari', 'vivaldi'
  const [browser, setBrowser] = useState(() => localStorage.getItem('aztardl-browser') || 'none');

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('aztardl-theme', theme); }, [theme]);
  useEffect(() => { document.documentElement.setAttribute('lang', lang); localStorage.setItem('aztardl-lang', lang); }, [lang]);
  useEffect(() => { localStorage.setItem('aztardl-browser', browser); }, [browser]);

  const t           = translations[lang] || translations.es;
  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  return (
    <AppContext.Provider value={{ theme, toggleTheme, lang, setLang, t, browser, setBrowser }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
