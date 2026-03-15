import { createContext, useContext, useState, useRef, useCallback } from 'react';
import { api } from '../api.js';

const QueueContext = createContext(null);

let _seq = 0;
const uid = () => `q_${Date.now()}_${++_seq}`;

export function QueueProvider({ children }) {
  const [items, setItems] = useState([]);
  const itemsRef   = useRef([]);
  const processing = useRef(false);

  const syncSet = (updater) => {
    setItems(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      itemsRef.current = next;
      return next;
    });
  };

  const patchItem = useCallback((qid, patch) => {
    syncSet(prev => prev.map(i => i.qid === qid ? { ...i, ...patch } : i));
  }, []);

  const processNext = useCallback(async () => {
    if (processing.current) return;
    const pending = itemsRef.current.find(i => i.status === 'pending');
    if (!pending) return;

    processing.current = true;
    patchItem(pending.qid, { status: 'downloading' });

    try {
      const res = await api.startJob({
        url: pending.url, type: pending.type,
        format: pending.format, quality: pending.quality,
        title: pending.title,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        patchItem(pending.qid, { status: 'error', error: err.error || 'Error al iniciar.' });
        processing.current = false;
        processNext();
        return;
      }

      const { jobId } = await res.json();
      patchItem(pending.qid, { jobId });

      await new Promise((resolve) => {
        const es = new EventSource(api.progressUrl(jobId));

        es.onmessage = (e) => {
          const data = JSON.parse(e.data);
          if (data.status === 'done') {
            const a = document.createElement('a');
            a.href = api.fileUrl(jobId);
            a.download = '';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            patchItem(pending.qid, { status: 'done', progress: 100, speed: null, eta: null });
            es.close();
            resolve();
          } else if (data.status === 'error') {
            patchItem(pending.qid, { status: 'error', error: data.error || 'Error en descarga.' });
            es.close();
            resolve();
          } else {
            patchItem(pending.qid, {
              progress: data.progress ?? 0,
              speed: data.speed ?? null,
              eta: data.eta ?? null,
            });
          }
        };

        es.onerror = () => {
          es.close();
          patchItem(pending.qid, { status: 'error', error: 'Error de conexión.' });
          resolve();
        };
      });

    } catch (err) {
      patchItem(pending.qid, { status: 'error', error: err.message });
    }

    processing.current = false;
    processNext();
  }, [patchItem]);

  const addToQueue = useCallback((newItems) => {
    const mapped = newItems.map(item => ({
      qid: uid(),
      title: item.title || 'Video',
      url: item.url,
      type: item.type || 'video',
      format: item.format || 'mp4',
      quality: item.quality || '1080',
      status: 'pending',
      progress: 0,
      speed: null,
      eta: null,
      error: null,
      jobId: null,
    }));
    syncSet(prev => [...prev, ...mapped]);
    setTimeout(processNext, 80);
    // Return the first qid so callers can track the item
    return mapped[0]?.qid ?? null;
  }, [processNext]);

  const removeFromQueue = useCallback((qid) => {
    syncSet(prev => prev.filter(i => i.qid !== qid));
  }, []);

  const clearDone = useCallback(() => {
    syncSet(prev => prev.filter(i => i.status !== 'done' && i.status !== 'error'));
  }, []);

  return (
    <QueueContext.Provider value={{ items, addToQueue, removeFromQueue, clearDone }}>
      {children}
    </QueueContext.Provider>
  );
}

export const useQueue = () => useContext(QueueContext);
