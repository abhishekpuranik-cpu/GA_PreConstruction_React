import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ATTACHMENT_ACCEPT, formatFileSize } from './preconMedia.js';
import { getDepartmentForPhase } from './preconDepartments.js';
import {
  DRAWING_TYPES,
  archiveDrawing,
  listDrawings,
  restoreDrawing,
  updateDrawing,
  uploadDrawings,
} from './preconDrawings.js';
import './drawingsVault.css';

const STATUS_OPTIONS = ['For review', 'Approved', 'Changes requested', 'Rejected', 'Superseded'];
const PROJECT_PHASES = ['Phase I', 'Phase II', 'Phase III', 'Phase IV'];
const uid = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function projectFor(projects, id) {
  return (projects || []).find((p) => String(p.id) === String(id));
}

function DrawingCard({
  drawing,
  project,
  archived,
  onEdit,
  onArchive,
  onRestore,
  onNewVersion,
}) {
  const canRestore = archived && drawing.archivedAt && !drawing.supersededAt;
  return (
    <article className={`dv-card${archived ? ' dv-card-archived' : ''}`}>
      <div className="dv-card-icon" aria-hidden>⌑</div>
      <div className="dv-card-main">
        <div className="dv-card-title">
          {drawing.label || drawing.fileName}
          <span className="dv-version">V{drawing.version || 1}</span>
        </div>
        <div className="dv-card-path">
          {project?.name || drawing.projectId} <span>›</span>{' '}
          {drawing.projectPhase || drawing.phaseName || 'Project phase not set'} <span>›</span>{' '}
          {drawing.building || 'All buildings'} <span>›</span>{' '}
          {drawing.drawingType || 'Other'}
          {drawing.subDrawing ? <><span>›</span> {drawing.subDrawing}</> : null}
        </div>
        <div className="dv-card-meta">
          {drawing.revision ? <span>Rev {drawing.revision}</span> : null}
          <span className={`dv-status dv-status-${String(drawing.status || '').toLowerCase().replace(/\s+/g, '-')}`}>
            {drawing.status || 'For review'}
          </span>
          <span>{formatFileSize(drawing.size)}</span>
          <span>{drawing.uploadedBy || 'Team'}</span>
          <span>{drawing.uploadedAt ? new Date(drawing.uploadedAt).toLocaleDateString('en-IN') : ''}</span>
        </div>
        {drawing.approvalNote ? (
          <p className="dv-review-note">
            <strong>{drawing.approvalBy || 'Design Head'}:</strong> {drawing.approvalNote}
          </p>
        ) : null}
        {drawing.description ? <p className="dv-card-desc">{drawing.description}</p> : null}
      </div>
      <div className="dv-card-actions">
        <a className="dv-btn dv-btn-primary" href={drawing.url} target="_blank" rel="noopener noreferrer">
          View / download
        </a>
        {!archived ? (
          <>
            <button type="button" className="dv-btn" onClick={() => onNewVersion(drawing)}>+ New version</button>
            <button type="button" className="dv-btn" onClick={() => onEdit(drawing)}>Edit details</button>
            <button type="button" className="dv-btn dv-btn-danger" onClick={() => onArchive(drawing)}>Archive</button>
          </>
        ) : canRestore ? (
          <button type="button" className="dv-btn" onClick={() => onRestore(drawing)}>Restore</button>
        ) : (
          <span className="dv-past-version">Past version</span>
        )}
      </div>
    </article>
  );
}

