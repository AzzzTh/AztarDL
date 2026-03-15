import { useState } from 'react';
import { Download, X, CheckCircle, AlertCircle, Clock, ChevronDown, ChevronUp, Trash2, Film, Music } from 'lucide-react';
import { useQueue } from '../context/QueueContext.jsx';
import { useApp } from '../context/AppContext.jsx';

export default function DownloadQueue() {
  const { items, removeFromQueue, clearDone } = useQueue();
  const { t } = useApp();
  const [collapsed, setCollapsed] = useState(false);

  if (!items.length) return null;

  const active = items.filter(i => i.status === 'downloading' || i.status === 'pending').length;
  const done   = items.filter(i => i.status === 'done').length;
  const errors = items.filter(i => i.status === 'error').length;

  return (
    <div className={`queue-panel${collapsed ? ' queue-panel--collapsed' : ''}`}>
      <div
        className="queue-header"
        onClick={() => setCollapsed(v => !v)}
        role="button" tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setCollapsed(v => !v)}
      >
        <div className="queue-header-left">
          <Download size={14} />
          <span className="queue-title">{t.queue.title}</span>
          {active > 0 && <span className="queue-badge">{active}</span>}
          {done  > 0 && <span className="queue-badge queue-badge--done">{done} ✓</span>}
          {errors > 0 && <span className="queue-badge queue-badge--err">{errors} ✗</span>}
        </div>
        <div className="queue-header-right" onClick={e => e.stopPropagation()}>
          {(done + errors) > 0 && (
            <button className="queue-icon-btn" title={t.queue.clearDone} onClick={clearDone}>
              <Trash2 size={12} />
            </button>
          )}
          <button className="queue-icon-btn" onClick={() => setCollapsed(v => !v)}>
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="queue-list">
          {items.map(item => (
            <QueueItem key={item.qid} item={item} onRemove={removeFromQueue} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function QueueItem({ item, onRemove, t }) {
  const canRemove = item.status !== 'downloading';

  const icons = {
    pending:     <Clock size={13} className="qi-icon qi-icon--pending" />,
    downloading: <Download size={13} className="qi-icon qi-icon--dl" />,
    done:        <CheckCircle size={13} className="qi-icon qi-icon--done" />,
    error:       <AlertCircle size={13} className="qi-icon qi-icon--err" />,
  };

  return (
    <div className={`queue-item queue-item--${item.status}`}>
      <div className="qi-status">{icons[item.status]}</div>

      <div className="qi-body">
        <p className="qi-title" title={item.title}>{item.title}</p>

        <div className="qi-meta">
          {item.type === 'video'
            ? <span className="qi-pill"><Film size={10} /> {item.format.toUpperCase()}</span>
            : <span className="qi-pill"><Music size={10} /> {item.format.toUpperCase()}</span>
          }
          {item.status === 'downloading' && item.speed && (
            <span className="qi-pill qi-pill--speed">{item.speed}</span>
          )}
          {item.status === 'error' && (
            <span className="qi-pill qi-pill--err" title={item.error}>{item.error?.slice(0,40)}</span>
          )}
        </div>

        {item.status === 'downloading' && (
          <div className="qi-progress">
            <div className="qi-progress-track">
              <div className="qi-progress-fill" style={{ width: `${item.progress}%` }} />
            </div>
            <div className="qi-progress-info">
              <span>{Math.round(item.progress)}%</span>
              {item.eta && <span>{t.queue.eta}: {item.eta}</span>}
            </div>
          </div>
        )}

        {item.status === 'pending' && (
          <p className="qi-pending-label">{t.queue.waiting}</p>
        )}
      </div>

      {canRemove && (
        <button className="qi-remove" onClick={() => onRemove(item.qid)} title={t.queue.remove}>
          <X size={11} />
        </button>
      )}
    </div>
  );
}
