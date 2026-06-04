import * as XLSX from 'xlsx';
import { ensureTaskStatus } from './preconTaskStatus.js';

const PCOL = ['#1A304A', '#2A6E7A', '#5A3020', '#1A5A30', '#6A3020', '#3A4A6A', '#4A3020'];

function normKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

function pick(row, aliases) {
  for (const a of aliases) {
    for (const [k, v] of Object.entries(row)) {
      if (normKey(k) === normKey(a) && v !== '' && v != null) return v;
    }
  }
  return '';
}

function newTaskId() {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function newPhaseId() {
  return `ph_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function newProjectId() {
  return `prj_${Date.now()}`;
}

function mkTask(name, dur = 7, extra = {}) {
  return {
    id: extra.id || newTaskId(),
    name: String(name || 'New task').trim() || 'New task',
    dur: Math.max(1, Number(extra.dur) || Number(dur) || 7),
    pred: Array.isArray(extra.pred) ? extra.pred : [],
    par: extra.par || null,
    who: String(extra.who || '').trim(),
    ms: extra.ms || '',
    as: extra.as || '',
    ae: extra.ae || '',
    status: extra.status || 'notstarted',
    comments: Array.isArray(extra.comments) ? extra.comments : [],
    paused: !!extra.paused
  };
}

function findSheetRows(wb) {
  const prefer = ['Data dump', 'Raw fields', 'Updated report', 'Tasks', 'Sheet1'];
  const names = [...prefer, ...wb.SheetNames.filter((n) => !prefer.includes(n))];
  for (const name of names) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) continue;
    const keys = Object.keys(rows[0] || {}).map(normKey);
    const hasTask = keys.some((k) => ['task', 'task_id', 'activity', 'task_name', 'description'].includes(k));
    const hasProject = keys.some((k) => ['project', 'project_name'].includes(k));
    if (hasTask || (hasProject && rows.length > 1)) return { rows, sheetName: name };
  }
  const first = wb.SheetNames[0];
  if (first && wb.Sheets[first]) {
    return { rows: XLSX.utils.sheet_to_json(wb.Sheets[first], { defval: '' }), sheetName: first };
  }
  return { rows: [], sheetName: '' };
}

function rowToTaskPatch(row) {
  const name = pick(row, ['Task', 'Activity', 'Task Name', 'Description']);
  if (!name) return null;
  const tid = pick(row, ['Task ID', 'Id', 'ID']);
  const dur = Number(pick(row, ['Duration_days', 'Duration', 'Days'])) || 7;
  const who = pick(row, ['Assignee', 'Owner', 'Who', 'Responsible']);
  const ms = pick(row, ['Manual start', 'Start', 'Target Date', 'Target', 'Due Date', 'Planned start']);
  const as = pick(row, ['Actual start']);
  const ae = pick(row, ['Actual end']);
  const stored = pick(row, ['Stored status', 'Status code', 'Status']);
  const commentsRaw = pick(row, ['Comments_JSON', 'Comments']);
  let comments = [];
  if (commentsRaw) {
    try {
      const parsed = JSON.parse(commentsRaw);
      if (Array.isArray(parsed)) comments = parsed;
    } catch {
      comments = [{ author: 'Import', ts: new Date().toISOString().slice(0, 10), text: String(commentsRaw) }];
    }
  }
  const t = mkTask(name, dur, { id: tid || undefined, who, ms, as, ae, comments });
  if (stored) {
    const s = String(stored).toLowerCase().replace(/\s+/g, '');
    if (s.includes('complete')) t.status = 'completed';
    else if (s.includes('progress')) t.status = 'inprogress';
    else if (s.includes('pause')) t.status = 'paused';
    else if (s.includes('overdue')) t.status = 'inprogress';
    else t.status = ensureTaskStatus(t);
  } else {
    t.status = ensureTaskStatus(t);
  }
  return t;
}

function mergeTask(existing, incoming) {
  ['who', 'ms', 'as', 'ae', 'dur', 'status'].forEach((k) => {
    const v = incoming[k];
    if (v === undefined || v === null) return;
    if (k === 'dur') {
      existing[k] = Math.max(1, Number(v) || existing[k] || 7);
      return;
    }
    if (k !== 'dur' && v === '') return;
    existing[k] = v;
  });
  if (incoming.name && incoming.id && existing.id === incoming.id) {
    existing.name = incoming.name;
  }
  if (incoming.comments?.length) existing.comments = incoming.comments;
}

/**
 * Merge Excel rows into existing app state (updates tasks, adds missing tasks/phases/projects).
 * @param {object} [opts]
 * @param {string} [opts.scopeProjectId] — when set, only rows for this project (by name) are applied
 * @param {string} [opts.scopeProjectName] — display name for scope (required with scopeProjectId)
 * @returns {{ state: object, summary: object }}
 */
export function importExcelIntoState(currentState, arrayBuffer, opts = {}) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const { rows, sheetName } = findSheetRows(wb);
  if (!rows.length) throw new Error('No task rows found in the spreadsheet');

  const state = JSON.parse(JSON.stringify(currentState || { cloudUrl: '', projects: [] }));
  if (!Array.isArray(state.projects)) state.projects = [];

  const scopeId = opts.scopeProjectId ? String(opts.scopeProjectId) : '';
  const scopeProj = scopeId ? (state.projects || []).find((p) => p.id === scopeId) : null;
  const scopeName = scopeProj
    ? String(scopeProj.name).trim()
    : opts.scopeProjectName
      ? String(opts.scopeProjectName).trim()
      : '';
  const scopeKey = scopeName.toLowerCase();

  let tasksUpdated = 0;
  let tasksAdded = 0;
  let rowsSkipped = 0;

  const byProject = new Map();
  rows.forEach((row) => {
    let projName = String(pick(row, ['Project', 'Project Name']) || '').trim();
    if (scopeKey) {
      if (!projName) projName = scopeName;
      else if (projName.toLowerCase() !== scopeKey) {
        rowsSkipped++;
        return;
      }
    } else if (!projName) projName = 'Imported project';

    const phaseName = String(pick(row, ['Phase']) || 'Imported').trim();
    const task = rowToTaskPatch(row);
    if (!task) return;
    if (!byProject.has(projName)) byProject.set(projName, new Map());
    const phases = byProject.get(projName);
    if (!phases.has(phaseName)) phases.set(phaseName, []);
    phases.get(phaseName).push(task);
  });

  if (scopeKey && !byProject.size) {
    throw new Error(
      `No rows matched project "${scopeName}". Keep the Project column as "${scopeName}" in Excel, or import from the dashboard.`
    );
  }

  byProject.forEach((phaseMap, projName) => {
    let proj = state.projects.find((p) => String(p.name).trim().toLowerCase() === projName.toLowerCase());
    if (!proj) {
      proj = {
        id: newProjectId(),
        name: projName,
        loc: '—',
        type: 'Commercial',
        floors: 10,
        status: 'Pre-Construction',
        ko: new Date().toISOString().slice(0, 10),
        col: PCOL[state.projects.length % PCOL.length],
        phases: []
      };
      state.projects.push(proj);
    }
    if (!Array.isArray(proj.phases)) proj.phases = [];

    phaseMap.forEach((tasks, phaseName) => {
      let ph = proj.phases.find((x) => String(x.name).trim().toLowerCase() === phaseName.toLowerCase());
      if (!ph) {
        ph = { id: newPhaseId(), name: phaseName, col: PCOL[proj.phases.length % PCOL.length], open: true, tasks: [] };
        proj.phases.push(ph);
      }
      if (!Array.isArray(ph.tasks)) ph.tasks = [];

      tasks.forEach((incoming) => {
        const existing = ph.tasks.find((t) => t.id && incoming.id && t.id === incoming.id)
          || ph.tasks.find((t) => String(t.name).trim().toLowerCase() === incoming.name.toLowerCase());
        if (existing) {
          mergeTask(existing, incoming);
          tasksUpdated++;
        } else {
          ph.tasks.push(incoming);
          tasksAdded++;
        }
      });
    });
  });

  return {
    state,
    summary: {
      projects: byProject.size,
      tasksUpdated,
      tasksAdded,
      rowsSkipped,
      sheet: sheetName,
      scopeProject: scopeName || null
    }
  };
}

export function parseJsonState(text) {
  const d = JSON.parse(text);
  if (!d || typeof d !== 'object') throw new Error('Invalid JSON');
  if (!Array.isArray(d.projects)) throw new Error('JSON must include a projects array');
  return d;
}
