import { useState } from 'react';
import { DashboardActivityReport } from './DashboardActivityReport.jsx';
import { DashboardComplianceView } from './DashboardComplianceView.jsx';

const C = { navy: '#1A304A', tx2: '#55504A' };

export function DashboardReportsView({ activityLog = [], projects = [], onOpenProject }) {
  const [subTab, setSubTab] = useState('compliance');

  return (
    <div className="dash-reports-hub">
      <div className="dash-reports-hub-head">
        <h1 className="disp" style={{ fontSize: 26, fontWeight: 600, color: C.navy, margin: 0 }}>
          Reports
        </h1>
        <p style={{ fontSize: 13, color: C.tx2, marginTop: 6, lineHeight: 1.5 }}>
          Activity audit trail and process compliance for pre-construction tasks.
        </p>
      </div>
      <div className="dash-reports-subtabs" role="tablist" aria-label="Report types">
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
      {subTab === 'compliance' ? (
        <DashboardComplianceView projects={projects} onOpenProject={onOpenProject} />
      ) : (
        <DashboardActivityReport activityLog={activityLog} projects={projects} />
      )}
    </div>
  );
}
