import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ATTACHMENT_ACCEPT, formatFileSize } from './preconMedia.js';
import { getDepartmentForPhase } from './preconDepartments.js';
import {
  DRAWING_SCOPE_TYPES,
  addDrawingCatalogItem,
  archiveDrawing,
  deleteDrawingCatalogItem,
  fetchDrawingVault,
  getCachedDrawingVault,
  invalidateDrawingVaultCache,
  restoreDrawing,
  saveDrawingPlan,
  updateDrawing,
  updateDrawingCatalogItem,
  uploadDrawings,
} from './preconDrawings.js';
import './drawingsVault.css';

const PROJECT_PHASES = ['Phase I', 'Phase II', 'Phase III', 'Phase IV'];
const uid = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function projectFor(projects, id) {
  return (projects || []).find((p) => String(p.id) === String(id));
}

function minDate(values) {
  return values.filter(Boolean).sort()[0] || '';
}

function maxDate(values) {
  return values.filter(Boolean).sort().at(-1) || '';
}

function dateLabel(value) {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function scopeFields(scopeType, scopeValue, project) {
  const value = String(scopeValue || '').trim();
  if (scopeType === 'phase') {
    return {
      projectPhase: value,
      building: '',
      commonAmenity: '',
      scopeKey: `phase:${value}`,
      scopeLabel: value || 'Phase',
    };
  }
  if (scopeType === 'building') {
    return {
      projectPhase: '',
      building: value,
      commonAmenity: '',
      scopeKey: `building:${value}`,
      scopeLabel: value || 'Building',
    };
  }
  if (scopeType === 'amenity') {
    return {
      projectPhase: '',
      building: '',
      commonAmenity: value,
      scopeKey: `amenity:${value}`,
      scopeLabel: value || 'Common Amenities',
    };
  }
  return {
    projectPhase: '',
    building: '',
    commonAmenity: '',
    scopeKey: 'project',
    scopeLabel: project?.name || 'Project level',
  };
}

function FileRow({ drawing, archived, onNewVersion, onArchive, onRestore }) {
  const canRestore = archived && drawing.archivedAt && !drawing.supersededAt;
  return (
    <div className="dvt-file">
      <span className="dvt-file-icon" aria-hidden>⌑</span>
      <div className="dvt-file-main">
        <strong>{drawing.label || drawing.fileName}</strong>
        <span>
          V{drawing.version || 1} · {drawing.scopeLabel || 'Project level'} ·{' '}
          {formatFileSize(drawing.size)} · {drawing.uploadedBy || 'Team'}
        </span>
      </div>
      <span className={`dvt-status dvt-status-${String(drawing.status || 'for-review').toLowerCase().replace(/\s+/g, '-')}`}>
        {drawing.status || 'For review'}
      </span>
      <a className="dvt-link" href={drawing.url} target="_blank" rel="noopener noreferrer">View</a>
      {!archived ? (
        <>
          <button type="button" className="dvt-link" onClick={() => onNewVersion(drawing)}>New version</button>
          <button type="button" className="dvt-link dvt-link-danger" onClick={() => onArchive(drawing)}>Archive</button>
        </>
      ) : canRestore ? (
        <button type="button" className="dvt-link" onClick={() => onRestore(drawing)}>Restore</button>
      ) : (
        <span className="dvt-past">Past version</span>
      )}
    </div>
  );
}

export function DrawingsVault({
  projects,
  fixedProjectId = '',
  toast,
  departments = [],
  dispatch,
  onPersist,
  embedded = false,
}) {
  const initialCache = getCachedDrawingVault(fixedProjectId || '', { archived: false });
  const [catalog, setCatalog] = useState(initialCache?.items || []);
  const [canManage, setCanManage] = useState(!!initialCache?.canManage);
  const [drawings, setDrawings] = useState(initialCache?.drawings || []);
  const [plans, setPlans] = useState(initialCache?.plans || []);
  const [loading, setLoading] = useState(!initialCache);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState(fixedProjectId || '');
  const [showArchive, setShowArchive] = useState(false);
  const [catalogEditor, setCatalogEditor] = useState(null);
  const [uploadItem, setUploadItem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [files, setFiles] = useState([]);
  const scrollBeforeUpload = useRef(0);
  const [uploadForm, setUploadForm] = useState({
    projectId: fixedProjectId || '',
    scopeType: 'project',
    scopeValue: '',
    startDate: '',
    endDate: '',
    revision: '',
    description: '',
    parentDrawingId: '',
  });

  const selectedProjectId = fixedProjectId || projectFilter;
  const selectedProject = projectFor(projects, selectedProjectId);

  const load = useCallback(async ({ silent = false, signal } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const result = await fetchDrawingVault(selectedProjectId, {
        archived: showArchive,
        signal,
      });
      setCatalog(result.items || []);
      setCanManage(!!result.canManage);
      setDrawings(result.drawings || []);
      setPlans(result.plans || []);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      setError(e?.message || 'Could not load the drawing tree');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [selectedProjectId, showArchive]);

  useEffect(() => {
    const controller = new AbortController();
    const cached = getCachedDrawingVault(selectedProjectId, { archived: showArchive });
    if (cached) {
      setCatalog(cached.items || []);
      setCanManage(!!cached.canManage);
      setDrawings(cached.drawings || []);
      setPlans(cached.plans || []);
      setLoading(false);
    }
    void load({ silent: !!cached, signal: controller.signal });
    return () => controller.abort();
  }, [load, selectedProjectId, showArchive]);

  const visibleCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((item) =>
      `${item.stage} ${item.source} ${item.drawingName}`.toLowerCase().includes(q)
    );
  }, [catalog, search]);

  const tree = useMemo(() => {
    const stages = new Map();
    visibleCatalog.forEach((item) => {
      if (!stages.has(item.stage)) {
        stages.set(item.stage, {
          name: item.stage,
          order: item.stageOrder,
          sources: new Map(),
          itemIds: [],
        });
      }
      const stage = stages.get(item.stage);
      stage.itemIds.push(item.id);
      if (!stage.sources.has(item.source)) {
        stage.sources.set(item.source, {
          name: item.source,
          order: item.sourceOrder,
          items: [],
        });
      }
      stage.sources.get(item.source).items.push(item);
    });
    return [...stages.values()]
      .sort((a, b) => a.order - b.order)
      .map((stage) => ({
        ...stage,
        sources: [...stage.sources.values()]
          .sort((a, b) => a.order - b.order)
          .map((source) => ({
            ...source,
            items: source.items.sort((a, b) => a.drawingOrder - b.drawingOrder),
          })),
      }));
  }, [visibleCatalog]);

  const plansByItem = useMemo(() => {
    const map = new Map();
    plans.forEach((plan) => {
      if (!map.has(plan.catalogItemId)) map.set(plan.catalogItemId, []);
      map.get(plan.catalogItemId).push(plan);
    });
    return map;
  }, [plans]);

  const drawingsByItem = useMemo(() => {
    const map = new Map();
    drawings.forEach((drawing) => {
      const id = drawing.catalogItemId || '';
      if (!id) return;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(drawing);
    });
    return map;
  }, [drawings]);

  const legacyDrawings = useMemo(
    () => drawings.filter((drawing) => !drawing.catalogItemId),
    [drawings]
  );

  const stageDates = (itemIds) => {
    const rows = itemIds.flatMap((id) => plansByItem.get(id) || []);
    return {
      start: minDate(rows.map((row) => row.startDate)),
      end: maxDate(rows.map((row) => row.endDate)),
    };
  };

  const openCatalogEditor = (item = null, defaults = {}) => {
    setCatalogEditor({
      id: item?.id || '',
      stage: item?.stage || defaults.stage || '',
      source: item?.source || defaults.source || '',
      drawingName: item?.drawingName || '',
      stageOrder: item?.stageOrder || defaults.stageOrder || tree.length + 1,
      sourceOrder: item?.sourceOrder || defaults.sourceOrder || 1,
      drawingOrder: item?.drawingOrder || defaults.drawingOrder || 1,
    });
  };

  const saveCatalog = async () => {
    setBusy(true);
    try {
      if (catalogEditor.id) {
        await updateDrawingCatalogItem(catalogEditor.id, catalogEditor);
        toast?.('Drawing list updated', 'ok');
      } else {
        await addDrawingCatalogItem(catalogEditor);
        toast?.('Drawing added to the curated list', 'ok');
      }
      setCatalogEditor(null);
      await load({ silent: true });
    } catch (e) {
      toast?.(e?.message || 'Could not save drawing list', 'err');
    } finally {
      setBusy(false);
    }
  };

  const deleteCatalog = async (item) => {
    if (!window.confirm(`Delete "${item.drawingName}" from the drawing list?\n\nUploaded files remain preserved.`)) return;
    try {
      await deleteDrawingCatalogItem(item.id);
      toast?.('Drawing removed from the curated list', 'ok');
      await load({ silent: true });
    } catch (e) {
      toast?.(e?.message || 'Could not delete drawing', 'err');
    }
  };

  const openUpload = (item, parentDrawing = null) => {
    const projectId = fixedProjectId || projectFilter || projects?.[0]?.id || '';
    const itemPlans = plansByItem.get(item.id) || [];
    const projectPlan = itemPlans.find((plan) => plan.scopeType === 'project') || itemPlans[0];
    setUploadItem(item);
    setUploadForm({
      projectId,
      scopeType: parentDrawing?.scopeType || projectPlan?.scopeType || 'project',
      scopeValue:
        parentDrawing?.scopeType === 'phase' ? parentDrawing.projectPhase :
        parentDrawing?.scopeType === 'building' ? parentDrawing.building :
        parentDrawing?.scopeType === 'amenity' ? parentDrawing.commonAmenity :
        projectPlan?.scopeLabel || '',
      startDate: parentDrawing?.plannedStart || projectPlan?.startDate || '',
      endDate: parentDrawing?.plannedEnd || projectPlan?.endDate || '',
      revision: '',
      description: parentDrawing?.description || '',
      parentDrawingId: parentDrawing?.id || '',
    });
    setFiles([]);
  };

  const designReviewContext = (projectId) => {
    const project = projectFor(projects, projectId);
    const designDept = (departments || []).find((d) => d.id === 'dept_design');
    const designPhase = (project?.phases || []).find(
      (ph) => getDepartmentForPhase(ph.name, departments)?.id === 'dept_design'
    );
    return {
      head: String(designDept?.head || '').trim(),
      phaseId: designPhase?.id || `ph_design_${Date.now()}`,
    };
  };

  const createReviewTasks = (uploaded, projectId) => {
    if (!uploaded?.length || !dispatch) return;
    const { head, phaseId } = designReviewContext(projectId);
    const tasks = uploaded.map((drawing) => ({
      id: uid('t_drawing_review'),
      name: `Review drawing: ${drawing.drawingName || drawing.label || drawing.fileName} (V${drawing.version || 1})`,
      dur: 2,
      who: head,
      drawingReview: {
        drawingId: drawing.id,
        seriesId: drawing.seriesId,
        title: drawing.drawingName || drawing.label || drawing.fileName,
        fileName: drawing.fileName,
        url: drawing.url,
        version: drawing.version || 1,
        projectPhase: drawing.projectPhase,
        building: drawing.building,
        drawingType: drawing.source || drawing.drawingType,
        subDrawing: drawing.scopeLabel,
        status: 'For review',
      },
    }));
    dispatch({ type: 'addDrawingReviewTasks', projId: projectId, phId: phaseId, tasks });
    void Promise.all(
      tasks.map((task, index) =>
        updateDrawing(uploaded[index].id, { reviewTaskId: task.id, reviewPhaseId: phaseId })
      )
    ).catch(() => {
      toast?.('Drawing uploaded; review-task link will retry on refresh.', 'err');
    });
    window.setTimeout(() => {
      void Promise.resolve(onPersist?.({ reason: 'drawing-review-task' })).catch(() => {});
    }, 120);
    if (!head) toast?.('Set a Design Department Head to assign the review task.', 'err');
  };

  const submitUpload = async () => {
    if (!uploadItem || !uploadForm.projectId || !files.length) {
      toast?.('Select a project and file', 'err');
      return;
    }
    if (uploadForm.scopeType !== 'project' && !uploadForm.scopeValue.trim()) {
      toast?.('Enter the phase, building, or common amenity name', 'err');
      return;
    }
    if (uploadForm.parentDrawingId && files.length !== 1) {
      toast?.('Upload one file for a new version', 'err');
      return;
    }
    scrollBeforeUpload.current = window.scrollY;
    setBusy(true);
    setUploadProgress(1);
    try {
      const project = projectFor(projects, uploadForm.projectId);
      const scoped = scopeFields(uploadForm.scopeType, uploadForm.scopeValue, project);
      const [plan, result] = await Promise.all([
        saveDrawingPlan(uploadItem.id, {
          projectId: uploadForm.projectId,
          scopeType: uploadForm.scopeType,
          scopeKey: scoped.scopeKey,
          scopeLabel: scoped.scopeLabel,
          startDate: uploadForm.startDate,
          endDate: uploadForm.endDate,
        }),
        uploadDrawings({
          projectId: uploadForm.projectId,
          ...scoped,
          scopeType: uploadForm.scopeType,
          catalogItemId: uploadItem.id,
          stage: uploadItem.stage,
          source: uploadItem.source,
          drawingName: uploadItem.drawingName,
          drawingType: uploadItem.source,
          subDrawing: '',
          plannedStart: uploadForm.startDate,
          plannedEnd: uploadForm.endDate,
          revision: uploadForm.revision,
          description: uploadForm.description,
          label: uploadItem.drawingName,
          parentDrawingId: uploadForm.parentDrawingId,
        }, files, setUploadProgress),
      ]);
      const uploaded = result.attachments || [];
      invalidateDrawingVaultCache(uploadForm.projectId);
      setPlans((old) => [...old.filter((row) => row.id !== plan.id), plan]);
      setDrawings((old) => {
        const uploadedIds = new Set(uploaded.map((row) => row.id));
        const retained = old
          .filter((row) => !uploadedIds.has(row.id))
          .filter((row) =>
            !(uploadForm.parentDrawingId && row.seriesId === uploaded[0]?.seriesId)
          );
        return [...uploaded, ...retained];
      });
      createReviewTasks(uploaded, uploadForm.projectId);
      toast?.('Drawing uploaded and sent to the Design Head for review', 'ok');
      setUploadItem(null);
      setFiles([]);
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: scrollBeforeUpload.current, behavior: 'auto' });
      });
    } catch (e) {
      toast?.(e?.message || 'Drawing upload failed', 'err');
    } finally {
      setBusy(false);
      setUploadProgress(0);
    }
  };

  const saveProjectDates = async (item, startDate, endDate) => {
    if (!selectedProjectId) {
      toast?.('Select a project before setting dates', 'err');
      return;
    }
    try {
      await saveDrawingPlan(item.id, {
        projectId: selectedProjectId,
        scopeType: 'project',
        scopeKey: 'project',
        scopeLabel: selectedProject?.name || 'Project level',
        startDate,
        endDate,
      });
      setPlans((old) => {
        const key = `${selectedProjectId}:${item.id}:project`;
        const next = old.filter((row) => row.id !== key);
        next.push({
          id: key,
          projectId: selectedProjectId,
          catalogItemId: item.id,
          scopeType: 'project',
          scopeKey: 'project',
          scopeLabel: selectedProject?.name || 'Project level',
          startDate,
          endDate,
        });
        return next;
      });
    } catch (e) {
      toast?.(e?.message || 'Could not save drawing dates', 'err');
    }
  };

  const doArchive = async (drawing) => {
    if (!window.confirm(`Archive "${drawing.label || drawing.fileName}"?`)) return;
    try {
      await archiveDrawing(drawing.id);
      await load({ silent: true });
    } catch (e) {
      toast?.(e?.message || 'Archive failed', 'err');
    }
  };

  const doRestore = async (drawing) => {
    try {
      await restoreDrawing(drawing.id);
      await load();
    } catch (e) {
      toast?.(e?.message || 'Restore failed', 'err');
    }
  };

  return (
    <section className={`dvt-shell${embedded ? ' dvt-embedded' : ''}`}>
      {!embedded ? (
        <header className="dvt-hero">
          <div>
            <span className="dvt-eyebrow">Golden Abodes · curated drawing control</span>
            <h2>{fixedProjectId ? 'Project Drawings' : 'Drawings Vault'}</h2>
            <p>Stage › Source › Drawing Name · curated deliverables with project, phase, building and amenity uploads.</p>
          </div>
          <div className="dvt-hero-actions">
            <button type="button" className={`dvt-btn${showArchive ? ' primary' : ''}`} onClick={() => setShowArchive((v) => !v)}>
              {showArchive ? '← Active tree' : 'Archive folders'}
            </button>
            {canManage && !showArchive ? <button type="button" className="dvt-btn primary" onClick={() => openCatalogEditor()}>+ Add drawing</button> : null}
          </div>
        </header>
      ) : (
        <div className="dvt-embedded-head">
          <div>
            <span className="dvt-eyebrow">Design subsection</span>
            <h3>Drawings</h3>
            <p>Stage › Source › Drawing Name · dates roll up from the first to the last drawing.</p>
          </div>
          {canManage ? <button type="button" className="dvt-btn" onClick={() => openCatalogEditor()}>+ Add</button> : null}
        </div>
      )}

      {!embedded ? (
        <div className="dvt-toolbar">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search stage, source or drawing…" />
          {!fixedProjectId ? (
            <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="">All projects</option>
              {(projects || []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          ) : null}
          <span>{catalog.length} drawings · {tree.length} stages</span>
        </div>
      ) : null}

      {error ? <div className="dvt-state error">{error}</div> : null}
      {loading ? <div className="dvt-state">Loading curated drawing tree…</div> : null}

      {!loading ? (
        <div className="dvt-tree">
          {tree.map((stage) => {
            const dates = stageDates(stage.itemIds);
            const stageFiles = stage.itemIds.reduce((n, id) => n + (drawingsByItem.get(id)?.length || 0), 0);
            return (
              <details key={stage.name} className="dvt-stage">
                <summary>
                  <span className="dvt-chevron">›</span>
                  <span className="dvt-stage-name">{stage.name}</span>
                  <span className="dvt-chip">{stage.itemIds.length} drawings</span>
                  <span className="dvt-chip">{stageFiles} files</span>
                  <span className="dvt-stage-dates">
                    <span>Start <strong>{dateLabel(dates.start)}</strong></span>
                    <span>End <strong>{dateLabel(dates.end)}</strong></span>
                  </span>
                </summary>
                <div className="dvt-stage-body">
                  {stage.sources.map((source) => (
                    <details key={`${stage.name}-${source.name}`} className="dvt-source">
                      <summary>
                        <span className="dvt-chevron">›</span>
                        <span>{source.name}</span>
                        <span className="dvt-chip">{source.items.length}</span>
                        {canManage ? (
                          <button
                            type="button"
                            className="dvt-mini"
                            onClick={(e) => {
                              e.preventDefault();
                              openCatalogEditor(null, {
                                stage: stage.name,
                                source: source.name,
                                stageOrder: stage.order,
                                sourceOrder: source.order,
                                drawingOrder: source.items.length + 1,
                              });
                            }}
                          >
                            + Drawing
                          </button>
                        ) : null}
                      </summary>
                      <div className="dvt-source-body">
                        {source.items.map((item) => {
                          const itemPlans = plansByItem.get(item.id) || [];
                          const projectPlan = itemPlans.find((plan) => plan.scopeType === 'project') || itemPlans[0] || {};
                          const itemFiles = drawingsByItem.get(item.id) || [];
                          return (
                            <div key={item.id} className="dvt-drawing">
                              <div className="dvt-drawing-row">
                                <div className="dvt-drawing-name">
                                  <strong>{item.drawingName}</strong>
                                  <span>
                                    {itemFiles.length
                                      ? `${itemFiles.length} ${showArchive ? 'archived' : 'active'} file${itemFiles.length !== 1 ? 's' : ''}`
                                      : 'Awaiting upload'}
                                  </span>
                                </div>
                                {selectedProjectId ? (
                                  <div className="dvt-date-fields">
                                    <label>Start<input type="date" defaultValue={projectPlan.startDate || ''} onBlur={(e) => saveProjectDates(item, e.target.value, projectPlan.endDate || '')} /></label>
                                    <label>End<input type="date" defaultValue={projectPlan.endDate || ''} onBlur={(e) => saveProjectDates(item, projectPlan.startDate || '', e.target.value)} /></label>
                                  </div>
                                ) : null}
                                <div className="dvt-row-actions">
                                  {!showArchive ? <button type="button" className="dvt-btn primary" onClick={() => openUpload(item)}>Upload</button> : null}
                                  {canManage ? (
                                    <>
                                      <button type="button" className="dvt-mini" onClick={() => openCatalogEditor(item)}>Edit</button>
                                      <button type="button" className="dvt-mini danger" onClick={() => deleteCatalog(item)}>Delete</button>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                              {itemFiles.length ? (
                                <div className="dvt-files">
                                  {itemFiles.map((drawing) => (
                                    <FileRow
                                      key={drawing.id}
                                      drawing={drawing}
                                      archived={showArchive}
                                      onNewVersion={(row) => openUpload(item, row)}
                                      onArchive={doArchive}
                                      onRestore={doRestore}
                                    />
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            );
          })}

          {legacyDrawings.length ? (
            <details className="dvt-stage">
              <summary>
                <span className="dvt-chevron">›</span>
                <span className="dvt-stage-name">Legacy / Uncatalogued Uploads</span>
                <span className="dvt-chip">{legacyDrawings.length} files</span>
              </summary>
              <div className="dvt-files dvt-legacy">
                {legacyDrawings.map((drawing) => (
                  <FileRow
                    key={drawing.id}
                    drawing={drawing}
                    archived={showArchive}
                    onNewVersion={() => toast?.('Select a curated drawing before uploading the next version', 'err')}
                    onArchive={doArchive}
                    onRestore={doRestore}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      {catalogEditor ? (
        <div className="dvt-modal-backdrop" onClick={() => setCatalogEditor(null)}>
          <div className="dvt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dvt-modal-head">
              <div><span className="dvt-eyebrow">Editable curated list</span><h3>{catalogEditor.id ? 'Modify drawing' : 'Add drawing'}</h3></div>
              <button type="button" onClick={() => setCatalogEditor(null)}>×</button>
            </div>
            <label>Stage<input value={catalogEditor.stage} onChange={(e) => setCatalogEditor((x) => ({ ...x, stage: e.target.value }))} placeholder="e.g. 05. Mechanical GFC / Execution" /></label>
            <label>Source<input value={catalogEditor.source} onChange={(e) => setCatalogEditor((x) => ({ ...x, source: e.target.value }))} placeholder="Architect / Consultant" /></label>
            <label>Drawing name<textarea rows={3} value={catalogEditor.drawingName} onChange={(e) => setCatalogEditor((x) => ({ ...x, drawingName: e.target.value }))} /></label>
            <div className="dvt-modal-actions">
              <button type="button" className="dvt-btn" onClick={() => setCatalogEditor(null)}>Cancel</button>
              <button type="button" className="dvt-btn primary" disabled={busy} onClick={saveCatalog}>{busy ? 'Saving…' : 'Save drawing'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {uploadItem ? (
        <div className="dvt-modal-backdrop" onClick={() => setUploadItem(null)}>
          <div className="dvt-modal dvt-upload-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dvt-modal-head">
              <div>
                <span className="dvt-eyebrow">{uploadItem.stage} · {uploadItem.source}</span>
                <h3>{uploadForm.parentDrawingId ? 'Upload next version' : uploadItem.drawingName}</h3>
              </div>
              <button type="button" disabled={busy} onClick={() => setUploadItem(null)}>×</button>
            </div>
            {!fixedProjectId ? (
              <label>Project<select value={uploadForm.projectId} onChange={(e) => setUploadForm((x) => ({ ...x, projectId: e.target.value }))}>
                <option value="">Select project</option>
                {(projects || []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select></label>
            ) : null}
            <div className="dvt-form-grid">
              <label>Upload level<select value={uploadForm.scopeType} onChange={(e) => setUploadForm((x) => ({ ...x, scopeType: e.target.value, scopeValue: '' }))}>
                {DRAWING_SCOPE_TYPES.map((scope) => <option key={scope.id} value={scope.id}>{scope.label}</option>)}
              </select></label>
              {uploadForm.scopeType !== 'project' ? (
                <label>
                  {uploadForm.scopeType === 'phase' ? 'Project phase' : uploadForm.scopeType === 'building' ? 'Building' : 'Common amenity'}
                  <input
                    list={uploadForm.scopeType === 'phase' ? 'dvt-phase-options' : undefined}
                    value={uploadForm.scopeValue}
                    onChange={(e) => setUploadForm((x) => ({ ...x, scopeValue: e.target.value }))}
                    placeholder={uploadForm.scopeType === 'phase' ? 'Phase I' : uploadForm.scopeType === 'building' ? 'Tower A' : 'Clubhouse / Landscape'}
                  />
                  <datalist id="dvt-phase-options">{PROJECT_PHASES.map((phase) => <option key={phase} value={phase} />)}</datalist>
                </label>
              ) : <div />}
              <label>Start date<input type="date" value={uploadForm.startDate} onChange={(e) => setUploadForm((x) => ({ ...x, startDate: e.target.value }))} /></label>
              <label>End date<input type="date" value={uploadForm.endDate} onChange={(e) => setUploadForm((x) => ({ ...x, endDate: e.target.value }))} /></label>
              <label>Revision reference<input value={uploadForm.revision} onChange={(e) => setUploadForm((x) => ({ ...x, revision: e.target.value }))} /></label>
              <label className="span-2">Notes<textarea rows={2} value={uploadForm.description} onChange={(e) => setUploadForm((x) => ({ ...x, description: e.target.value }))} /></label>
              <label className="span-2 dvt-file-input">File{uploadForm.parentDrawingId ? '' : 's'}<input type="file" multiple={!uploadForm.parentDrawingId} accept={ATTACHMENT_ACCEPT} onChange={(e) => setFiles([...e.target.files])} /><span>{files.length ? `${files.length} selected` : 'PDF, image, Office, DWG, DXF or DWF'}</span></label>
            </div>
            {busy ? (
              <div className="dvt-upload-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={uploadProgress}>
                <span style={{ width: `${uploadProgress}%` }} />
                <strong>{uploadProgress < 100 ? `Uploading ${uploadProgress}%` : 'Finalizing…'}</strong>
              </div>
            ) : null}
            <div className="dvt-modal-actions">
              <button type="button" className="dvt-btn" disabled={busy} onClick={() => setUploadItem(null)}>Cancel</button>
              <button type="button" className="dvt-btn primary" disabled={busy} onClick={submitUpload}>{busy ? `${uploadProgress}%` : 'Upload & create review task'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
