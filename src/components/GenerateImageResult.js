import { useState } from 'react';
import './GenerateImageResult.css';

function downloadImage(dataUrl, filename = 'generated-image.png') {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export default function GenerateImageResult({ imageDataUrl, prompt, error }) {
  const [modalOpen, setModalOpen] = useState(false);

  if (error) {
    return <p className="generate-image-result-error">{error}</p>;
  }
  if (!imageDataUrl) return null;

  return (
    <div className="generate-image-result-root">
      <div
        className="generate-image-result-inline"
        role="button"
        tabIndex={0}
        onClick={() => setModalOpen(true)}
        onKeyDown={(e) => e.key === 'Enter' && setModalOpen(true)}
        aria-label="Click to enlarge"
      >
        <img src={imageDataUrl} alt={prompt || 'Generated image'} className="generate-image-result-img" />
        <div className="generate-image-result-actions">
          <button
            type="button"
            className="generate-image-result-download-btn"
            onClick={(e) => {
              e.stopPropagation();
              downloadImage(imageDataUrl);
            }}
          >
            Download
          </button>
        </div>
        <span className="generate-image-result-hint">Click to enlarge</span>
      </div>
      {modalOpen && (
        <div
          className="generate-image-result-modal-overlay"
          onClick={() => setModalOpen(false)}
          role="presentation"
        >
          <div
            className="generate-image-result-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Generated image enlarged"
          >
            <button
              type="button"
              className="generate-image-result-modal-close"
              onClick={() => setModalOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
            <img src={imageDataUrl} alt={prompt || 'Generated image'} className="generate-image-result-modal-img" />
            <div className="generate-image-result-modal-actions">
              <button
                type="button"
                className="generate-image-result-download-btn"
                onClick={() => downloadImage(imageDataUrl)}
              >
                Download PNG
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
