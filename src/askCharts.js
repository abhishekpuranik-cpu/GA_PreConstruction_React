/** Chart helpers for Ask AI (no React). */

export function chartsFromContext(context) {
  const charts = [];
  const totals = context?.totals || context?.summary || {};
  const numeric = Object.entries(totals)
    .filter(([, v]) => typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))))
    .map(([label, value]) => ({ label, value: Number(value) }))
    .slice(0, 8);

  if (numeric.length >= 2) {
    charts.push({
      type: 'donut',
      title: 'Key metrics mix',
      narrative: 'Share of the main numeric totals currently in scope.',
      unit: '',
      data: numeric,
    });
  } else if (totals.byStatus && typeof totals.byStatus === 'object') {
    const data = Object.entries(totals.byStatus).map(([label, value]) => ({ label, value: Number(value) || 0 }));
    if (data.length) {
      charts.push({
        type: 'donut',
        title: 'Status mix',
        narrative: 'Distribution by status from live app totals.',
        data,
      });
    }
  }

  const items = context?.hotItems || context?.items || [];
  if (Array.isArray(items) && items.length) {
    const scored = items
      .map((it, i) => ({
        label: String(it.title || it.name || it.label || `Item ${i + 1}`).slice(0, 18),
        value: Number(it.risk || it.score || it.count || it.daysOverdue || 1),
      }))
      .slice(0, 8);
    charts.push({
      type: 'hbar',
      title: 'Hotspots (relative pressure)',
      narrative: 'Highest-pressure items from the live hotspot list — read with the narrative sections.',
      data: scored,
    });
  }

  return charts;
}

export function normalizeCharts(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && Array.isArray(c.data) && c.data.length)
    .slice(0, 4)
    .map((c) => ({
      type: String(c.type || 'bar'),
      title: String(c.title || 'Chart'),
      narrative: String(c.narrative || ''),
      unit: c.unit != null ? String(c.unit) : '',
      data: c.data.slice(0, 12).map((d, i) => ({
        label: String(d.label || d.name || `#${i + 1}`),
        value: Number(d.value) || 0,
        color: d.color,
      })),
    }));
}
