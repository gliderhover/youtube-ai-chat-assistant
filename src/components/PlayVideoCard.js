import './PlayVideoCard.css';

function formatStat(n) {
  if (n == null || typeof n !== 'number') return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export default function PlayVideoCard({ video_url, title, thumbnail_url, view_count, like_count, release_date, error, closeMatches }) {
  if (error) {
    return <p className="play-video-card-error">{error}</p>;
  }
  if (!video_url) return null;

  const handleClick = () => {
    window.open(video_url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="play-video-card-root">
      <button
        type="button"
        className="play-video-card"
        onClick={handleClick}
        aria-label={`Play: ${title || 'video'}`}
      >
        <div className="play-video-card-thumb-wrap">
          {thumbnail_url ? (
            <img src={thumbnail_url} alt="" className="play-video-card-thumb" />
          ) : (
            <div className="play-video-card-thumb-placeholder" />
          )}
          <span className="play-video-card-play-icon" aria-hidden>▶</span>
        </div>
        <div className="play-video-card-body">
          <span className="play-video-card-title">{title || 'Untitled'}</span>
          <div className="play-video-card-stats">
            <span title="Views">{formatStat(view_count)} views</span>
            <span> · </span>
            <span title="Likes">{formatStat(like_count)} likes</span>
            {release_date && (
              <>
                <span> · </span>
                <span>{release_date}</span>
              </>
            )}
          </div>
        </div>
      </button>
      {closeMatches?.length > 0 && (
        <div className="play-video-card-close-matches">
          <span className="play-video-card-close-matches-label">Also matched:</span>
          <ul className="play-video-card-close-matches-list">
            {closeMatches.map((m, i) => (
              <li key={i}>
                <a href={m.video_url} target="_blank" rel="noopener noreferrer" className="play-video-card-close-match-link">
                  {m.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
