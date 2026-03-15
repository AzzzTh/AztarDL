import { Routes, Route } from 'react-router-dom';
import Header from './components/Header.jsx';
import Home from './pages/Home.jsx';
import HowTo from './pages/HowTo.jsx';
import DownloadQueue from './components/DownloadQueue.jsx';
import { QueueProvider } from './context/QueueContext.jsx';

export default function App() {
  return (
    <QueueProvider>
      <div className="app-layout">
        <div className="bg-grid" aria-hidden="true" />
        <Header />
        <div className="page-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/como-se-usa" element={<HowTo />} />
          </Routes>
        </div>
        <footer className="footer">
          © {new Date().getFullYear()} AztarDL ◆ Powered by yt-dlp ◆ Gratis & Open
        </footer>

        {/* Floating download queue — shown only when there are items */}
        <DownloadQueue />
      </div>
    </QueueProvider>
  );
}
