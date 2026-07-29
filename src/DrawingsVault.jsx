import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ATTACHMENT_ACCEPT, formatFileSize } from './preconMedia.js';
import {
  DRAWING_TYPES,
  archiveDrawing,
  listDrawings,
  updateDrawing,
  uploadDrawings,
} from './preconDrawings.js';
import './drawingsVault.css';

const STATUS_OPTIONS = ['For review', 'Approved', 'Issued for construction', 'Superseded', 'As-built'];

function projectFor(projects, id) {
  return (projects || []).find((p) => String(p.id) === String(id));
}

function DrawingCard({ drawing, project, onEdit, onArchive }) {
  return (
    <article className="dv-card">
      <div className="dv-card-icon" aria-hidden>⌑</div>
      <div className="dv-card-main">
        <div className="dv-card-title">{drawing.label || drawing.fileName}</div>
        <div className="dv-card-path">
          {project?.name || drawing.projectId} <span>›</span> {drawing.phaseName || 'General'} <span>›</span>{' '}
          {drawing.building || 'All buildings'} <span>›</span> {drawing.drawingType || 'Other'}
        </div>
        <div className="dv-card-meta">
          {drawing.revision ? <span>Rev {drawing.revision}</span> : null}
          {drawing.status ? <span className="dv-status">{drawing.status}</span> : null}
          <span>{formatFileSize(drawing.size)}</span>
          <span>{drawing.uploadedBy || 'Team'}</span>
          <span>{drawing.uploadedAt ? new Date(drawing.uploadedAt).toLocaleDateString('en-IN') : ''}</span>
        </div>
        {drawing.description ? <p className="dv-card-desc">{drawing.description}</p> : null}
      </div>
      <div className="dv-card-actions">
        <a className="dv-btn dv-btn-primary" href={drawing.url} target="_blank" rel="noopener noreferrer">
          View / download
        </a>
        <button type="button" className="dv-btn" onClick={() => onEdit(drawing)}>Edit</button>
        <button type="button" className="dv-btn dv-btn-danger" onClick={() => onArchive(drawing)}>Archive</button>
      </div>
    </article>
  );
}

