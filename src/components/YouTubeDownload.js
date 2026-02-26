import { useState, useRef, useEffect } from 'react';
import { startYoutubeJob, getYoutubeProgress, getYoutubeResult } from '../services/youtubeApi';
import './YouTubeDownload.css';

const POLL_INTERVAL_MS = 800;

export default function YouTubeDownload({ username, firstName, lastName, onLogout, setPage }) {
  const [channelUrl, setChannelUrl] = useState('https://www.youtube.com/@veritasium');
  const [maxVideos, setMaxVideos] = useState(10);
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, status: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    return stopPolling;
  }, []);

  useEffect(() => {
    if (!jobId || progress.status === 'complete' || progress.status === 'error') return;
    const poll = async () => {
      try {
        const p = await getYoutubeProgress(jobId);
        setProgress(p);
        if (p.status === 'complete') {
          stopPolling();
          const res = await getYoutubeResult(jobId);
          if (res && res.videos && res.videos.length === 0) {
            setError(
              'No videos could be extracted. Per-video extraction failed. Check JS runtime, cookies, or video availability.'
            );
            setResult(null);
          } else {
            setResult(res);
          }
        } else if (p.status === 'error') {
          stopPolling();
          const errMsg = p.error || 'Job failed';
          if (errMsg.includes('yt-dlp is not installed') || errMsg.includes('not found in PATH')) {
            setError(
              'yt-dlp is not installed or not on PATH. Install it from https://github.com/yt-dlp/yt-dlp and ensure the "yt-dlp" command works in a terminal, then restart the backend.'
            );
          } else {
            setError(errMsg);
          }
        }
      } catch (err) {
        const msg = err.message || '';
        setError(
          msg.includes('Proxy error') || msg.includes('ECONNREFUSED') || msg.includes('Failed to fetch')
            ? 'Cannot reach the backend. Make sure the server is running.'
            : msg.includes('yt-dlp is not installed') || msg.includes('not found in PATH')
            ? 'yt-dlp is not installed or not on PATH. Install it from https://github.com/yt-dlp/yt-dlp and ensure the "yt-dlp" command works in a terminal, then restart the backend.'
            : msg
        );
        stopPolling();
      }
    };
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, [jobId, progress.status]);

  const handleStart = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setProgress({ done: 0, total: 0, status: '' });
    setLoading(true);
    try {
      const { jobId: id } = await startYoutubeJob(channelUrl.trim(), maxVideos);
      setJobId(id);
    } catch (err) {
      const msg = err.message || '';
      // Network/backend connectivity issues
      if (msg.includes('Proxy error') || msg.includes('ECONNREFUSED') || msg.includes('Failed to fetch')) {
        setError('Cannot reach the backend. Start the server (e.g. run "npm run start" or "npm run server" in another terminal).');
      } else if (msg.includes('yt-dlp is not installed') || msg.includes('not found in PATH')) {
        setError(
          'yt-dlp is not installed or not on PATH. Install it from https://github.com/yt-dlp/yt-dlp and ensure the "yt-dlp" command works in a terminal, then restart the backend.'
        );
      } else {
        // Generic backend JSON error or plain text
        try {
          const j = JSON.parse(msg);
          setError(j.error || msg);
        } catch {
          setError(msg || 'Failed to start job');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadJson = () => {
    if (!result || !result.videos) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'youtube_channel_data.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const isRunning = jobId && progress.status !== 'complete' && progress.status !== 'error';

  return (
    <div className="chat-layout">
      <aside className="chat-sidebar">
        <div className="sidebar-top">
          <h1 className="sidebar-title">Chat</h1>
          <nav className="sidebar-nav">
            <button type="button" className="sidebar-nav-link" onClick={() => setPage('chat')}>
              Chat
            </button>
            <button type="button" className="sidebar-nav-link active">
              YouTube Channel Download
            </button>
          </nav>
        </div>
        <div className="sidebar-sessions" style={{ flex: 1 }} />
        <div className="sidebar-footer">
          <span className="sidebar-username" title={username}>
            {firstName && lastName ? `Logged in as: ${firstName} ${lastName}` : username}
          </span>
          <button type="button" onClick={onLogout} className="sidebar-logout">
            Log out
          </button>
        </div>
      </aside>

      <div className="chat-main ytd-main">
        <header className="chat-header">
          <h2 className="chat-header-title">YouTube Channel Download</h2>
        </header>
        <div className="ytd-content">
          <form onSubmit={handleStart} className="ytd-form">
            <label className="ytd-label">
              YouTube channel URL
              <input
                type="url"
                className="ytd-input"
                placeholder="https://www.youtube.com/@veritasium"
                value={channelUrl}
                onChange={(e) => setChannelUrl(e.target.value)}
                required
                disabled={loading || isRunning}
              />
            </label>
            <label className="ytd-label">
              Max videos
              <input
                type="number"
                className="ytd-input"
                min={1}
                max={100}
                value={maxVideos}
                onChange={(e) => setMaxVideos(Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 10)))}
                disabled={loading || isRunning}
              />
            </label>
            {error && <p className="ytd-error">{error}</p>}
            <button type="submit" className="ytd-btn" disabled={loading || isRunning}>
              {loading ? 'Starting…' : isRunning ? 'Downloading…' : 'Download Channel Data'}
            </button>
          </form>

          {isRunning && (
            <div className="ytd-progress">
              <div className="ytd-progress-bar-wrap">
                <div
                  className="ytd-progress-bar"
                  style={{
                    width: progress.total ? `${(100 * progress.done) / progress.total}%` : '0%',
                  }}
                />
              </div>
              <p className="ytd-progress-text">
                Attempted {progress.done} of {progress.total}; succeeded {progress.successCount ?? 0} of{' '}
                {progress.maxVideos ?? progress.total} videos.
              </p>
            </div>
          )}

          {result && result.videos && (
            <div className="ytd-done">
              <p className="ytd-done-text">Download complete. {result.videos.length} videos.</p>
              <button type="button" className="ytd-btn" onClick={handleDownloadJson}>
                Download JSON
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
