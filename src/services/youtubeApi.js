// In development, use the CRA proxy (same-origin /api → localhost:3001).
// In production, respect REACT_APP_API_URL.
const API =
  process.env.NODE_ENV === 'production'
    ? process.env.REACT_APP_API_URL || ''
    : '';

const api = async (path, options = {}) => {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const text = await res.text();
  if (!res.ok) {
    if (text.trimStart().startsWith('<!') || text.includes('</html>')) {
      throw new Error(
        'Backend returned an HTML error (route may be missing). Restart the backend: stop it with Ctrl+C, then run "npm run server" again.'
      );
    }
    // Try to parse JSON error from backend
    try {
      const j = JSON.parse(text);
      throw new Error(j.error || text || res.statusText);
    } catch (e) {
      if (e.message && e.message !== text) throw e;
      throw new Error(text || res.statusText);
    }
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(text || 'Invalid response from server');
  }
};

export const startYoutubeJob = async (channelUrl, maxVideos) => {
  return api('/api/youtube/start', {
    method: 'POST',
    body: JSON.stringify({ channelUrl, maxVideos }),
  });
};

export const getYoutubeProgress = async (jobId) => {
  return api(`/api/youtube/progress?jobId=${encodeURIComponent(jobId)}`);
};

export const getYoutubeResult = async (jobId) => {
  return api(`/api/youtube/result?jobId=${encodeURIComponent(jobId)}`);
};
