import { useState, useRef } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import html2canvas from 'html2canvas';
import './MetricVsTimeChart.css';

const LINE_COLOR = '#6ee7b7';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="metric-vs-time-tooltip">
      <p className="metric-vs-time-tooltip-label">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ margin: '0.15rem 0', color: p.stroke }}>
          {p.name}: <strong>{Number(p.value).toLocaleString()}</strong>
        </p>
      ))}
    </div>
  );
}

function ChartBlock({ data, field, containerRef, onDownload }) {
  return (
    <div ref={containerRef} className="metric-vs-time-chart-wrap">
      <p className="metric-vs-time-chart-label">{field} vs release_date</p>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, left: 0, bottom: 24 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
          <XAxis
            dataKey="release_date"
            tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 11, fontFamily: 'Inter,sans-serif' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
            tickLine={false}
            angle={-35}
            textAnchor="end"
            interval={0}
          />
          <YAxis
            tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11, fontFamily: 'Inter,sans-serif' }}
            axisLine={false}
            tickLine={false}
            width={55}
            tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v)}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.2)' }} />
          <Line
            type="monotone"
            dataKey={field}
            name={field}
            stroke={LINE_COLOR}
            strokeWidth={2}
            dot={{ fill: LINE_COLOR, r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="metric-vs-time-actions">
        <button type="button" className="metric-vs-time-download-btn" onClick={onDownload}>
          Download PNG
        </button>
      </div>
    </div>
  );
}

export default function MetricVsTimeChart({ data, field, sort, error }) {
  const inlineRef = useRef(null);
  const modalRef = useRef(null);
  const [modalOpen, setModalOpen] = useState(false);

  const captureAndDownload = async (ref) => {
    const el = ref?.current;
    if (!el) return;
    try {
      const canvas = await html2canvas(el, {
        backgroundColor: 'rgba(15, 15, 35, 0.95)',
        scale: 2,
        useCORS: true,
      });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plot_${field}_vs_time.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download failed:', e);
    }
  };

  if (error) {
    return <p className="metric-vs-time-error">{error}</p>;
  }
  if (!data?.length) return null;

  return (
    <div className="metric-vs-time-root">
      <div
        className="metric-vs-time-inline"
        role="button"
        tabIndex={0}
        onClick={() => setModalOpen(true)}
        onKeyDown={(e) => e.key === 'Enter' && setModalOpen(true)}
        aria-label="Click to enlarge chart"
      >
        <ChartBlock
          data={data}
          field={field}
          containerRef={inlineRef}
          onDownload={(e) => { e.stopPropagation(); captureAndDownload(inlineRef); }}
        />
        <span className="metric-vs-time-hint">Click to enlarge</span>
      </div>
      {modalOpen && (
        <div
          className="metric-vs-time-modal-overlay"
          onClick={() => setModalOpen(false)}
          role="presentation"
        >
          <div
            className="metric-vs-time-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Chart enlarged"
          >
            <button
              type="button"
              className="metric-vs-time-modal-close"
              onClick={() => setModalOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
            <div className="metric-vs-time-modal-content">
              <ChartBlock
                data={data}
                field={field}
                containerRef={modalRef}
                onDownload={() => captureAndDownload(modalRef)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
