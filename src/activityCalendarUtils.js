const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtYmd(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function todayYmd() {
  return fmtYmd(new Date());
}

export function parseYmd(ymd) {
  if (!ymd) return null;
  const d = new Date(`${ymd}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function calendarTitle(view, cursorDate) {
  const d = new Date(cursorDate);
  if (view === 'day') {
    return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  if (view === 'week') {
    const ws = new Date(d);
    ws.setDate(d.getDate() - d.getDay());
    const we = new Date(ws);
    we.setDate(ws.getDate() + 6);
    return `${ws.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} – ${we.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  if (view === 'year') return String(d.getFullYear());
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function shiftCursor(view, cursorDate, direction) {
  const d = new Date(cursorDate);
  if (view === 'day') d.setDate(d.getDate() + direction);
  else if (view === 'week') d.setDate(d.getDate() + direction * 7);
  else if (view === 'year') d.setFullYear(d.getFullYear() + direction);
  else d.setMonth(d.getMonth() + direction);
  return d;
}

export function buildMonthCells(cursorDate) {
  const d = new Date(cursorDate);
  const y = d.getFullYear();
  const m = d.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const cell = new Date(start);
    cell.setDate(start.getDate() + i);
    cells.push({
      date: cell,
      ymd: fmtYmd(cell),
      inMonth: cell.getMonth() === m,
    });
  }
  return cells;
}

export function weekCellDates(cursorDate) {
  const d = new Date(cursorDate);
  const ws = new Date(d);
  ws.setDate(d.getDate() - d.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(ws);
    date.setDate(ws.getDate() + i);
    return { date, ymd: fmtYmd(date), dow: DOW[i] };
  });
}

/** @param {string|string[]|null} ymd — one date or multiple per task (next action + due). */
export function indexTasksByYmd(tasks, getYmd) {
  const map = new Map();
  for (const task of tasks) {
    const raw = getYmd(task);
    const ymds = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const unique = [...new Set(ymds.map((y) => String(y || '').trim()).filter(Boolean))];
    for (const ymd of unique) {
      if (!map.has(ymd)) map.set(ymd, []);
      const list = map.get(ymd);
      if (!list.includes(task)) list.push(task);
    }
  }
  return map;
}

export { DOW, MONTHS };
