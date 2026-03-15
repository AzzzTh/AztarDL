// Central API helper — reads VITE_API_URL for production (GitHub Pages + Railway)
// In dev, BASE is empty string and Vite proxy handles /api/*
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export const api = {
  infoUrl: (url) => `${BASE}/api/info?url=${encodeURIComponent(url)}`,
  startJob: (body) =>
    fetch(`${BASE}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  progressUrl: (jobId) => `${BASE}/api/jobs/${jobId}/progress`,
  fileUrl:     (jobId) => `${BASE}/api/jobs/${jobId}/file`,
};
