import './askAnswerVisuals.css';
import { chartsFromContext } from './askCharts.js';

export { chartsFromContext };

const PALETTE = ['#1A304A', '#9A6E20', '#1B5E9E', '#1A6A3C', '#B32E1E', '#AE6418', '#6B3FA0', '#2A6E7A'];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Horizontal / vertical bar chart (SVG). */
function BarChart({ chart, horizontal = false }) {
  const data = (chart?.data || [])
    .map((d, i) => ({
      label: String(d.label || d.name || `#${i + 1}`),
      value: num(d.value),
      color: d.color || PALETTE[i % PALETTE.length],
    }))
    .filter((d) => d.label);
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  const W = 360;
  const rowH = 28;
  const H = horizontal ? Math.max(120, data.length * rowH + 20) : 180;
  const padL = horizontal ? 100 : 28;
  const padR = 16;
  const padT = 12;
  const padB = horizontal ? 12 : 40;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  if (horizontal) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="ask-chart-svg" role="img" aria-label={chart.title || 'Bar chart'}>
        {data.map((d, i) => {
          const y = padT + i * rowH;
          const w = (d.value / max) * innerW;
          return (
            <g key={d.label}>
              <text x={padL - 8} y={y + 14} textAnchor="end" className="ask-chart-label">
                {d.label.length > 14 ? `${d.label.slice(0, 13)}…` : d.label}
              </text>
              <rect x={padL} y={y + 4} width={Math.max(2, w)} height={16} rx={3} fill={d.color} />
              <text x={padL + Math.max(2, w) + 6} y={y + 15} className="ask-chart-val">
                {d.value >= 1000 ? Math.round(d.value).toLocaleString('en-IN') : d.value}
                {chart.unit ? ` ${chart.unit}` : ''}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  const gap = 8;
  const barW = Math.max(12, (innerW - gap * (data.length - 1)) / data.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ask-chart-svg" role="img" aria-label={chart.title || 'Bar chart'}>
      {data.map((d, i) => {
        const h = (d.value / max) * innerH;
        const x = padL + i * (barW + gap);
        const y = padT + innerH - h;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barW} height={Math.max(2, h)} rx={3} fill={d.color} />
            <text x={x + barW / 2} y={H - 8} textAnchor="middle" className="ask-chart-label">
              {d.label.length > 8 ? `${d.label.slice(0, 7)}…` : d.label}
            </text>
            <text x={x + barW / 2} y={y - 4} textAnchor="middle" className="ask-chart-val">
              {d.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function DonutChart({ chart }) {
  const data = (chart?.data || [])
    .map((d, i) => ({
      label: String(d.label || d.name || `#${i + 1}`),
      value: Math.max(0, num(d.value)),
      color: d.color || PALETTE[i % PALETTE.length],
    }))
    .filter((d) => d.value > 0);
  if (!data.length) return null;
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const cx = 90;
  const cy = 90;
  const r = 62;
  const stroke = 22;
  let angle = -Math.PI / 2;
  const arcs = data.map((d) => {
    const sweep = (d.value / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const large = sweep > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const path = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    return { ...d, path };
  });

  return (
    <div className="ask-donut-wrap">
      <svg viewBox="0 0 180 180" className="ask-chart-svg ask-donut-svg" role="img" aria-label={chart.title || 'Donut chart'}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EAE6DC" strokeWidth={stroke} />
        {arcs.map((a) => (
          <path key={a.label} d={a.path} fill="none" stroke={a.color} strokeWidth={stroke} strokeLinecap="butt" />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" className="ask-donut-total">
          {total}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="ask-donut-sub">
          {chart.unit || 'total'}
        </text>
      </svg>
      <ul className="ask-donut-legend">
        {data.map((d) => (
          <li key={d.label}>
            <span className="ask-swatch" style={{ background: d.color }} />
            <span>
              {d.label} · <strong>{d.value}</strong>
              {chart.unit ? ` ${chart.unit}` : ''} ({Math.round((d.value / total) * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChartBlock({ chart }) {
  if (!chart || !Array.isArray(chart.data) || !chart.data.length) return null;
  const type = String(chart.type || 'bar').toLowerCase();
  return (
    <figure className="ask-chart-card">
      {chart.title ? <figcaption className="ask-chart-title">{chart.title}</figcaption> : null}
      {chart.narrative ? <p className="ask-chart-narrative">{chart.narrative}</p> : null}
      {type === 'donut' || type === 'pie' ? (
        <DonutChart chart={chart} />
      ) : type === 'hbar' || type === 'horizontalBar' ? (
        <BarChart chart={chart} horizontal />
      ) : (
        <BarChart chart={chart} />
      )}
    </figure>
  );
}

function formatInline(s) {
  return String(s)
    .split(/(\*\*[^*]+\*\*)/g)
    .map((p, i) =>
      p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>,
    );
}

function MarkdownBlock({ text }) {
  const lines = String(text || '').split(/\r?\n/);
  return (
    <div className="ask-md">
      {lines.map((ln, i) => {
        if (!ln.trim()) return <br key={i} />;
        if (ln.startsWith('### ')) return <h3 key={i}>{ln.slice(4)}</h3>;
        if (ln.startsWith('#### ')) return <h4 key={i}>{ln.slice(5)}</h4>;
        if (/^\s*[-*]\s+/.test(ln)) {
          return (
            <div key={i} className="ask-md-li">
              {formatInline(ln.replace(/^\s*[-*]\s+/, ''))}
            </div>
          );
        }
        if (/^\s*\d+\.\s+/.test(ln)) {
          return (
            <div key={i} className="ask-md-li ask-md-ol">
              {formatInline(ln.trim())}
            </div>
          );
        }
        return <p key={i}>{formatInline(ln)}</p>;
      })}
    </div>
  );
}

function formatKpiValue(k, v) {
  if (v == null) return '—';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  if (typeof v === 'number') {
    const key = String(k || '').toLowerCase();
    if (/pct|percent|rate|spi|cpi/.test(key)) return String(v);
    if (/due|received|pending|outstanding|collected|demanded|billed|paid|accrued|topline|amount|cost|fee|gdv/.test(key) && Math.abs(v) >= 1000) {
      return `₹${Math.round(v).toLocaleString('en-IN')}`;
    }
    return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-IN') : String(v);
  }
  return String(v);
}

/**
 * Structured Ask AI answer: headline, section narratives, charts, full markdown.
 */
export function AskAnswerVisuals({ answer }) {
  if (!answer) return null;
  const sections = Array.isArray(answer.sections) ? answer.sections : [];
  const charts = Array.isArray(answer.charts) ? answer.charts : [];
  const highlights =
    answer.highlights && typeof answer.highlights === 'object' && !Array.isArray(answer.highlights)
      ? Object.entries(answer.highlights).slice(0, 8)
      : [];

  const directFirst = [...sections].sort((a, b) => {
    const as = /direct/i.test(a.title || '') ? 0 : 1;
    const bs = /direct/i.test(b.title || '') ? 0 : 1;
    return as - bs;
  });

  return (
    <div className="ask-answer-visuals">
      {answer.headline ? <h3 className="ask-headline">{answer.headline}</h3> : null}

      {directFirst.length
        ? directFirst.map((s, i) => (
            <section key={`${s.title || i}`} className={`ask-sec ask-sec-${s.kind || 'general'}`}>
              <div className="ask-sec-kind">{s.kind || 'insight'}</div>
              {s.title ? <h4>{s.title}</h4> : null}
              {s.narrative ? <p className="ask-sec-narrative">{s.narrative}</p> : null}
              {s.body ? <MarkdownBlock text={s.body} /> : null}
            </section>
          ))
        : answer.markdown
          ? <MarkdownBlock text={answer.markdown} />
          : null}

      {highlights.length ? (
        <div className="ask-kpi-strip">
          {highlights.map(([k, v]) => (
            <div key={k} className="ask-kpi">
              <div className="ask-kpi-v">{formatKpiValue(k, v)}</div>
              <div className="ask-kpi-l">{k}</div>
            </div>
          ))}
        </div>
      ) : null}

      {charts.length ? (
        <div className="ask-charts">
          {charts.slice(0, 4).map((c, i) => (
            <ChartBlock key={`${c.title || 'chart'}-${i}`} chart={c} />
          ))}
        </div>
      ) : null}

      {sections.length && answer.markdown ? (
        <details className="ask-full-md">
          <summary>Full narrative</summary>
          <MarkdownBlock text={answer.markdown} />
        </details>
      ) : null}
    </div>
  );
}