export function DrawingsVault({ projects, fixedProjectId = '', onOpenProject, toast }) {
  const initialProject = fixedProjectId || '';
  const [drawings, setDrawings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
    phaseId: '',
    phaseName: '',
    building: '',
    drawingType: 'Architectural',
    revision: '',
    status: 'For review',
    description: '',
    label: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setDrawings(await listDrawings(fixedProjectId));
    } catch (e) {
      setError(e?.message || 'Could not load drawings');
    } finally {
      setLoading(false);
    }
  }, [fixedProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedProject = projectFor(projects, form.projectId);
  const phaseOptions = selectedProject?.phases || [];
  const buildings = useMemo(
    () => [...new Set(drawings.map((d) => d.building).filter(Boolean))].sort(),
    [drawings],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drawings.filter((d) => {
      if (projectFilter && d.projectId !== projectFilter) return false;
      if (phaseFilter && d.phaseId !== phaseFilter && d.phaseName !== phaseFilter) return false;
      if (buildingFilter && d.building !== buildingFilter) return false;
      if (typeFilter && d.drawingType !== typeFilter) return false;
      if (statusFilter && d.status !== statusFilter) return false;
      if (
        q &&
        ![
          d.label,
          d.fileName,
          d.description,
          d.revision,
          d.uploadedBy,
          projectFor(projects, d.projectId)?.name,
        ]
          .join(' ')
          .toLowerCase()
          .includes(q)
      ) return false;
      return true;
    });
  }, [drawings, search, projectFilter, phaseFilter, buildingFilter, typeFilter, statusFilter, projects]);

  const groups = useMemo(() => {
    const map = new Map();
    filtered.forEach((d) => {
      const key = [d.projectId, d.phaseName || 'General', d.building || 'All buildings', d.drawingType || 'Other'].join('|');
      if (!map.has(key)) {
        map.set(key, {
          key,
          projectId: d.projectId,
          phase: d.phaseName || 'General',
          building: d.building || 'All buildings',
          type: d.drawingType || 'Other',
          rows: [],
        });
      }
      map.get(key).rows.push(d);
    });
    return [...map.values()];
  }, [filtered]);

  const openUpload = () => {
    const pid = fixedProjectId || projectFilter || projects?.[0]?.id || '';
    const p = projectFor(projects, pid);
    const phase = p?.phases?.[0];
    setForm({
      projectId: pid,
      phaseId: phase?.id || '',
      phaseName: phase?.name || '',
      building: '',
      drawingType: 'Architectural',
      revision: '',
      status: 'For review',
      description: '',
      label: '',
    });
    setFiles([]);
    setEditing(null);
    setUploadOpen(true);
  };

  const changeProject = (projectId) => {
    const p = projectFor(projects, projectId);
    const phase = p?.phases?.[0];
    setForm((old) => ({
      ...old,
      projectId,
      phaseId: phase?.id || '',
      phaseName: phase?.name || '',
    }));
  };

  const changePhase = (phaseId) => {
    const phase = phaseOptions.find((p) => p.id === phaseId);
    setForm((old) => ({ ...old, phaseId, phaseName: phase?.name || '' }));
  };

  const submitUpload = async () => {
    if (!form.projectId || !form.drawingType || !files.length) {
      toast?.('Select a project, drawing type, and file(s)', 'err');
      return;
    }
    setBusy(true);
    try {
      await uploadDrawings(form, files);
      toast?.(`${files.length} drawing${files.length === 1 ? '' : 's'} added to the vault`, 'ok');
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
        phaseId: form.phaseId,
        phaseName: form.phaseName,
        building: form.building,
        drawingType: form.drawingType,
        revision: form.revision,
        status: form.status,
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
      phaseId: d.phaseId || '',
      phaseName: d.phaseName || '',
      building: d.building || '',
      drawingType: d.drawingType || 'Other',
      revision: d.revision || '',
      status: d.status || 'For review',
      description: d.description || '',
      label: d.label || d.fileName || '',
    });
  };

  const doArchive = async (d) => {
    if (!window.confirm(`Archive "${d.label || d.fileName}"?\n\nThe file is retained and removed from active views.`)) return;
    try {
      await archiveDrawing(d.id);
      toast?.('Drawing archived', 'ok');
      await load();
    } catch (e) {
      toast?.(e?.message || 'Archive failed', 'err');
    }
  };

  return (
    <section className="dv-shell">
      <header className="dv-hero">
        <div>
          <div className="dv-eyebrow">Golden Abodes · controlled drawing register</div>
          <h2>{fixedProjectId ? 'Project Drawings' : 'Drawings Vault'}</h2>
          <p>
            One shared library organised by Project › Phase › Building › Drawing type.
            Files are stored centrally and visible to authorised project users.
          </p>
        </div>
        <div className="dv-hero-actions">
          <div className="dv-count"><strong>{filtered.length}</strong><span>drawings</span></div>
          <button type="button" className="dv-btn dv-btn-primary" onClick={openUpload}>+ Add drawings</button>
        </div>
      </header>

      <div className="dv-filters">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search drawing, revision, uploader…" />
        {!fixedProjectId ? (
          <select value={projectFilter} onChange={(e) => { setProjectFilter(e.target.value); setPhaseFilter(''); }}>
            <option value="">All projects</option>
            {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : null}
        <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)}>
          <option value="">All phases</option>
          {(projectFor(projects, projectFilter || fixedProjectId)?.phases || []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
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
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="button" className="dv-btn" onClick={() => {
          setSearch(''); setProjectFilter(initialProject); setPhaseFilter(''); setBuildingFilter(''); setTypeFilter(''); setStatusFilter('');
        }}>Clear</button>
      </div>

      {(uploadOpen || editing) ? (
        <div className="dv-editor">
          <div className="dv-editor-head">
            <div><strong>{editing ? 'Edit drawing details' : 'Add drawings'}</strong><span>{editing ? 'Update its position in the drawing tree' : 'Files share the same selected tree location'}</span></div>
            <button type="button" className="dv-close" onClick={() => { setUploadOpen(false); setEditing(null); }}>×</button>
          </div>
          <div className="dv-form-grid">
            <label>Project<select disabled={!!fixedProjectId || !!editing} value={form.projectId} onChange={(e) => changeProject(e.target.value)}>
              <option value="">Select project</option>
              {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
            <label>Phase<select value={form.phaseId} onChange={(e) => changePhase(e.target.value)}>
              <option value="">General / no phase</option>
              {phaseOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
            <label>Building / tower<input value={form.building} onChange={(e) => setForm((x) => ({ ...x, building: e.target.value }))} placeholder="e.g. Tower A / Clubhouse" /></label>
            <label>Drawing type<select value={form.drawingType} onChange={(e) => setForm((x) => ({ ...x, drawingType: e.target.value }))}>
              {DRAWING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select></label>
            <label>Revision<input value={form.revision} onChange={(e) => setForm((x) => ({ ...x, revision: e.target.value }))} placeholder="e.g. R2" /></label>
            <label>Status<select value={form.status} onChange={(e) => setForm((x) => ({ ...x, status: e.target.value }))}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select></label>
            <label className="dv-span-2">Drawing title {editing ? '' : '(optional; file name used by default)'}<input value={form.label} onChange={(e) => setForm((x) => ({ ...x, label: e.target.value }))} /></label>
            <label className="dv-span-2">Description<textarea value={form.description} onChange={(e) => setForm((x) => ({ ...x, description: e.target.value }))} rows={2} /></label>
            {!editing ? <label className="dv-span-2 dv-file">Files<input type="file" multiple accept={ATTACHMENT_ACCEPT} onChange={(e) => setFiles([...e.target.files])} /><span>{files.length ? `${files.length} selected` : 'PDF, image, Office, DWG, DXF or DWF'}</span></label> : null}
          </div>
          <div className="dv-editor-actions">
            <button type="button" className="dv-btn" onClick={() => { setUploadOpen(false); setEditing(null); }}>Cancel</button>
            <button type="button" className="dv-btn dv-btn-primary" disabled={busy} onClick={editing ? submitEdit : submitUpload}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Upload to vault'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="dv-state dv-error">{error}</div> : null}
      {loading ? <div className="dv-state">Loading drawing register…</div> : null}
      {!loading && !error && !groups.length ? (
        <div className="dv-empty">
          <div className="dv-empty-icon">⌑</div>
          <h3>No drawings in this view</h3>
          <p>Add the first drawing or clear filters. Existing project and task data is unaffected.</p>
          <button type="button" className="dv-btn dv-btn-primary" onClick={openUpload}>Add drawings</button>
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
                  <strong>{group.phase}</strong><span>›</span><strong>{group.building}</strong><span>›</span><strong>{group.type}</strong>
                </span>
                <span className="dv-group-count">{group.rows.length}</span>
              </summary>
              <div className="dv-group-body">
                {group.rows.map((drawing) => (
                  <DrawingCard key={drawing.id} drawing={drawing} project={p} onEdit={startEdit} onArchive={doArchive} />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
