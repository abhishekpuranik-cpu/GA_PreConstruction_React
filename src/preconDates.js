/** Date engine extracted for export + status (mirrors App.jsx cDates). */

const aD = (d, n) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

const iso = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

export function cDates(proj) {
  const all = [];
  (proj.phases || []).forEach((ph) => (ph.tasks || []).forEach((t) => all.push(t)));
  const map = {};
  const ko = new Date(proj.ko);
  for (const t of all) {
    let s;
    if (t.ms) s = new Date(t.ms);
    else if (t.offsetFromKo != null && t.offsetFromKo !== '' && !Number.isNaN(Number(t.offsetFromKo))) {
      s = aD(ko, Number(t.offsetFromKo));
    } else if (t.par && map[t.par]) s = new Date(map[t.par].s);
    else if (t.pred?.length) {
      let mx = new Date(ko);
      t.pred.forEach((p) => {
        if (map[p]) {
          const e = new Date(map[p].e);
          if (e > mx) mx = e;
        }
      });
      s = aD(mx, 1);
    } else s = new Date(ko);
    map[t.id] = { s: iso(s), e: iso(aD(s, Math.max(t.dur - 1, 0))) };
  }
  return map;
}

export function dbDays(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 864e5);
}