export function DrawingsVault({
  projects,
  fixedProjectId = '',
  onOpenProject,
  toast,
  departments = [],
  dispatch,
  onPersist,
}) {
  const initialProject = fixedProjectId || '';
  const [drawings, setDrawings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showArchive, setShowArchive] = useState(false);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState(initialProject);
  const [phaseFilter, setPhaseFilter] = useState('');
  const [buildingFilter, setBuildingFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState([]);
  const [form, setForm] = useState({
    projectId: initialProject,
    projectPhase: '',
    building: '',
    drawingType: 'Architectural',
    subDrawing: '',
    revision: '',
    description: '',
    label: '',
    parentDrawingId: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setDrawings(await listDrawings(fixedProjectId, { archived: showArchive }));
    } catch (e) {
      setError(e?.message || 'Could not load drawings');
    } finally {
      setLoading(false);
    }
  }, [fixedProjectId, showArchive]);

  useEffect(() => {
    void load();
  }, [load]);

  const buildings = useMemo(
    () => [...new Set(drawings.map((d) => d.building).filter(Boolean))].sort(),
    [drawings],
  );
  const projectPhases = useMemo(
    () => [...new Set([...PROJECT_PHASES, ...drawings.map((d) => d.projectPhase).filter(Boolean)])],
    [drawings],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drawings.filter((d) => {
      if (projectFilter && d.projectId !== projectFilter) return false;
      if (phaseFilter && d.projectPhase !== phaseFilter) return false;
      if (buildingFilter && d.building !== buildingFilter) return false;
      if (typeFilter && d.drawingType !== typeFilter) return false;
      if (statusFilter && d.status !== statusFilter) return false;
      if (
        q &&
        ![
          d.label, d.fileName, d.description, d.revision, d.uploadedBy,
          d.projectPhase, d.building, d.drawingType, d.subDrawing,
          projectFor(projects, d.projectId)?.name,
        ].join(' ').toLowerCase().includes(q)
      ) return false;
      return true;
    });
  }, [drawings, search, projectFilter, phaseFilter, buildingFilter, typeFilter, statusFilter, projects]);

  const groups = useMemo(() => {
    const map = new Map();
    filtered.forEach((d) => {
      const key = [
        d.projectId,
        d.projectPhase || 'Project phase not set',
        d.building || 'All buildings',
        d.drawingType || 'Other',
        d.subDrawing || '',
      ].join('|');
      if (!map.has(key)) {
        map.set(key, {
          key,
          projectId: d.projectId,
          projectPhase: d.projectPhase || 'Project phase not set',
          building: d.building || 'All buildings',
          type: d.drawingType || 'Other',
          subDrawing: d.subDrawing || '',
          rows: [],
        });
      }
      map.get(key).rows.push(d);
    });
    return [...map.values()];
  }, [filtered]);

  const blankForm = (projectId) => ({
    projectId,
    projectPhase: '',
    building: '',
    drawingType: 'Architectural',
    subDrawing: '',
    revision: '',
    description: '',
    label: '',
    parentDrawingId: '',
  });

  const openUpload = () => {
    const pid = fixedProjectId || projectFilter || projects?.[0]?.id || '';
    setForm(blankForm(pid));
    setFiles([]);
    setEditing(null);
    setUploadOpen(true);
  };

  const startNewVersion = (d) => {
    setForm({
      projectId: d.projectId,
      projectPhase: d.projectPhase || '',
      building: d.building || '',
      drawingType: d.drawingType || 'Other',
      subDrawing: d.subDrawing || '',
      revision: '',
      description: d.description || '',
      label: d.label || d.fileName || '',
      parentDrawingId: d.id,
    });
    setFiles([]);
    setEditing(null);
    setUploadOpen(true);
  };

  const designReviewContext = (projectId) => {
    const project = projectFor(projects, projectId);
    const designDept = (departments || []).find((d) => d.id === 'dept_design');
    const designPhase = (project?.phases || []).find(
      (ph) => getDepartmentForPhase(ph.name, departments)?.id === 'dept_design'
    );
    return {
      project,
      head: String(designDept?.head || '').trim(),
      phaseId: designPhase?.id || `ph_design_${Date.now()}`,
    };
  };

  const createReviewTasks = async (uploaded) => {
    if (!uploaded?.length || !dispatch) return;
    const { head, phaseId } = designReviewContext(form.projectId);
    const tasks = uploaded.map((drawing) => ({
      id: uid('t_drawing_review'),
      name: `Review drawing: ${drawing.label || drawing.fileName} (V${drawing.version || 1})`,
      dur: 2,
      who: head,
      drawingReview: {
        drawingId: drawing.id,
        seriesId: drawing.seriesId,
        title: drawing.label || drawing.fileName,
        fileName: drawing.fileName,
        url: drawing.url,
        version: drawing.version || 1,
        projectPhase: drawing.projectPhase,
        building: drawing.building,
        drawingType: drawing.drawingType,
        subDrawing: drawing.subDrawing,
        status: 'For review',
      },
    }));
    await Promise.all(
      tasks.map((task, index) =>
        updateDrawing(uploaded[index].id, { reviewTaskId: task.id, reviewPhaseId: phaseId })
      )
    );
    dispatch({ type: 'addDrawingReviewTasks', projId: form.projectId, phId: phaseId, tasks });
    window.setTimeout(() => {
      void Promise.resolve(onPersist?.({ reason: 'drawing-review-task' })).catch(() => {});
    }, 120);
    if (!head) {
      toast?.('Drawing saved. Set a Design Department Head to assign its approval task.', 'err');
    }
  };

  const submitUpload = async () => {
    if (!form.projectId || !form.projectPhase.trim() || !form.drawingType || !files.length) {
      toast?.('Select the project phase, drawing type, and file(s)', 'err');
      return;
    }
    if (form.parentDrawingId && files.length !== 1) {
      toast?.('Upload one file for a new version', 'err');
      return;
    }
    setBusy(true);
    try {
      const result = await uploadDrawings(form, files);
      await createReviewTasks(result.attachments || []);
      toast?.(
        form.parentDrawingId
          ? `Version ${result.attachments?.[0]?.version || ''} uploaded for Design Head review`
          : `${files.length} drawing${files.length === 1 ? '' : 's'} uploaded and sent for review`,
        'ok'
      );
      setUploadOpen(false);
      setFiles([]);
      await load();
    } catch (e) {
      toast?.(e?.message || 'Drawing upload failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    setBusy(true);
    try {
      await updateDrawing(editing.id, {
        label: form.label,
        projectPhase: form.projectPhase,
        building: form.building,
        drawingType: form.drawingType,
        subDrawing: form.subDrawing,
        revision: form.revision,
        description: form.description,
      });
      setEditing(null);
      toast?.('Drawing details updated', 'ok');
      await load();
    } catch (e) {
      toast?.(e?.message || 'Update failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (d) => {
    setEditing(d);
    setUploadOpen(false);
    setForm({
      projectId: d.projectId,
      projectPhase: d.projectPhase || '',
      building: d.building || '',
      drawingType: d.drawingType || 'Other',
      subDrawing: d.subDrawing || '',
      revision: d.revision || '',
      description: d.description || '',
      label: d.label || d.fileName || '',
      parentDrawingId: '',
    });
  };

  const doArchive = async (d) => {
    if (!window.confirm(`Archive "${d.label || d.fileName}"?\n\nIt will remain available in Archive folders.`)) return;
    try {
      await archiveDrawing(d.id);
      toast?.('Drawing moved to Archive folders', 'ok');
      await load();
    } catch (e) {
      toast?.(e?.message || 'Archive failed', 'err');
    }
  };

  const doRestore = async (d) => {
    try {
      await restoreDrawing(d.id);
      toast?.('Drawing restored to active folders', 'ok');
      await load();
    } catch (e) {
      toast?.(e?.message || 'Restore failed', 'err');
    }
  };

  return (
    <section className="dv-shell">
      <header className="dv-hero">
        <div>
          <div className="dv-eyebrow">Golden Abodes · controlled drawing register</div>
          <h2>{fixedProjectId ? 'Project Drawings' : 'Drawings Vault'}</h2>
          <p>
            Project › Project Phase › Building › Drawing Type › Sub-Drawing, with automatic
            versions and Design Head approval.
          </p>
        </div>
        <div className="dv-hero-actions">
          <div className="dv-count"><strong>{filtered.length}</strong><span>{showArchive ? 'archived' : 'active'}</span></div>
          <button type="button" className={`dv-btn${showArchive ? ' dv-btn-primary' : ''}`} onClick={() => setShowArchive((v) => !v)}>
            {showArchive ? '← Active folders' : '▰ Archive folders'}
          </button>
          {!showArchive ? <button type="button" className="dv-btn dv-btn-primary" onClick={openUpload}>+ Add drawings</button> : null}
        </div>
      </header>

      <div className="dv-filters">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search drawing, sub-drawing, version…" />
        {!fixedProjectId ? (
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">All projects</option>
            {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : null}
        <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)}>
          <option value="">All project phases</option>
          {projectPhases.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={buildingFilter} onChange={(e) => setBuildingFilter(e.target.value)}>
          <option value="">All buildings</option>
          {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All drawing types</option>
          {DRAWING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All approval statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="button" className="dv-btn" onClick={() => {
          setSearch(''); setProjectFilter(initialProject); setPhaseFilter('');
          setBuildingFilter(''); setTypeFilter(''); setStatusFilter('');
        }}>Clear</button>
      </div>

      {(uploadOpen || editing) ? (
        <div className="dv-editor">
          <div className="dv-editor-head">
            <div>
              <strong>{editing ? 'Edit drawing details' : form.parentDrawingId ? 'Upload new version' : 'Add drawings'}</strong>
              <span>
                {form.parentDrawingId
                  ? 'The current version moves automatically to Archive folders'
                  : 'A Design Head approval task is created after upload'}
              </span>
            </div>
            <button type="button" className="dv-close" onClick={() => { setUploadOpen(false); setEditing(null); }}>×</button>
          </div>
          <div className="dv-form-grid">
            {!fixedProjectId ? (
              <label>Project<select disabled={!!editing || !!form.parentDrawingId} value={form.projectId} onChange={(e) => setForm((x) => ({ ...x, projectId: e.target.value }))}>
                <option value="">Select project</option>
                {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
            ) : null}
            <label>Project phase
              <input list="dv-project-phases" value={form.projectPhase} onChange={(e) => setForm((x) => ({ ...x, projectPhase: e.target.value }))} placeholder="e.g. Phase I" />
              <datalist id="dv-project-phases">{PROJECT_PHASES.map((p) => <option key={p} value={p} />)}</datalist>
            </label>
            <label>Building / tower<input value={form.building} onChange={(e) => setForm((x) => ({ ...x, building: e.target.value }))} placeholder="e.g. Tower A / Clubhouse" /></label>
            <label>Drawing type<select value={form.drawingType} onChange={(e) => setForm((x) => ({ ...x, drawingType: e.target.value }))}>
              {DRAWING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select></label>
            <label>Sub-Drawing<input value={form.subDrawing} onChange={(e) => setForm((x) => ({ ...x, subDrawing: e.target.value }))} placeholder="Add sub-drawing (optional)" /></label>
            <label>Revision reference<input value={form.revision} onChange={(e) => setForm((x) => ({ ...x, revision: e.target.value }))} placeholder="Optional consultant revision" /></label>
            <label className="dv-span-2">Drawing title {editing ? '' : '(file name used by default)'}<input value={form.label} onChange={(e) => setForm((x) => ({ ...x, label: e.target.value }))} /></label>
            <label className="dv-span-2">Description<textarea value={form.description} onChange={(e) => setForm((x) => ({ ...x, description: e.target.value }))} rows={2} /></label>
            {!editing ? (
              <label className="dv-span-2 dv-file">File{form.parentDrawingId ? '' : 's'}
                <input type="file" multiple={!form.parentDrawingId} accept={ATTACHMENT_ACCEPT} onChange={(e) => setFiles([...e.target.files])} />
                <span>{files.length ? `${files.length} selected` : 'PDF, image, Office, DWG, DXF or DWF'}</span>
              </label>
            ) : null}
          </div>
          <div className="dv-editor-actions">
            <button type="button" className="dv-btn" onClick={() => { setUploadOpen(false); setEditing(null); }}>Cancel</button>
            <button type="button" className="dv-btn dv-btn-primary" disabled={busy} onClick={editing ? submitEdit : submitUpload}>
              {busy ? 'Saving…' : editing ? 'Save details' : form.parentDrawingId ? 'Upload next version' : 'Upload & create review task'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="dv-state dv-error">{error}</div> : null}
      {loading ? <div className="dv-state">Loading drawing register…</div> : null}
      {!loading && !error && !groups.length ? (
        <div className="dv-empty">
          <div className="dv-empty-icon">{showArchive ? '▰' : '⌑'}</div>
          <h3>{showArchive ? 'Archive folders are empty' : 'No drawings in this view'}</h3>
          <p>{showArchive ? 'Past and manually archived drawings will appear here.' : 'Add the first controlled drawing.'}</p>
          {!showArchive ? <button type="button" className="dv-btn dv-btn-primary" onClick={openUpload}>Add drawings</button> : null}
        </div>
      ) : null}

      <div className="dv-tree">
        {groups.map((group) => {
          const p = projectFor(projects, group.projectId);
          return (
            <details key={group.key} className="dv-group" open>
              <summary>
                <span className="dv-folder">▰</span>
                <span className="dv-group-path">
                  {!fixedProjectId ? <button type="button" onClick={(e) => { e.preventDefault(); onOpenProject?.(group.projectId, 'drawings'); }}>{p?.name || group.projectId}</button> : null}
                  <strong>{group.projectPhase}</strong><span>›</span>
                  <strong>{group.building}</strong><span>›</span><strong>{group.type}</strong>
                  {group.subDrawing ? <><span>›</span><strong>{group.subDrawing}</strong></> : null}
                </span>
                <span className="dv-group-count">{group.rows.length}</span>
              </summary>
              <div className="dv-group-body">
                {group.rows.map((drawing) => (
                  <DrawingCard
                    key={drawing.id}
                    drawing={drawing}
                    project={p}
                    archived={showArchive}
                    onEdit={startEdit}
                    onArchive={doArchive}
                    onRestore={doRestore}
                    onNewVersion={startNewVersion}
                  />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
