import { useState } from 'react';
import { DashboardActivityReport } from './DashboardActivityReport.jsx';
import { DashboardComplianceView } from './DashboardComplianceView.jsx';
import { AnalyticsAskView } from './AnalyticsAskView.jsx';

const C = { navy: '#1A304A', tx2: '#55504A' };

export function DashboardReportsView({
  activityLog = [],
  projects = [],
  onOpenProject,
  dispatch,
  toast,
  loginUser,
}) {
  const [subTab, setSubTab] = useState('ask');

  return (
    <div className="dash-reports-hub">
      <div className="dash-reports-hub-head">
        <h1 className="disp" style={{ fontSize: 26, fontWeight: 600, color: C.navy, margin: 0 }}>
          Reports
        </h1>
        <p style={{ fontSize: 13, color: C.tx2, marginTop: 6, lineHeight: 1.5 }}>
          Ask anything of live PreConstruction data, then review compliance and activity audit trails.
        </p>
      </div>
      <div className="dash-reports-subtabs" role="tablist" aria-label="Report types">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'ask'}
          className={`dash-reports-subtab${subTab === 'ask' ? ' act' : ''}`}
          onClick={() => setSubTab('ask')}
        >
          Ask AI
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'compliance'}
          className={`dash-reports-subtab${subTab === 'compliance' ? ' act' : ''}`}
          onClick={() => setSubTab('compliance')}
        >
          Process compliance
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'activity'}
          className={`dash-reports-subtab${subTab === 'activity' ? ' act' : ''}`}
          onClick={() => setSubTab('activity')}
        >
          Activity log
        </button>
      </div>
      {subTab === 'ask' ? (
        <AnalyticsAskView
          projects={projects}
          dispatch={dispatch}
          toast={toast}
          onOpenProject={onOpenProject}
          loginUser={loginUser}
        />
      ) : subTab === 'compliance' ? (
        <DashboardComplianceView projects={projects} onOpenProject={onOpenProject} />
      ) : (
        <DashboardActivityReport activityLog={activityLog} projects={projects} />
      )}
    </div>
  );
}
