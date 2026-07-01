import React from 'react';

/**
 * Overall vs department-level filtering for My Work.
 * Default overall + no dept = unchanged portfolio calendar.
 */
export function MyWorkLevelFilters({
  viewLevel,
  onViewLevelChange,
  departmentFilter,
  onDepartmentFilterChange,
  departments,
  deptSummaries,
  overallHint = 'All departments on one calendar',
  departmentHint = 'Focus one department at a time',
}) {
  const showDeptPills = viewLevel === 'department' || (deptSummaries?.length > 0);
  const activeDept = departmentFilter || '';

  return (
    <div className="mw-level-wrap">
      <div className="mw-level-row">
        <span className="mw-level-label">Level</span>
        <div className="mw-level-tabs" role="tablist" aria-label="Work level">
          <button
            type="button"
            role="tab"
            aria-selected={viewLevel === 'overall'}
            className={`mw-level-tab${viewLevel === 'overall' ? ' on' : ''}`}
            onClick={() => {
              onViewLevelChange('overall');
              onDepartmentFilterChange('');
            }}
          >
            Overall
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewLevel === 'department'}
            className={`mw-level-tab${viewLevel === 'department' ? ' on' : ''}`}
            onClick={() => onViewLevelChange('department')}
          >
            Department
          </button>
        </div>
        {viewLevel === 'overall' ? (
          <span className="mw-level-hint">{overallHint}</span>
        ) : (
          <span className="mw-level-hint">{departmentHint}</span>
        )}
      </div>

      {showDeptPills ? (
        <div className="mw-level-row mw-dept-row">
          <span className="mw-level-label">Department</span>
          <div className="mw-dept-filters" role="group" aria-label="Department filter">
            {viewLevel === 'overall' ? (
              <button
                type="button"
                className={`mw-dept-pill${!activeDept ? ' on' : ''}`}
                onClick={() => onDepartmentFilterChange('')}
              >
                All
                <span className="mw-dept-count">
                  {(deptSummaries || []).reduce((n, d) => n + d.open, 0)}
                </span>
              </button>
            ) : null}
            {(departments || []).map((d) => {
              const stats = (deptSummaries || []).find((s) => s.id === d.id);
              const count = stats?.open ?? 0;
              const on = activeDept === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  className={`mw-dept-pill${on ? ' on' : ''}${count === 0 ? ' dim' : ''}`}
                  onClick={() => onDepartmentFilterChange(d.id)}
                  title={d.head ? `Head: ${d.head}` : d.name}
                >
                  <span className="mw-dept-pill-name">{d.name}</span>
                  <span className="mw-dept-count">{count}</span>
                  {stats?.overdue > 0 ? (
                    <span className="mw-dept-risk">{stats.overdue} late</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
