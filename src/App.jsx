import React, { useState, useEffect, useRef, useCallback, useReducer, useMemo } from 'react';
import { MongoSyncAdapter } from "./mongoSync.jsx";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { cDates, dbDays, dateSpanDays, isHiddenByCollapsedAncestor } from "./preconDates.js";
import { downloadPreconExcel, collectAssignees, iterAllTasks } from "./preconExport.js";
import { importExcelIntoState, parseJsonState } from "./preconImport.js";
import {
  buildLifecyclePhasesForProject,
  mergeLifecycleIntoState,
  applyKickoffOffsets,
  LIFECYCLE_VERSION,
} from "./preconLifecycle.js";
import { ensureStateDepartments,
  getDepartmentForPhase,
  formatRoles,
  parseRolesInput,
  taskMatchesDepartment,
  taskMatchesRoleFilter,
  collectAllRoles,
} from "./preconDepartments.js";
import { taskHasRole, taskInDepartment } from "./bulkAssign.js";
import { PortfolioRagMatrix } from "./PortfolioRagMatrix.jsx";
import { ensureCommentCreatedAt, formatCommentLine, getLatestComment, normalizeTaskComments, sortCommentsChronologically, collectTaskComments } from "./preconComments.js";
import { useLoginUser } from "./useLoginUser.js";
import { fetchPreconTeamRoster } from "./preconSession.js";
import { canDeletePreconProjects } from "./preconPermissions.js";
import { MyWorkView } from "./MyWorkView.jsx";
import { DashboardCalendarView } from "./DashboardCalendarView.jsx";
import { TaskCommentModal } from "./TaskCommentModal.jsx";
import { ProjectPageShell } from "./ProjectPageShell.jsx";
import { TaskCommentsListSection } from "./TaskCommentsListSection.jsx";
import { StatusFilterChips } from "./StatusFilterChips.jsx";
import { AssigneeMultiSelect } from "./AssigneeMultiSelect.jsx";
import { filterProjectsForUser, buildAssigneeRoster, projectsForAssigneeRoster, taskMatchesAssigneeFilter, UNASSIGNED_FILTER } from "./preconAssignees.js";
import { filterAndSortProjects } from "./projectSearch.js";
import { ProjectNavPicker } from "./ProjectNavPicker.jsx";
import { notifyTaskStatusChange } from "./preconNotify.js";
import { migratePreWorkFollowUpState, applyGhqPreWorkToPhases } from "./preconGhqPreWorkMigrate.js";
import { mergeAkashActivitiesIntoState } from "./preconAkashGhqMerge.js";
import { migrateAssigneeNamesState } from "./preconAssigneeNames.js";
import { formatNavStatusMessage } from './preconNavStatus.js';
import { recordActivityFromAction, setPreconActivityActor, dedupeActivityLog } from './preconActivityLog.js';
import { applyTaskTombstonesToProject } from './preconProjectMerge.js';
import { expandPhasesForDisplay, realPhaseId } from './preconDesignApproval.js';
import {
  annotateTreeMeta,
  orderTasksAsTree,
  indexTasksById,
  insertIndexAfterParent,
  idsToDeleteWithDescendants,
  reorderSubtree,
  taskParentId,
  normalizeParentIdOnTask,
} from './preconTaskTree.js';
import { DashboardReportsView } from './DashboardReportsView.jsx';
import { BulkAllocateView } from './BulkAllocateView.jsx';
import { AnalyticsAskView } from './AnalyticsAskView.jsx';
import {
  taskStatus,
  taskStatusSelectValue,
  statusLabel,
  statusBadgeClass,
  todayDate,
  todayIso,
  TASK_STATUS_OPTIONS,
  taskMatchesStatusFilters,
  currentDueIso,
  dueDateHeat,
  dueHeatColor,
} from "./preconTaskStatus.js";

// ── TOKENS ────────────────────────────────────────────────
const C = {
  bg:"#F8F6F1",sf:"#FFF",sf2:"#F3F0EA",sf3:"#EAE6DC",
  bd:"#E2DDD4",bd2:"#CEC8BB",
  tx:"#1A1815",tx2:"#55504A",tx3:"#96918A",
  gold:"#9A6E20",goldl:"#C89A3A",goldbg:"#FBF7EE",goldbd:"#E8D4A0",
  navy:"#1A304A",navyl:"#253E60",
  blue:"#1B5E9E",bluebg:"#EEF4FC",bluebd:"#B5D0EF",
  green:"#1A6A3C",greenbg:"#EAF5EE",greenbd:"#A8DEB8",
  red:"#B32E1E",redbg:"#FCECEA",redbd:"#EFBAB0",
  org:"#AE6418",orgbg:"#FDF3E8",orgbd:"#E8C490",
  gray:"#6A6560",graybg:"#F5F3EE",
};
const SCOL={completed:"#1A6A3C",inprogress:"#1B5E9E",overdue:"#B32E1E",upcoming:"#9A9590",notstarted:"#9A9590",paused:"#AE6418",blocked:"#AE6418"};
const PCOL=["#1B5E9E","#6B3FA0","#B45309","#1A6A3C","#B32E1E","#2A6E7A","#7A3A2A","#8A5A2A"];
const TODAY=todayDate();
const GS=new Date("2025-11-01");
const GE=new Date("2027-04-30");
const GDAYS=Math.round((GE-GS)/864e5);
const DPX=3.1;
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── UTILS ────────────────────────────────────────────────
const aD=(d,n)=>{const r=new Date(d);r.setDate(r.getDate()+n);return r;};
const iso=d=>{const dt=new Date(d);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;};
const fmt=d=>{if(!d)return"—";const dt=new Date(d);return `${dt.getDate()} ${MON[dt.getMonth()]} ${String(dt.getFullYear()).slice(2)}`;};
const db=(a,b)=>Math.round((new Date(b)-new Date(a))/864e5);
const now=()=>new Date().toLocaleString("en-IN",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
const mkT=(id,nm,dur,pred=[],par=null,ex={})=>({id,name:nm,dur,pred,par,parentId:ex.parentId??null,ms:null,who:"",roles:Array.isArray(ex.roles)?ex.roles:[],comments:[],as:null,ae:null,status:"notstarted",...ex});
const uid=()=>"t_"+Date.now()+"_"+Math.random().toString(36).slice(2,6);

// ── PHASE TEMPLATES ──────────────────────────────────────
const mkSOPhase=()=>({
  id:"pso_"+Date.now(), name:"Sales Office Setup", col:PCOL[5], open:true,
  tasks:[
    mkT("so1","Requirement Planning: Plan sales office requirements",7),
    mkT("so2","Architect Drawings: Get drawings from architect/interior",14,["so1"]),
    mkT("so3","Validation: Validate drawings",3,["so2"]),
    mkT("so4","Vendor Shortlist: Shortlist contractors/vendors",7,["so3"]),
    mkT("so5","Vendor Finalization: Finalize contractors/vendors",5,["so4"]),
    mkT("so6","Completion: Complete office construction & handover",30,["so5"]),
  ]
});
const mkCPPhase=()=>({
  id:"pcp_"+Date.now(), name:"Construction Pre-requisite", col:PCOL[6], open:true,
  tasks:[
    mkT("cp1","Shortlist excavation contractor",7),
    mkT("cp2","Shortlist civil contractor",7,["cp1"]),
    mkT("cp3","Shortlist facade consultant",7,["cp1"]),
  ]
});

// fix IDs to be project-unique
function mkPhasesFor(pid){
  const so=mkSOPhase();const cp=mkCPPhase();
  so.tasks=so.tasks.map(t=>({...t,id:pid+"_"+t.id}));
  cp.tasks=cp.tasks.map(t=>({...t,id:pid+"_"+t.id}));
  // fix pred refs too
  const fixPred=(tasks)=>tasks.map(t=>({...t,pred:t.pred.map(p=>pid+"_"+p)}));
  so.tasks=fixPred(so.tasks);cp.tasks=fixPred(cp.tasks);
  return{so,cp};
}

// ── INITIAL DATA ────────────────────────────────────────
function buildInit(){
  // Empty shell — Mongo GET fills the real portfolio. Avoids slow seed→server double paint.
  const shell = {
    cloudUrl: "",
    projects: [],
    activityLog: [],
    _removedProjectIds: [],
  };
  ensureStateDepartments(shell);
  return shell;
}

function buildLegacySeedCatalogUnused(){
  const{so:ghqSO,cp:ghqCP}=mkPhasesFor("ghq");
  const{so:nkwSO,cp:nkwCP}=mkPhasesFor("nkw");
  const{so:wgaSO,cp:wgaCP}=mkPhasesFor("wga");
  const{so:parSO,cp:parCP}=mkPhasesFor("par");
  const init={
    cloudUrl:"",
    projects:[
      {id:"ghq",name:"Golden HQ",loc:"PCMC, Pune",type:"Grade-A Commercial Tower",floors:33,status:"Pre-Construction",ko:"2025-11-11",col:"#1A304A",phases:[
        {id:"pl",name:"Land Acquisition & Feasibility",col:PCOL[0],open:true,tasks:[
          mkT("la1","Scouting: Identify land parcels",30),mkT("la2","Planning Control: FSI/FAR & setbacks",2,["la1"]),
          mkT("la3","Contour & Topographic Survey",10,["la2"]),mkT("la4","Tentative Layout Planning",10,["la3"]),
          mkT("la5","Market Feasibility Study",2,["la4"]),mkT("la6","Financial Feasibility Analysis",2,["la4"],"la5"),
          mkT("la7","Decision to Proceed",1,["la5","la6"]),mkT("la8","MoU / Term Sheet",25,["la7"]),
          mkT("la9","SPV Formation (LLP Deed)",14,["la7"]),mkT("la10","Identify & Block Fund Source",7,["la7"]),
        ]},
        {id:"pt",name:"Technical & Legal Due Diligence",col:PCOL[1],open:true,tasks:[
          mkT("le1","City Survey Records & Extracts",30,["la8"]),mkT("le2","DP Remark / Zoning Confirmation",30,["la8"],"le1"),
          mkT("le3","7/12 Extracts & Property Cards",30,["la8"],"le1"),mkT("le4","Mutation Entries — Revenue Office",30,["la8"],"le1"),
          mkT("le5","Demarcation — City Survey Office",30,["la8"],"le1"),
          mkT("le6","Title Certificate from Advocate",8,["le1","le2","le3","le4","le5"]),
          mkT("le7","Encumbrances & Liens Check",8,["le6"]),
        ]},
        {id:"pf",name:"Project Financial Working",col:PCOL[2],open:true,tasks:[
          mkT("fi1","Demand–Supply Analysis",7,["le7"]),mkT("fi2","Benchmark Competing Projects",7,["le7"],"fi1"),
          mkT("fi3","Product Development & USP",30,["fi1"]),mkT("fi4","Unit Mix Definition",30,["fi1"],"fi3"),
          mkT("fi5","Amenities List",30,["fi1"],"fi3"),mkT("fi6","Parking Requirements",30,["fi1"],"fi3"),
          mkT("fi7","Project Feasibility (IRR/GDV)",30,["fi1"],"fi3"),mkT("fi8","Concept Massing",30,["fi3"]),
          mkT("fi9","Cost Estimate",14,["fi3"],"fi8"),
        ]},
        {id:"pd",name:"Design & Team Appointments",col:PCOL[3],open:true,tasks:[
          mkT("de1","Architect Shortlisting",7,["la8"]),mkT("de2","Appoint Architect",7,["de1"]),
          mkT("de3","Appoint Structural Consultant",7,["de2"]),mkT("de4","Appoint MEP Consultant",7,["de2"],"de3"),
          mkT("de5","Soil Investigation",30,["de2"]),mkT("de6","Master Plan",15,["de2"]),
          mkT("de7","Building Layouts",15,["de2"],"de6"),mkT("de8","Freeze Unit Plans",15,["de2"],"de6"),
          mkT("de9","Structural System Design",15,["de6","de3"]),mkT("de10","MEP Schematics",8,["de9","de4"]),
          mkT("de11","Fire & Life Safety Design",8,["de10"]),mkT("de12","Appoint Landscape Consultant",14,["de11"]),
        ]},
        {id:"pr",name:"Regulatory Approvals",col:PCOL[4],open:false,tasks:[
          mkT("re1","Tentative Fire NOC",6,[],null,{ms:"2025-12-09"}),mkT("re2","Provisional Fire OC",15,["re1"]),
          mkT("re3","MSEB NOC",30,["re2"]),mkT("re4","Initiate RERA Documentation",7,[],null,{ms:"2025-12-09"}),
          mkT("re5","Submit Drawings to Authority",7,["de11"]),mkT("re6","Obtain IOD",15,["re5"]),
          mkT("re7","Fire NOC for EC",10,["re6"]),mkT("re8","Swatch NOC (E-Waste)",5,["re6"]),
          mkT("re9","Geo-Tagging for Trees",15,["de11"]),mkT("re10","Garden NOC",15,["de11"],"re9"),
          mkT("re11","Water Supply NOC",10,["re6"]),mkT("re12","Sewer/Storm Water NOC",8,["re6"]),
          mkT("re13","Traffic / NH NOC",10,["re6"]),mkT("re14","EC Preparation (EIA Consultant)",45,["re7"]),
          mkT("re15","Environmental Clearance (SEIAA)",90,["re14"]),mkT("re16","MPCB Consent to Establish",90,["re15"]),
          mkT("re17","Building Plan Sanction",60,["re15","re11","re12"]),mkT("re18","RERA Registration",60,["re17"]),
        ]},
        ghqSO, ghqCP,
      ]},
      {id:"nkw",name:"NKG Wakad",loc:"Wakad, Pune",type:"Residential",floors:14,status:"Pipeline",ko:"2026-06-01",col:"#1A5A30",phases:[
        {id:"pl",name:"Land Acquisition",col:PCOL[0],open:true,tasks:[
          mkT("nk1","Scouting & Site Evaluation",21),mkT("nk2","Title Verification",14,["nk1"]),mkT("nk3","Feasibility Study",10,["nk2"]),
        ]}, nkwSO, nkwCP,
      ]},
      {id:"wga",name:"Wakad GA",loc:"Wakad, Pune",type:"Mixed-Use",floors:20,status:"Evaluation",ko:"2026-08-01",col:"#5A3020",phases:[
        {id:"pl",name:"Land Acquisition",col:PCOL[0],open:true,tasks:[
          mkT("wg1","Site Identification",14),mkT("wg2","Legal Due Diligence",21,["wg1"]),
        ]}, wgaSO, wgaCP,
      ]},
      {id:"par",name:"Paradise",loc:"Goa",type:"Luxury Villa",floors:4,status:"Pipeline",ko:"2026-09-01",col:"#2A6E7A",phases:[
        {id:"pl",name:"Land Acquisition",col:PCOL[0],open:true,tasks:[
          mkT("pa1","Scouting",30),mkT("pa2","TCP Act Verification",14,["pa1"]),
        ]}, parSO, parCP,
      ]},
    ],
    activityLog:[],
    _removedProjectIds:[],
  };
  const merged = mergeLifecycleIntoState(init).state;
  migratePreWorkFollowUpState(merged);
  migrateAssigneeNamesState(merged);
  const ghq = merged.projects?.find((p) => p.id === "ghq");
  if (ghq) applyGhqPreWorkToPhases(ghq.phases);
  mergeAkashActivitiesIntoState(merged);
  return merged;
}

const gSt=(t,dm)=>taskStatus(t,dm);
function pStats(proj){
  const dm=cDates(proj);let tot=0,comp=0,ip=0,ov=0,up=0,paused=0;
  proj.phases.forEach(ph=>ph.tasks.forEach(t=>{
    tot++;const st=taskStatus(t,dm);
    if(st==="completed")comp++;else if(st==="inprogress")ip++;else if(st==="overdue")ov++;
    else if(st==="paused")paused++;else up++;
  }));
  return{tot,comp,ip,ov,up,paused,pct:tot?Math.round(comp/tot*100):0};
}

// ── REGULATIONS DATA ─────────────────────────────────────
const REGS=[
  {id:"iod",cat:"Mandatory",cc:C.red,title:"Building Plan Sanction (IOD / CC)",auth:"PCMC Commissioner — e-Sakar portal",act:"MRTP Act 1966 Sec.45; PCMC DCR 2017",ap:"Mandatory before construction. EC is mandatory pre-condition for buildings >70m (Golden HQ ~115m).",tl:"60–90 working days",docs:["Title deed","Architectural drawings","Structural drawings","Soil investigation report","NOC bundle: Fire, Tree, AAI, MSEDCL, MPCB, Water, Sewer"],note:"Buildings >70m: PCMC refers to Town Planning Dept for additional scrutiny."},
  {id:"ec",cat:"Mandatory",cc:C.red,title:"Environmental Clearance (EC)",auth:"SEIAA Maharashtra — Parivesh portal",act:"EIA Notification 2006 — Schedule B1 (>20,000 sqm built-up)",ap:"Mandatory. Golden HQ far exceeds 20,000 sqm. Category B1 — SEIAA Maharashtra.",tl:"105–180 days: Form 1 → Scoping → EIA Study → Public Hearing → SEAC → EC",docs:["Form 1 and 1A (Parivesh)","Conceptual Plan","EIA Report by MoEF-accredited consultant","Public Hearing proceedings","Terms of Reference from SEIAA"],note:"EC validity 5 years. Cannot apply for IOD or MPCB CTE without valid EC. CRITICAL PATH item."},
  {id:"mpcb",cat:"Mandatory",cc:C.red,title:"MPCB Consent to Establish (CTE)",auth:"Maharashtra PCB — Pune Regional Office",act:"Water Act 1974; Air Act 1981; Environment Protection Act 1986",ap:"Mandatory before construction. EC is mandatory pre-condition.",tl:"30–90 days after EC obtained",docs:["Copy of valid EC","Site plan","STP design details","DG set specifications"],note:"CTE is construction phase only. CTO obtained before OC at completion."},
  {id:"fire",cat:"Mandatory",cc:C.red,title:"Fire NOC (Provisional & Final)",auth:"MIDC Fire Brigade (PCMC area, MIDC jurisdiction)",act:"Maharashtra Fire Prevention & Life Safety Measures Act 2006; NBC 2016 Part 4",ap:"Mandatory for all buildings >15m. Buildings >70m: refuge floors, pressurisation, fire lifts mandatory.",tl:"15–45 days. ACTIVE BOTTLENECK: CFO MIDC routing via Chief Planning Office (+30 days)",docs:["Fire safety drawings","Fire lift specs","Refuge floor design","Smoke detection details","NBC 2016 Part 4 compliance cert"],note:"ACTIVE ISSUE: CFO MIDC Fire requires Chief Planning Office (Rajendra Pawar) opinion. Per Shekhar Nahar, adds ~1 month."},
  {id:"rera",cat:"Conditional",cc:C.org,title:"MahaRERA Registration",auth:"Maharashtra Real Estate Regulatory Authority",act:"RERA Act 2016; MahaRERA Rules 2017",ap:"Mandatory if commercial units are sold/allotted. Not required if purely leased.",tl:"30–60 days. Must register BEFORE any advertisement or allotment.",docs:["Ownership docs","Approved layout","CA-certified cost statement","Project schedule","Draft allotment agreement"],note:"Confirm with legal team: if any floor/office sold → RERA mandatory."},
  {id:"aai",cat:"Mandatory",cc:C.red,title:"Airport Height Clearance (AAI)",auth:"AAI — Pune Airport (Lohegaon); aai.aero portal",act:"Aircraft Act 1934 Sec.8A; Aircraft Rules 1937 Rule 87; AAI Act 1994",ap:"Mandatory. PCMC within OLS of Pune Airport. 33-floor (~115m) requires NOC.",tl:"30–90 days",docs:["Building coordinates (lat/long)","Proposed height above MSL","Elevation drawings","Site plan"],note:"PCMC buildings >45m need AAI clearance. Golden HQ ~115m: formal NOC mandatory. Apply early."},
  {id:"tree",cat:"Mandatory",cc:C.red,title:"Tree Authority NOC (PCMC)",auth:"Tree Authority, PCMC",act:"Maharashtra (Urban Areas) Protection & Preservation of Trees Act 1975",ap:"Mandatory if trees on/adjacent to plot are removed or pruned.",tl:"30–60 days; compensatory plantation imposed",docs:["Tree inventory with species, girth, height","Geo-tagged photographs","Justification for removal","Compensatory plantation plan (3× trees removed)"],note:"Geo-tagging (re9) and Plantation Details are prerequisite tracker items."},
  {id:"msedcl",cat:"Mandatory",cc:C.red,title:"MSEDCL NOC (Electricity)",auth:"MSEDCL — Pune Zone",act:"Electricity Act 2003; MSEDCL Supply Code",ap:"Mandatory for new HT/LT connection and transformer installation.",tl:"30–60 days",docs:["Load calculation statement","Electrical single-line diagram","Licensed electrical consultant letter","Site ownership proof"],note:"33-floor commercial requires dedicated HT connection. Plan substation within site boundary early."},
  {id:"struct",cat:"Mandatory",cc:C.red,title:"Structural Safety Certificate",auth:"PCMC-empanelled structural engineer; peer review by IIT/NIT for >70m",act:"NBC 2016 Part 6; IS 456:2000; IS 875:2015; IS 1893:2016 (Seismic Zone III)",ap:"Mandatory. Pune = Seismic Zone III. 33-floor requires seismic + wind load analysis.",tl:"Ongoing — submitted with IOD application",docs:["Structural drawings + BBS","Soil investigation report","Seismic analysis (Zone III, IS 1893:2016)","Wind load analysis","Structural engineer certificate"],note:"Buildings >45m: PCMC may require independent peer review. Wind tunnel testing recommended."},
];

// ── STYLE INJECTION ──────────────────────────────────────
const STYLES=`
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=DM+Sans:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body,#root{min-height:100vh;background:#F8F6F1;font-family:'DM Sans',sans-serif}
.disp{font-family:'Cormorant Garamond',serif}
.tnav{position:fixed;top:0;left:0;right:0;z-index:200;min-height:52px;background:#fff;border-bottom:1.5px solid #E2DDD4;display:flex;align-items:center;flex-wrap:wrap;padding:8px 18px;gap:6px 0;box-shadow:0 1px 8px rgba(0,0,0,.05)}
.main{margin-top:64px;padding:22px;max-width:1440px;margin-left:auto;margin-right:auto}
.nlogo{width:30px;height:30px;background:#1A304A;color:#C89A3A;border-radius:6px;display:flex;align-items:center;justify-content:center;font-family:'Cormorant Garamond',serif;font-size:15px;font-weight:700;flex-shrink:0}
.proj-sel-wrap{display:flex;align-items:center;gap:8px;flex:1;min-width:140px;padding:0 12px}
.proj-picker{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;flex:1;min-width:140px}
.proj-sel-lbl{font-size:10px;font-weight:600;color:#96918A;text-transform:uppercase;letter-spacing:.4px;flex-shrink:0}
.proj-search{flex:1;min-width:120px;max-width:220px;padding:7px 10px;border:1.5px solid #E2DDD4;border-radius:6px;font-size:12px;font-weight:500;color:#1A304A;background:#fff;font-family:'DM Sans',sans-serif}
.proj-search:focus{outline:none;border-color:#C89A3A;box-shadow:0 0 0 2px rgba(200,154,58,.25)}
.proj-search-hint{font-size:10px;color:#96918A;white-space:nowrap;flex-shrink:0}
.dash-proj-search{max-width:320px;width:100%;margin-top:10px;padding:9px 12px;border:1.5px solid #E2DDD4;border-radius:6px;font-size:13px;font-family:'DM Sans',sans-serif;color:#1A304A;background:#fff}
.dash-proj-search:focus{outline:none;border-color:#C89A3A;box-shadow:0 0 0 2px rgba(200,154,58,.25)}
.proj-sel{flex:1;min-width:0;max-width:min(360px,100%);padding:8px 36px 8px 12px;border:1.5px solid #E2DDD4;border-radius:6px;font-size:13px;font-weight:600;color:#1A304A;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2355504A' d='M2 4l4 4 4-4'/%3E%3C/svg%3E") no-repeat right 12px center;font-family:'DM Sans',sans-serif;cursor:pointer;appearance:none;-webkit-appearance:none}
.proj-sel:focus{outline:none;border-color:#C89A3A;box-shadow:0 0 0 2px rgba(200,154,58,.25)}
.proj-sel option{font-weight:500}
.nact{display:flex;align-items:center;gap:6px;padding-left:12px;border-left:1.5px solid #E2DDD4;flex-shrink:0;flex-wrap:wrap;max-width:min(520px,42vw)}
.nact-grp{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.nact-sep{width:1px;height:22px;background:#E2DDD4;flex-shrink:0}
.btp-add{padding:6px 14px;background:#9A6E20;color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;white-space:nowrap}
.btp-add:hover{background:#7A5618}
.file-lbl{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border:1px solid #E2DDD4;border-radius:5px;font-size:11px;font-weight:600;color:#55504A;background:#fff;cursor:pointer;white-space:nowrap;font-family:'DM Sans',sans-serif}
.file-lbl:hover{border-color:#1A304A;color:#1A304A}
.file-lbl input{display:none}
.dash-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;margin-bottom:4px}
.dash-stabs{display:flex;border-bottom:2px solid #E2DDD4;margin-top:8px;margin-bottom:22px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;background:#fff;border-radius:10px 10px 0 0;padding:4px 6px 0;box-shadow:0 1px 0 rgba(26,48,74,.06)}
.dash-stabs::-webkit-scrollbar{display:none}
.dash-stab{padding:10px 18px;border:none;background:none;color:#55504A;font-size:13px;font-weight:600;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px;transition:all .15s;font-family:'DM Sans',sans-serif;white-space:nowrap;min-height:44px}
.dash-stab:hover{color:#1A304A;background:rgba(26,48,74,.04);border-radius:8px 8px 0 0}
.dash-stab.act{color:#1A304A;border-bottom-color:#C89A3A;font-weight:700}
.dash-reports{margin-bottom:20px}
.dash-reports-hub{margin-bottom:20px}
.dash-reports-hub-head{margin-bottom:14px}
.dash-reports-subtabs{display:flex;gap:6px;margin-bottom:18px;border-bottom:1px solid #E2DDD4;padding-bottom:0}
.dash-reports-subtab{padding:10px 16px;border:none;background:none;color:#55504A;font-size:13px;font-weight:600;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-1px;font-family:'DM Sans',sans-serif;transition:all .15s}
.dash-reports-subtab:hover{color:#1A304A;background:rgba(26,48,74,.04);border-radius:8px 8px 0 0}
.dash-reports-subtab.act{color:#1A304A;border-bottom-color:#C89A3A;font-weight:700}
.ask-root{max-width:920px;margin:0 auto 28px}
.ask-hero{margin-bottom:16px}
.ask-eyebrow{margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9A6E20}
.ask-title{margin:0;font-size:28px;font-weight:600;color:#1A304A}
.ask-sub{margin:8px 0 0;font-size:13px;line-height:1.55;color:#55504A;max-width:640px}
.ask-box{padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.ask-box-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ask-scope{display:flex;flex-direction:column;gap:4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:#96918A}
.ask-scope select{min-width:220px;padding:8px 10px;border:1.5px solid #E2DDD4;border-radius:6px;font-size:13px;font-family:'DM Sans',sans-serif;color:#1A304A;background:#fff;text-transform:none;letter-spacing:0;font-weight:500}
.ask-input{width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid #E2DDD4;border-radius:8px;font-size:15px;line-height:1.45;font-family:'DM Sans',sans-serif;color:#1A1815;resize:vertical;min-height:84px}
.ask-input:focus{outline:none;border-color:#C89A3A;box-shadow:0 0 0 2px rgba(200,154,58,.2)}
.ask-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ask-kbd{font-size:11px;color:#96918A}
.ask-mic-hint{margin:0;font-size:11px;color:#9A6E20;font-weight:500}
.ask-examples{display:flex;flex-wrap:wrap;gap:6px}
.ask-chip{border:1px solid #E2DDD4;background:#FBF9F5;color:#55504A;border-radius:999px;padding:5px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;text-align:left;max-width:100%}
.ask-chip:hover:not(:disabled){border-color:#C89A3A;background:#FBF7EE;color:#1A304A}
.ask-chip:disabled{opacity:.55;cursor:not-allowed}
.ask-answer{padding:18px 20px;margin-top:14px}
.ask-answer-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
.ask-source{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;padding:3px 8px;border-radius:999px;border:1px solid #E2DDD4;background:#F3F0EA;color:#55504A}
.ask-source-llm{background:#EEF4FC;border-color:#B5D0EF;color:#1B5E9E}
.ask-source-local{background:#FBF7EE;border-color:#E8D4A0;color:#9A6E20}
.ask-intent{font-size:11px;color:#96918A;text-transform:capitalize}
.ask-hl{font-size:11px;color:#55504A}
.ask-warn{margin:0 0 10px;padding:8px 10px;border-radius:6px;background:#FDF3E8;border:1px solid #E8C490;color:#AE6418;font-size:12px}
.ask-md-h3{margin:0 0 10px;font-size:18px;color:#1A304A}
.ask-md-h4{margin:14px 0 6px;font-size:14px;color:#1A304A}
.ask-md-p{margin:0 0 6px;font-size:13px;line-height:1.55;color:#1A1815}
.ask-md-li{margin:0 0 4px;padding-left:12px;font-size:13px;line-height:1.5;color:#1A1815;position:relative}
.ask-md-li::before{content:"•";position:absolute;left:0;color:#9A6E20}
.ask-md-ol::before{content:none}
.ask-proposals{margin-top:16px;padding-top:14px;border-top:1px solid #E2DDD4}
.ask-proposal-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.ask-proposal-list li{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:10px 12px;border:1px solid #E2DDD4;border-radius:8px;background:#FAFAF8}
.ask-proposal-why{font-size:12px;color:#55504A;margin-top:3px}
.ask-history{margin-top:18px}
.ask-history ul{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.ask-hist-btn{border:none;background:none;color:#1B5E9E;font-size:12px;text-align:left;cursor:pointer;padding:0;font-family:'DM Sans',sans-serif;text-decoration:underline}
.ask-footnote{font-size:11px;margin-top:16px}
.ask-footnote code{font-size:10px;background:#F3F0EA;padding:1px 4px;border-radius:3px}
.dash-reports-stat-alert{border-color:rgba(179,46,30,.35);background:rgba(252,236,234,.5)}
.dash-reports-stat-alert .dash-reports-stat-n{color:#B32E1E}
.dash-reports-chip-warn{background:#FCECEA;border-color:#EFBAB0;color:#B32E1E}
.dash-compliance-asof{font-size:11px;color:#96918A;align-self:center;margin-left:auto}
.dash-compliance-days{display:inline-flex;align-items:center;justify-content:center;min-width:36px;padding:4px 8px;border-radius:8px;background:#FCECEA;color:#B32E1E;font-weight:700;font-size:12px}
.dash-compliance-badges{display:flex;flex-wrap:wrap;gap:5px}
.dash-compliance-badge{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.35px;padding:3px 8px;border-radius:999px;white-space:nowrap}
.dash-compliance-badge-schedule{background:#FCECEA;color:#B32E1E;border:1px solid #EFBAB0}
.dash-compliance-badge-next_action{background:#FDF3E8;color:#AE6418;border:1px solid #E8C490}
.dash-compliance-row:hover td{background:#FDF8F8}
.dash-reports-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:14px;margin-bottom:16px}
.dash-reports-dl{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start}
.dash-reports-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
.dash-reports-stat{background:#fff;border:1px solid #E2DDD4;border-radius:8px;padding:12px 14px}
.dash-reports-stat.wide{grid-column:span 2}
.dash-reports-stat-n{font-size:24px;font-weight:600;color:#1A304A;line-height:1}
.dash-reports-stat-l{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#96918A;margin-top:4px}
.dash-reports-chips{display:flex;flex-wrap:wrap;gap:6px}
.dash-reports-chip{font-size:11px;padding:3px 8px;border-radius:12px;background:#F3F0EA;border:1px solid #E2DDD4;color:#55504A}
.dash-reports-filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;align-items:center}
.dash-reports-filters select,.dash-reports-filters input[type=date]{padding:8px 10px;border:1.5px solid #E2DDD4;border-radius:6px;font-size:12px;font-family:'DM Sans',sans-serif;color:#1A304A;background:#fff}
.dash-reports-table-wrap{overflow:auto;max-height:min(62vh,640px)}
.dash-reports-table{width:100%;border-collapse:collapse;font-size:12px}
.dash-reports-table th{position:sticky;top:0;background:#F3F0EA;text-align:left;padding:10px 12px;border-bottom:1px solid #E2DDD4;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#96918A}
.dash-reports-table td{padding:10px 12px;border-bottom:1px solid #EAE6DC;vertical-align:top;color:#1A1815}
.dash-reports-table tr:hover td{background:#FBF9F5}
.dash-reports-type{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.35px;color:#1B5E9E;background:#EEF4FC;border:1px solid #B5D0EF;padding:2px 7px;border-radius:10px;white-space:nowrap}
.mono{font-variant-numeric:tabular-nums;white-space:nowrap;font-size:11px;color:#55504A}
.dash-cal .mw-hero{margin-top:0}
.dash-cal .mw-sub{color:rgba(255,255,255,.78)}
.dash-cal .mw-cal-day-panel .mw-sub{color:#55504A}
.bti{width:28px;height:28px;border-radius:5px;border:1px solid #E2DDD4;background:#fff;color:#55504A;display:flex;align-items:center;justify-content:center;font-size:13px;cursor:pointer}
.bti:hover{background:#F3F0EA;border-color:#CEC8BB}
.btp{padding:5px 13px;background:#1A304A;color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif}
.btp:hover{background:#253E60}
.btg{padding:4px 11px;background:none;border:1px solid #E2DDD4;color:#55504A;border-radius:5px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif}
.btg:hover{border-color:#1A304A;color:#1A304A}
.btd{padding:4px 11px;background:none;border:1px solid #EFBAB0;color:#B32E1E;border-radius:5px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif}
.bts{padding:2px 8px;font-size:11px;border-radius:4px;border:1px solid #E2DDD4;background:#fff;color:#55504A;cursor:pointer;font-family:'DM Sans',sans-serif}
.bts:hover{border-color:#1A304A;color:#1A304A}
.card{background:#fff;border:1px solid #E2DDD4;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.06),0 4px 12px rgba(0,0,0,.04)}
.badge{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;white-space:nowrap}
.badge::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}
.bcomp{background:#EAF5EE;color:#1A6A3C;border:1px solid #A8DEB8}
.bip{background:#EEF4FC;color:#1B5E9E;border:1px solid #B5D0EF}
.bov{background:#FCECEA;color:#B32E1E;border:1px solid #EFBAB0}
.bup{background:#F5F3EE;color:#6A6560;border:1px solid #E2DDD4}
.bpa{background:#FDF3E8;color:#AE6418;border:1px solid #E8C490}
.fbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px;padding:8px 10px;background:#F3F0EA;border:1px solid #E2DDD4;border-radius:6px}
.fbar label{font-size:10px;font-weight:600;color:#96918A;text-transform:uppercase;letter-spacing:.4px}
.fbar select,.fbar .fbtn{padding:4px 8px;border:1px solid #E2DDD4;border-radius:4px;font-size:11px;background:#fff;font-family:'DM Sans',sans-serif}
.fbtn{cursor:pointer;background:#fff;color:#55504A}
.fbtn.on{background:#1A304A;color:#fff;border-color:#1A304A}
.bbl{background:#FDF3E8;color:#AE6418;border:1px solid #E8C490}
.kgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:18px}
.kcard{background:#fff;border:1px solid #E2DDD4;border-radius:8px;padding:14px 16px;position:relative;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.kcard::before{content:"";position:absolute;top:0;left:0;width:3px;height:100%;background:var(--acc,#CEC8BB)}
.pgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
.pcard{background:#fff;border:1px solid #E2DDD4;border-radius:8px;padding:13px;display:flex;gap:11px;align-items:center;cursor:pointer;transition:all .15s}
.pcard:hover{border-color:#CEC8BB;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.dg2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
.rag-section{margin-bottom:20px;padding:0;overflow:visible}
.rag-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 18px 12px;border-bottom:1px solid #E2DDD4}
.rag-title{font-size:20px;font-weight:600;color:#1A304A;margin:0}
.rag-sub{font-size:12px;color:#55504A;margin:4px 0 0;line-height:1.45}
.rag-legend{display:flex;flex-wrap:wrap;gap:10px 14px;font-size:10px;color:#55504A;text-transform:uppercase;letter-spacing:.35px}
.rag-leg-item{display:inline-flex;align-items:center;gap:5px}
.rag-leg-swatch{width:12px;height:12px;border-radius:2px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}
.rag-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:12px 14px;background:#F8F6F1;border-bottom:1px solid #E2DDD4}
.rag-metric{background:#fff;border:1px solid #E2DDD4;border-radius:6px;padding:10px 12px;border-left:3px solid #CEC8BB}
.rag-metric-l{font-size:9px;text-transform:uppercase;letter-spacing:.55px;color:#96918A;margin-bottom:4px}
.rag-metric-v{font-size:22px;font-weight:600;font-family:'Cormorant Garamond',serif;line-height:1}
.rag-metric-s{font-size:10px;color:#96918A;margin-top:2px}
.rag-scroll{overflow-x:auto;padding:0 0 4px}
.rag-table{width:100%;border-collapse:separate;border-spacing:0;min-width:960px}
.rag-th-proj,.rag-td-proj{position:sticky;left:0;z-index:3;background:#fff;min-width:148px;max-width:180px;border-right:1px solid #E2DDD4;box-shadow:2px 0 6px rgba(0,0,0,.04)}
.rag-th-proj{padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#96918A;text-align:left;border-bottom:1px solid #E2DDD4;background:#F3F0EA}
.rag-th-phase{padding:8px 6px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.35px;color:#55504A;text-align:center;border-bottom:1px solid #E2DDD4;background:#F3F0EA;vertical-align:bottom;min-width:72px;max-width:88px}
.rag-th-text{display:block;line-height:1.25}
.rag-td-proj{padding:6px 8px;border-bottom:1px solid #E2DDD4;vertical-align:middle}
.rag-td-cell{padding:5px;border-bottom:1px solid #E2DDD4;text-align:center;vertical-align:middle}
.rag-proj-btn{display:block;width:100%;text-align:left;border:none;background:transparent;cursor:pointer;padding:6px 8px;border-radius:4px;font-family:'DM Sans',sans-serif}
.rag-proj-btn:hover{background:#F3F0EA}
.rag-proj-name{display:block;font-size:12px;font-weight:600;color:#1A304A;line-height:1.3}
.rag-proj-meta{display:block;font-size:10px;color:#96918A;margin-top:2px}
.rag-cell{display:flex;align-items:center;justify-content:center;width:100%;min-width:56px;height:44px;border-radius:4px;border:2px solid transparent;cursor:pointer;position:relative;transition:transform .12s,box-shadow .12s;font-family:inherit;padding:0}
.rag-cell:hover{transform:scale(1.06);box-shadow:0 4px 14px rgba(0,0,0,.18);z-index:2}
.rag-cell-pct{font-size:11px;font-weight:700;color:rgba(255,255,255,.95);text-shadow:0 1px 2px rgba(0,0,0,.25)}
.rag-cell-flag{position:absolute;top:4px;right:4px;width:7px;height:7px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px #B32E1E}
.rag-na .rag-cell-pct{display:none}
.rag-tooltip{position:fixed;z-index:600;max-width:300px;padding:12px 14px;background:#1A304A;color:#fff;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.28);font-size:12px;line-height:1.45;pointer-events:none;font-family:'DM Sans',sans-serif}
.rag-tt-title{font-size:13px;font-weight:600;margin-bottom:6px;color:#C89A3A}
.rag-tt-phase{display:block;font-size:11px;font-weight:400;color:rgba(255,255,255,.65);margin-top:2px}
.rag-tt-rag{font-size:11px;font-weight:600;margin-bottom:8px}
.rag-tt-k{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:rgba(255,255,255,.5);margin-bottom:3px}
.rag-tt-v{font-size:12px;font-weight:500;margin-bottom:2px}
.rag-tt-meta{font-size:11px;color:rgba(255,255,255,.72)}
.rag-tt-block{margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12)}
.rag-tt-issue-flag .rag-tt-v{color:#FFB4A8}
.rag-tt-foot{margin-top:10px;font-size:10px;color:rgba(255,255,255,.55)}
.rag-tt-row{margin-bottom:6px;font-size:11px}
@media(max-width:900px){.rag-metrics{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.rag-metrics{grid-template-columns:1fr}}
.mywork{margin:0 auto;max-width:min(1320px,100%);padding:0 16px 32px;box-sizing:border-box}
.mw-hero{background:linear-gradient(135deg,#1A304A 0%,#253E60 55%,#3d5a7a 100%);border-radius:12px;padding:22px 24px 20px;margin-bottom:18px;color:#fff;box-shadow:0 4px 24px rgba(26,48,74,.18)}
.mw-hero-inner{margin-bottom:18px}
.mw-eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:rgba(255,255,255,.55);margin:0 0 6px}
.mw-title{font-size:clamp(1.75rem,5vw,2.35rem);font-weight:600;margin:0;line-height:1.1;color:#fff}
.mw-sub{font-size:13px;line-height:1.5;color:rgba(255,255,255,.78);margin:10px 0 0;max-width:52em}
.mw-signed{font-size:12px;color:rgba(255,255,255,.6);margin:10px 0 0}
.mw-signed strong{color:#E8D4A0}
.mw-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
.mw-stat{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:12px 10px;text-align:center}
.mw-stat-n{display:block;font-size:26px;font-weight:600;line-height:1;color:#fff}
.mw-stat-l{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:rgba(255,255,255,.55);margin-top:4px}
.mw-stat-risk{border-color:rgba(179,46,30,.45);background:rgba(179,46,30,.15)}
.mw-stat-risk .mw-stat-n{color:#FFB4A8}
.mw-stat-today{border-color:rgba(200,154,58,.4);background:rgba(200,154,58,.12)}
.mw-stat-today .mw-stat-n{color:#E8D4A0}
.mw-toolbar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:14px 18px;padding:14px 16px;margin-bottom:18px}
.mw-toolbar-field{display:flex;flex-direction:column;gap:4px;min-width:min(100%,220px)}
.mw-toolbar-status{flex:1 1 100%;min-width:min(100%,320px)}
.mw-toolbar-field label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.45px;color:#96918A}
.mw-select{padding:10px 12px;border:1.5px solid #E2DDD4;border-radius:6px;font-size:14px;font-family:'DM Sans',sans-serif;min-height:44px;background:#fff;max-width:100%}
.mw-check{display:flex;align-items:center;gap:8px;font-size:12px;color:#55504A;cursor:pointer;min-height:44px}
.mw-toolbar-hint{font-size:11px;color:#96918A;line-height:1.4;flex:1;min-width:200px}
.mw-timeline{display:flex;flex-direction:column;gap:16px}
.mw-group-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid var(--mw-g,#1A304A)}
.mw-group-title{font-size:15px;font-weight:600;color:#1A304A;margin:0;font-family:'Cormorant Garamond',serif}
.mw-group-hint{font-size:11px;color:#96918A;margin:2px 0 0}
.mw-group-count{font-size:12px;font-weight:700;color:#fff;background:var(--mw-g,#1A304A);min-width:28px;height:28px;border-radius:999px;display:flex;align-items:center;justify-content:center;padding:0 8px}
.mw-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
.mw-row{padding:8px 10px 8px 8px;background:#fff;border:1px solid #E2DDD4;border-radius:8px;border-left:3px solid var(--mw-accent,#1A304A);box-shadow:0 1px 2px rgba(0,0,0,.04)}
.mw-row-top{display:flex;align-items:flex-start;gap:8px 10px;min-width:0}
.mw-row-date{flex:0 0 58px;display:flex;flex-direction:column;gap:0;line-height:1.15;padding-top:1px}
.mw-row-date-val{font-size:13px;font-weight:700;color:#1A304A;font-family:'DM Sans',sans-serif;white-space:nowrap}
.mw-row-date-lbl{font-size:8px;text-transform:uppercase;letter-spacing:.35px;color:#96918A}
.mw-row-late{font-size:9px;font-weight:700;color:#B32E1E;line-height:1.2}
.mw-row-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.mw-row-line1{display:flex;flex-wrap:wrap;align-items:center;gap:5px 8px;min-width:0}
.mw-proj-link{border:none;background:none;padding:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.35px;color:#1B5E9E;cursor:pointer;font-family:'DM Sans',sans-serif;flex-shrink:0}
.mw-proj-link:hover{text-decoration:underline;color:#1A304A}
.mw-row-badge{font-size:9px;padding:2px 6px;flex-shrink:0}
.mw-task-name{font-size:13px;font-weight:600;color:#1A1815;line-height:1.25;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mw-row-line2{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:10px;line-height:1.3;min-width:0}
.mw-phase{padding:1px 6px;border-radius:3px;border:1px solid;font-weight:600;font-size:9px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mw-dept-tag{font-size:9px;color:#55504A;background:#F3F0EA;padding:1px 6px;border-radius:3px;white-space:nowrap}
.mw-loc{color:#96918A;white-space:nowrap}
.mw-row-extra{color:#6A6560;white-space:nowrap}
.mw-row-extra::before{content:'·';margin-right:6px;color:#C4BEB6}
.mw-row-extra:first-of-type::before{content:none;margin:0}
.mw-row-preview{font-size:11px;color:#55504A;margin:0;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mw-row-preview strong{font-weight:600;color:#96918A;font-size:9px;text-transform:uppercase;margin-right:4px}
.mw-row-preview-cmt{color:#6A6560}
.mw-row-preview-cmt::before{content:' — ';color:#C4BEB6}
.mw-expand-btn{flex:0 0 auto;margin:0;padding:5px 10px;border:1px solid #C5D9ED;border-radius:6px;background:#F5F9FD;color:#1B5E9E;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;align-self:flex-start}
.mw-expand-btn:hover{background:#E8F1FA}
.mw-editor{margin-top:8px;padding-top:8px;border-top:1px solid #E2DDD4;display:flex;flex-direction:column;gap:8px}
.mw-ed-lbl{display:flex;flex-direction:column;gap:4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:#96918A}
.mw-ed-actions{display:flex;flex-wrap:wrap;gap:8px}
.mw-filter-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,200px),1fr));gap:12px;width:100%}
.mw-scope{border:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;width:100%}
.mw-scope legend{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.45px;color:#96918A;width:100%;margin-bottom:2px}
.mw-projects-compact{width:100%;border:1px solid #E2DDD4;border-radius:8px;padding:6px 10px;background:#FAFAF8}
.mw-projects-compact summary{font-size:11px;font-weight:600;color:#55504A;cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px}
.mw-projects-compact summary::-webkit-details-marker{display:none}
.mw-projects-compact[open]{padding-bottom:8px}
.mw-proj-toolbar{display:flex;gap:6px;margin:8px 0 6px}
.mw-proj-mini-btn{padding:3px 8px;border:1px solid #D8D3C8;border-radius:6px;background:#fff;font-size:10px;font-weight:600;color:#55504A;cursor:pointer;font-family:'DM Sans',sans-serif}
.mw-proj-mini-btn:hover{background:#F3F0EA}
.mw-proj-chips{display:flex;flex-wrap:wrap;gap:4px;max-height:72px;overflow:auto}
.mw-proj-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;border:1px solid #E2DDD4;background:#fff;font-size:10px;cursor:pointer;user-select:none;line-height:1.3}
.mw-proj-chip.on{background:#EEF4FC;border-color:#1B5E9E;color:#1A304A}
.mw-proj-chip input{accent-color:#1A304A;width:12px;height:12px;margin:0}
.mw-level-wrap{width:100%;margin-top:2px;padding-top:12px;border-top:1px solid #E8E4DC;display:flex;flex-direction:column;gap:10px}
.mw-level-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;min-width:0}
.mw-level-label{flex:0 0 auto;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.45px;color:#96918A;min-width:72px}
.mw-level-tabs{display:inline-flex;padding:3px;border-radius:8px;background:#F3F0EA;border:1px solid #E2DDD4;gap:2px}
.mw-level-tab{padding:7px 14px;border:none;border-radius:6px;background:transparent;color:#55504A;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;transition:background .15s,color .15s,box-shadow .15s;line-height:1.2}
.mw-level-tab:hover{color:#1A304A;background:rgba(255,255,255,.55)}
.mw-level-tab.on{background:#fff;color:#1A304A;box-shadow:0 1px 4px rgba(26,48,74,.12)}
.mw-level-hint{font-size:11px;color:#96918A;line-height:1.35;flex:1;min-width:140px}
.mw-dept-row{align-items:flex-start}
.mw-dept-filters{display:flex;flex-wrap:wrap;gap:6px;flex:1;min-width:0}
.mw-dept-pill{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;border:1px solid #E2DDD4;background:#fff;color:#55504A;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;transition:border-color .15s,background .15s,box-shadow .15s;line-height:1.2;max-width:100%}
.mw-dept-pill:hover{border-color:#C5D9ED;background:#FAFCFF}
.mw-dept-pill.on{background:linear-gradient(135deg,#EEF4FC,#E8F1FA);border-color:#1B5E9E;color:#1A304A;box-shadow:0 1px 3px rgba(27,94,158,.12)}
.mw-dept-pill.dim{opacity:.72}
.mw-dept-pill-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:min(180px,42vw)}
.mw-dept-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#F3F0EA;color:#1A304A;font-size:10px;font-weight:700;line-height:1}
.mw-dept-pill.on .mw-dept-count{background:rgba(27,94,158,.12)}
.mw-dept-risk{font-size:9px;font-weight:700;color:#B32E1E;background:#FDECEA;padding:2px 6px;border-radius:999px;white-space:nowrap}
.tcc-timeline{align-items:stretch;text-align:left;width:100%}
.tcc-entry{text-align:left;width:100%;box-sizing:border-box}
.tcc-entry-text{text-align:left}
.tcc-empty{text-align:left}
#root{text-align:left}
.ams{position:relative;display:inline-block;min-width:100px}
.ams-compact{min-width:90px}
.ams-trigger{display:flex;align-items:center;gap:4px;width:100%;min-height:36px;padding:4px 8px;border:1px solid #E2DDD4;border-radius:6px;background:#fff;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:11px;text-align:left}
.ams-trigger:disabled{opacity:.6;cursor:not-allowed}
.ams-placeholder{color:#96918A}
.ams-chips-inline{display:flex;flex-wrap:wrap;gap:3px;flex:1;min-width:0}
.ams-chip{background:#EEF4FC;color:#1A304A;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ams-more{font-size:10px;color:#96918A}
.ams-caret{color:#96918A;font-size:10px;flex-shrink:0}
.ams-menu{position:absolute;top:calc(100% + 4px);left:0;z-index:50;min-width:min(260px,90vw);max-height:min(280px,50vh);overflow:auto;background:#fff;border:1px solid #E2DDD4;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:8px}
.ams-menu-portal{position:fixed;max-height:min(280px,50vh)}
.ams-menu-hint{font-size:10px;color:#96918A;padding:4px 8px 8px}
.ams-filter{padding:0 2px 8px}
.ams-filter-inp{width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid #E2DDD4;border-radius:6px;font-size:12px;font-family:'DM Sans',sans-serif}
.ams-opt{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:12px}
.ams-opt:hover{background:#F8F6F1}
.ams-opt.on{background:#EEF4FC}
.ams-opt input{accent-color:#1A304A;min-width:16px;min-height:16px}
.ams-empty{font-size:11px;color:#96918A;padding:8px}
.ams-clear{display:block;width:100%;margin-top:6px;padding:8px;border:none;background:#F3F0EA;color:#55504A;font-size:11px;border-radius:6px;cursor:pointer}
.ttable .tcol-who{overflow:visible}
.mw-empty{text-align:center;padding:40px 24px}
.mw-empty-icon{width:56px;height:56px;border-radius:50%;background:#EAF5EE;color:#1A6A3C;font-size:28px;line-height:56px;margin:0 auto 14px;font-weight:700}
.mw-empty h2{font-size:22px;color:#1A304A;margin:0 0 8px}
.mw-empty p{color:#55504A;font-size:13px;margin:0;max-width:360px;margin-left:auto;margin-right:auto}
.mw-cta{display:inline-flex;align-items:center;gap:8px;padding:12px 18px;border-radius:8px;background:linear-gradient(135deg,#1A304A,#253E60);color:#fff;text-decoration:none;font-size:13px;font-weight:600;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;box-shadow:0 2px 12px rgba(26,48,74,.2)}
.mw-cta:hover{filter:brightness(1.08)}
@media(max-width:768px){
  .mw-hero{padding:18px 16px}
  .mw-stats{grid-template-columns:repeat(2,1fr)}
  .mw-stats .mw-stat:nth-child(5){grid-column:1/-1}
  .mw-toolbar{flex-direction:column;align-items:stretch}
  .mw-toolbar-hint{min-width:0}
  .mw-row-top{flex-wrap:wrap}
  .mw-row-date{flex:0 0 auto;flex-direction:row;align-items:baseline;gap:6px}
  .mw-task-name{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .mw-expand-btn{margin-left:auto}
  .mw-filter-grid{grid-template-columns:1fr}
  .mw-level-label{min-width:100%}
  .mw-level-hint{min-width:0}
  .mw-dept-pill-name{max-width:min(140px,55vw)}
}
.stabs{display:flex;border-bottom:1.5px solid #E2DDD4;margin-bottom:18px}
.stab{padding:7px 15px;border:none;background:none;color:#55504A;font-size:12px;font-weight:500;cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-1.5px;transition:all .15s;font-family:'DM Sans',sans-serif}
.stab.act{color:#1A304A;border-bottom-color:#1A304A;font-weight:600}
.proj-page{display:flex;flex-direction:column;gap:20px;--pj-accent:#1A304A}
.main.main-proj{padding-top:18px;max-width:1280px}
.pj-hero{position:relative;background:#fff;border:1px solid rgba(26,48,74,.08);border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(26,48,74,.07),0 1px 3px rgba(0,0,0,.04)}
.pj-hero-bg{position:absolute;inset:0;background:linear-gradient(135deg,rgba(26,48,74,.04) 0%,rgba(200,154,58,.06) 45%,rgba(255,255,255,0) 70%);pointer-events:none}
.pj-hero-bg::after{content:"";position:absolute;top:-40%;right:-8%;width:min(420px,55vw);height:min(420px,55vw);border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--pj-accent) 12%,transparent) 0%,transparent 70%)}
.pj-hero-body{position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:28px;padding:24px 26px 16px;flex-wrap:wrap}
.pj-hero-main{flex:1;min-width:min(100%,280px)}
.pj-hero-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.pj-tag{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.45px;padding:4px 10px;border-radius:999px;background:rgba(26,48,74,.06);color:#55504A;border:1px solid rgba(26,48,74,.08)}
.pj-tag-status{background:color-mix(in srgb,var(--pj-accent) 12%,#fff);color:var(--pj-accent);border-color:color-mix(in srgb,var(--pj-accent) 25%,transparent)}
.pj-tag-loc{text-transform:none;letter-spacing:0;font-weight:500;font-size:11px}
.pj-hero-title{margin:0;font-family:'Cormorant Garamond',serif;font-size:clamp(1.75rem,4vw,2.25rem);font-weight:600;color:#1A304A;line-height:1.1;letter-spacing:-.01em}
.pj-hero-sub{margin:8px 0 0;font-size:13px;color:#55504A;line-height:1.45}
.pj-hero-ko{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-top:16px;padding-top:14px;border-top:1px solid rgba(226,221,212,.8)}
.pj-hero-ko label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#96918A}
.pj-ko-input{padding:8px 12px;border:1px solid #E2DDD4;border-radius:8px;font-size:13px;font-family:'DM Sans',sans-serif;color:#1A1815;background:#FAFAF8;min-height:40px}
.pj-ko-input:focus{outline:none;border-color:#C89A3A;box-shadow:0 0 0 3px rgba(200,154,58,.18)}
.pj-hero-ko-hint{font-size:11px;color:#96918A}
.pj-hero-aside{display:flex;align-items:center;gap:18px;flex-shrink:0;flex-wrap:wrap}
.pj-ring-wrap{position:relative;flex-shrink:0}
.pj-ring-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}
.pj-ring-pct{font-family:'Cormorant Garamond',serif;font-size:1.65rem;font-weight:700;color:#1A304A}
.pj-ring-sub{font-size:9px;text-transform:uppercase;letter-spacing:.55px;color:#96918A;margin-top:2px}
.pj-stat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;min-width:168px}
.pj-stat{padding:10px 12px;border-radius:10px;border:1px solid #E2DDD4;background:#FAFAF8;text-align:center}
.pj-stat-val{display:block;font-family:'Cormorant Garamond',serif;font-size:1.35rem;font-weight:700;line-height:1;color:#1A304A}
.pj-stat-lbl{display:block;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.45px;color:#96918A;margin-top:3px}
.pj-stat-done{border-color:#A8DEB8;background:#F4FBF6}
.pj-stat-done .pj-stat-val{color:#1A6A3C}
.pj-stat-active{border-color:#B5D0EF;background:#F7FAFD}
.pj-stat-active .pj-stat-val{color:#1B5E9E}
.pj-stat-late{border-color:#EFBAB0;background:#FEF8F7}
.pj-stat-late .pj-stat-val{color:#B32E1E}
.pj-stat-up .pj-stat-val{color:#6A6560}
.pj-hero-foot{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 26px 16px;border-top:1px solid rgba(226,221,212,.65);background:rgba(248,246,241,.5);flex-wrap:wrap}
.pj-hero-foot-hint{font-size:11px;color:#96918A}
.pj-hero-actions{display:flex;flex-wrap:wrap;gap:8px}
.pj-btn{padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;font-family:'DM Sans',sans-serif;cursor:pointer;border:1px solid transparent;transition:background .15s,border-color .15s,box-shadow .15s}
.pj-btn-ghost{background:#fff;border-color:#E2DDD4;color:#1A304A}
.pj-btn-ghost:hover{border-color:var(--pj-accent);box-shadow:0 2px 8px rgba(26,48,74,.08)}
.pj-btn-danger{background:#fff;border-color:#EFBAB0;color:#B32E1E}
.pj-btn-danger:hover{background:#FCECEA}
.pj-workspace{background:#fff;border:1px solid rgba(26,48,74,.08);border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(26,48,74,.05)}
.pj-tabs{display:flex;gap:0;padding:0 8px;background:linear-gradient(180deg,#FAFAF8 0%,#F5F3EE 100%);border-bottom:1px solid #E2DDD4;overflow-x:auto;-webkit-overflow-scrolling:touch}
.pj-tab{margin:0;padding:14px 18px;border:none;background:transparent;color:#55504A;font-size:13px;font-weight:500;font-family:'DM Sans',sans-serif;cursor:pointer;border-bottom:2.5px solid transparent;white-space:nowrap;transition:color .15s,border-color .15s}
.pj-tab:hover{color:#1A304A}
.pj-tab-active{color:#1A304A;font-weight:600;border-bottom-color:var(--pj-accent)}
.pj-workspace-body{padding:18px 20px 22px}
.alloc-panel{padding:0}
.alloc-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;margin-bottom:10px}
.alloc-title{margin:0;font-size:16px;font-weight:600;color:#1A304A}
.alloc-meta{margin:4px 0 0;font-size:12px;color:#96918A}
.alloc-hint{margin:0 0 16px;font-size:12px;color:#55504A;line-height:1.5}
.alloc-toggle{display:flex;align-items:center;gap:8px;font-size:12px;color:#1A304A;cursor:pointer}
.alloc-table-wrap{overflow:auto;border:1px solid #E2DDD4;border-radius:10px;background:#fff}
.alloc-table{width:100%;border-collapse:collapse;font-size:12px}
.alloc-table th{position:sticky;top:0;background:#F3F0EA;text-align:left;padding:10px 12px;border-bottom:1px solid #E2DDD4;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#96918A;white-space:nowrap}
.alloc-table td{padding:10px 12px;border-bottom:1px solid #EAE6DC;vertical-align:middle;color:#1A1815}
.alloc-row:hover td{background:#FBF9F5}
.alloc-role{font-weight:600;color:#1A304A;display:flex;align-items:center;gap:6px}
.alloc-expand{border:none;background:none;cursor:pointer;color:#96918A;padding:0 2px;font-size:11px;line-height:1}
.alloc-warn{font-weight:700;color:#B45309}
.alloc-muted{color:#96918A}
.alloc-current{max-width:180px;word-break:break-word}
.alloc-picker{min-width:160px}
.alloc-actions{display:flex;gap:6px;flex-wrap:wrap;white-space:nowrap}
.alloc-apply{padding:6px 12px;font-size:11px}
.alloc-overwrite{padding:6px 10px;font-size:11px}
.alloc-detail-row td{background:#FAFAF8;padding:0 12px 12px}
.alloc-task-list{list-style:none;margin:0;padding:8px 0 0;display:flex;flex-direction:column;gap:6px}
.alloc-task-list li{display:grid;grid-template-columns:minmax(120px,22%) 1fr minmax(100px,20%);gap:10px;font-size:11px;padding:6px 8px;background:#fff;border:1px solid #E2DDD4;border-radius:6px}
.alloc-task-phase{color:#96918A}
.alloc-task-name{color:#1A304A;font-weight:500}
.alloc-task-who{color:#55504A;text-align:right}
.alloc-foot{margin-top:16px;padding-top:14px;border-top:1px solid #E2DDD4}
.alloc-empty{padding:40px 20px;text-align:center;color:#55504A}
.alloc-empty h3{margin:0 0 8px;color:#1A304A}
.alloc-empty p{margin:0;font-size:13px;line-height:1.55;max-width:480px;margin-inline:auto}
.alloc-toggle input{margin:0}
.alloc-modes{display:flex;gap:6px;margin-bottom:18px;border-bottom:1px solid #E2DDD4;padding-bottom:0}
.alloc-mode{padding:10px 16px;border:none;background:none;color:#55504A;font-size:13px;font-weight:600;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-1px;font-family:'DM Sans',sans-serif;transition:all .15s}
.alloc-mode:hover{color:#1A304A;background:rgba(26,48,74,.04);border-radius:8px 8px 0 0}
.alloc-mode.act{color:#1A304A;border-bottom-color:#C89A3A;font-weight:700}
.alloc-head-cell{white-space:nowrap;color:#55504A}
.alloc-head-cards{display:flex;flex-direction:column;gap:12px}
.alloc-head-card{border:1px solid #E2DDD4;border-radius:10px;background:#fff;padding:14px 16px}
.alloc-head-card h4{margin:0 0 4px;font-size:14px;color:#1A304A}
.alloc-head-card-meta{margin:0 0 6px;font-size:12px;color:#96918A}
.alloc-head-card-person{margin:0 0 12px;font-size:12px;color:#55504A}
.alloc-head-card-actions{display:flex;flex-wrap:wrap;gap:8px}
.alloc-task-list-card{margin-top:12px;padding-top:12px;border-top:1px dashed #E2DDD4}
.alloc-modes{display:flex;gap:6px;margin-bottom:18px;border-bottom:1px solid #E2DDD4;padding-bottom:0}
.alloc-mode{padding:10px 16px;border:none;background:none;color:#55504A;font-size:13px;font-weight:600;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-1px;font-family:'DM Sans',sans-serif;transition:all .15s}
.alloc-mode:hover{color:#1A304A;background:rgba(26,48,74,.04);border-radius:8px 8px 0 0}
.alloc-mode.act{color:#1A304A;border-bottom-color:#C89A3A;font-weight:700}
.alloc-head-cell{white-space:nowrap;color:#55504A}
.alloc-head-cards{display:flex;flex-direction:column;gap:12px}
.alloc-head-card{border:1px solid #E2DDD4;border-radius:10px;background:#fff;padding:14px 16px}
.alloc-head-card h4{margin:0 0 4px;font-size:14px;color:#1A304A}
.alloc-head-card-meta{margin:0 0 6px;font-size:12px;color:#96918A}
.alloc-head-card-person{margin:0 0 12px;font-size:12px;color:#55504A}
.alloc-head-card-actions{display:flex;flex-wrap:wrap;gap:8px}
.alloc-task-list-card{margin-top:12px;padding-top:12px;border-top:1px dashed #E2DDD4}
.alloc-foot{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.tasks-view{display:flex;flex-direction:column;gap:16px}
.tasks-filters-card{background:#F8F6F1;border:1px solid #E2DDD4;border-radius:12px;padding:14px 16px}
.tasks-filters-card .fbar{margin-bottom:0;background:#fff;border:1px solid #E2DDD4;padding:12px 14px;border-radius:10px;box-shadow:none}
.tasks-toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:linear-gradient(180deg,#fff 0%,#FAFAF8 100%);border:1px solid #E2DDD4;border-radius:12px}
.tasks-toolbar-tip{font-size:12px;color:#55504A;line-height:1.5;flex:1;min-width:200px;margin:0}
.tasks-toolbar-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.tasks-toolbar-actions .btg{border-radius:8px;padding:7px 12px;font-size:12px;font-weight:500}
.phases-stack{display:flex;flex-direction:column;gap:14px}
.ps{background:#fff;border:1px solid #E2DDD4;border-radius:12px;overflow:hidden;transition:box-shadow .15s,border-color .15s;box-shadow:0 1px 4px rgba(0,0,0,.03);border-left:4px solid var(--phase-accent,#CEC8BB)}
.ps.ps-drag-over{box-shadow:0 -3px 0 0 #C89A3A inset;border-color:#C89A3A}
.psh{padding:14px 16px;background:linear-gradient(180deg,#FDFCFA 0%,#F5F3EE 100%);border-bottom:1px solid #E2DDD4;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;gap:12px}
.psh-left{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:1;min-width:0}
.ps-phase-name{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.ps-dept{font-size:10px;color:#55504A;background:#fff;border:1px solid #E2DDD4;padding:3px 10px;border-radius:999px;font-weight:500}
.ps-meta{font-size:11px;color:#96918A;font-weight:500}
.ps-actions{display:flex;gap:6px;flex-shrink:0;align-items:center}
.ps-actions .bts{border-radius:8px;padding:5px 12px}
.ps-complete-all{color:#1A6A3C;border-color:#A8D5B5;font-weight:600}
.ps-complete-all:hover{background:#EAF5EE;border-color:#1A6A3C}
.ps-all-done{font-size:11px;color:#1A6A3C;font-weight:600;padding:5px 10px;white-space:nowrap}
.ppbar{height:4px;background:#E2DDD4;border-radius:999px;width:88px;overflow:hidden;display:inline-block;vertical-align:middle}
.ppfill{height:100%;border-radius:999px;transition:width .25s ease}
.ttable{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;table-layout:fixed}
.ttable thead th{position:sticky;top:0;z-index:2;background:#F5F3EE;box-shadow:0 1px 0 #E2DDD4}
.ttable th{padding:10px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#6A6560;text-align:left;border-bottom:1px solid #E2DDD4;white-space:nowrap;font-family:'DM Sans',sans-serif;font-weight:700}
.ttable td{padding:8px 10px;border-bottom:1px solid rgba(226,221,212,.65);vertical-align:middle;overflow:hidden}
.ttable .tcol-drag{width:28px;padding-left:6px;padding-right:4px;overflow:visible}
.ttable .tcol-num{width:30px;text-align:center;color:#6A6560}
.ttable .tcol-task{width:auto;min-width:0;overflow:visible}
.ttable .tcol-start{width:132px}
.ttable .tcol-dur{width:64px}
.ttable .tcol-end{width:88px}
.ttable .tcol-who{width:128px}
.ttable .tcol-status{width:132px}
.ttable .tcol-comments{width:140px}
.ttable .tcol-del{width:40px;overflow:visible}
.trow:nth-child(even) td{background:#FDFCFA}
.trow:hover td{background:#FBF7EE!important}
.trow.trow-drag-over td{background:#FBF7EE!important;border-top:2px solid #C89A3A}
.trow-sub td{background:#FAFAF8}
.ttree-cell{display:flex;align-items:center;gap:4px;min-width:0;max-width:100%}
.ttree-indent{flex-shrink:0;height:1px}
.ttree-branch{flex-shrink:0;width:12px;color:#C4BEB6;font-size:11px;line-height:1;user-select:none}
.ttree-toggle{flex:0 0 auto;width:22px;height:22px;border-radius:6px;border:1px solid #E2DDD4;background:#fff;color:#55504A;font-size:11px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}
.ttree-toggle:hover{border-color:#C89A3A;background:#FBF7EE;color:#1A304A}
.ttree-toggle-spacer{flex:0 0 auto;width:22px;height:22px}
.ttree-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.ttree-name-row{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:nowrap}
.ttree-name-row .ec{flex:1 1 auto;min-width:0;max-width:100%}
.ttree-parent-tag{font-size:9px;font-weight:700;color:#9A6E20;background:#FBF7EE;border:1px solid #E8D4A0;border-radius:999px;padding:1px 6px;white-space:nowrap;align-self:flex-start}
.di-ro,.ni-ro{opacity:.85;background:#F5F3EE;color:#55504A;cursor:default}
.abt-sub{color:#1A5A30;font-weight:700;flex:0 0 auto;width:26px;min-width:26px;height:26px;padding:0;font-size:14px;line-height:1}
.abt-sub:hover{background:#EAF5EE;border-color:#A7D4B5;color:#145226}
.ec{border-radius:8px;padding:5px 8px;outline:none;font-size:13px;font-weight:500;font-family:'DM Sans',sans-serif;cursor:text;line-height:1.35;color:#1A1815;border:1.5px solid transparent;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ec:hover{background:#F3F0EA}
.ec:focus{outline:none;border-color:#C89A3A;background:#fff;box-shadow:0 0 0 3px rgba(200,154,58,.12);white-space:normal;overflow:visible}
.di,.ni{padding:6px 8px;border:1px solid #E2DDD4;border-radius:8px;background:#FAFAF8;font-size:12px;outline:none;font-family:'DM Sans',sans-serif;box-sizing:border-box;max-width:100%}
.di{width:100%;max-width:122px}.ni{width:100%;max-width:54px}
.di:focus,.ni:focus{border-color:#C89A3A;box-shadow:0 0 0 3px rgba(200,154,58,.12)}
.status-wrap{display:inline-flex;align-items:center;gap:4px;padding:2px;border-radius:8px}
.status-wrap-completed{background:#EAF5EE}
.status-wrap-inprogress{background:#EEF4FC}
.status-wrap-overdue{background:#FCECEA}
.status-wrap-notstarted,.status-wrap-upcoming{background:#F5F3EE}
.status-wrap-paused{background:#FDF3E8}
.status-sel{padding:6px 10px;border-radius:6px;border:1px solid transparent;background:transparent;font-size:11px;font-weight:700;font-family:'DM Sans',sans-serif;min-width:108px;cursor:pointer}
.status-sel:focus{outline:none;box-shadow:0 0 0 2px rgba(26,48,74,.12)}
.tcol-comments{min-width:100px;white-space:nowrap}
.tcol-count{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 7px;border-radius:999px;background:#FBF7EE;border:1px solid #E8D4A0;font-size:10px;font-weight:700;color:#9A6E20;margin-right:6px;vertical-align:middle}
.tact{display:flex;gap:4px}
.abt{width:28px;height:28px;border-radius:8px;border:1px solid #E2DDD4;background:#fff;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;color:#55504A;transition:background .12s,border-color .12s}
.abt:hover{background:#F3F0EA;border-color:#CEC8BB}
.abt.del:hover{background:#FCECEA;border-color:#EFBAB0;color:#B32E1E}
.bts{padding:5px 11px;font-size:11px;border-radius:8px;border:1px solid #E2DDD4;background:#fff;color:#55504A;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600;transition:all .12s}
.bts:hover{border-color:#1A304A;color:#1A304A;background:#F8F6F1}
.btg-on{background:var(--pj-accent,#1A304A)!important;color:#fff!important;border-color:var(--pj-accent,#1A304A)!important}
.clv-panel{margin-top:4px;border-radius:12px;border:1px solid #E2DDD4;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.04)}
.clv-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 18px;background:linear-gradient(180deg,#FAFAF8 0%,#F3F0EA 100%);border-bottom:1px solid #E2DDD4;flex-wrap:wrap}
.clv-title{margin:0;font-size:14px;font-weight:700;color:#1A304A;letter-spacing:.02em;text-transform:none}
.clv-table thead th{background:#F5F3EE}
.pjhdr-v2,.stabs-v2,.pjhdr,.stabs,.tasks-filters-card.old{display:none}
.pdrag,.tdrag{cursor:grab;color:#96918A;font-size:14px;line-height:1;user-select:none;touch-action:none}
.pdrag{padding:0 4px 0 0;flex-shrink:0}
.tdrag{padding:0 2px}
.pdrag:active,.tdrag:active{cursor:grabbing}
.tdrag.tdrag-off{opacity:.35;cursor:not-allowed}
.cexp td{padding:14px 16px !important;background:#FBF7EE !important;vertical-align:top}
.cexp-panel{padding:14px 16px;background:#FBF7EE;border-top:1px solid #E2DDD4;box-sizing:border-box;width:100%;max-width:100%;overflow-x:hidden}
.cexp-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.cexp-head-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#C89A3A;flex:1;min-width:0;line-height:1.35}
.cexp-close{flex-shrink:0;min-height:36px}
.tcol-comments{min-width:140px;max-width:220px}
.tcol-cmt-preview{display:flex;flex-direction:column;gap:2px;margin-bottom:6px;min-width:0}
.tcol-cmt-author{font-size:10px;font-weight:600;color:#1A304A}
.tcol-cmt-text{font-size:10px;color:#55504A;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tcol-cmt-empty{font-size:10px;color:#C4BEB6;font-style:italic;margin-bottom:6px;display:block}
.tcc-consolidated{border-top:1px solid #E2DDD4;background:#F8F6F1;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.tcc-consolidated-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:2px}
.tcc-consolidated-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#1A304A}
.tcc-consolidated-meta{font-size:10px;color:#96918A}
.tcc-card{background:#fff;border:1px solid #E2DDD4;border-radius:8px;overflow:hidden;box-sizing:border-box;max-width:100%}
.tcc-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 12px;background:#FBF7EE;border-bottom:1px solid #E2DDD4;flex-wrap:wrap}
.tcc-card-main{flex:1;min-width:0}
.tcc-card-seq{font-size:10px;font-weight:700;color:#96918A;margin-right:6px}
.tcc-card-name{font-size:13px;font-weight:600;color:#1A304A;line-height:1.35}
.tcc-card-meta{font-size:10px;color:#96918A;margin-top:3px;display:flex;flex-wrap:wrap;gap:6px}
.tcc-card-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
.tcc-card-count{font-size:10px;font-weight:600;color:#9A6E20;background:#FBF7EE;border:1px solid #E8D4A0;border-radius:999px;padding:2px 8px}
.tcc-card-body{padding:10px 12px 12px}
.tcc-editor{margin-top:12px;padding-top:12px;border-top:1px dashed #E2DDD4}
.tcc-empty{font-size:12px;color:#96918A;font-style:italic;margin:0}
.tcc-timeline{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;text-align:left;align-items:stretch;width:100%}
.tcc-timeline-compact{gap:6px}
.tcc-entry{background:#FAFAF8;border:1px solid #E2DDD4;border-radius:6px;padding:9px 10px;border-left:3px solid #C89A3A}
.tcc-entry-flag{border-left-color:#B32E1E;background:#FDF8F8}
.tcc-entry-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:4px}
.tcc-entry-author{font-size:11px;font-weight:600;color:#1A304A}
.tcc-entry-time{font-size:10px;color:#96918A;margin-left:auto}
.tcc-entry-badge{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.35px;color:#B32E1E;background:#FCECEA;border-radius:3px;padding:1px 5px}
.tcc-entry-text{font-size:12px;color:#1A1815;line-height:1.5;margin:0 0 6px;white-space:pre-wrap;word-break:break-word}
.tcc-entry-next{font-size:11px;color:#1A304A;line-height:1.45;padding:6px 8px;background:#EEF4FC;border-radius:5px;margin-bottom:4px}
.tcc-entry-next-lbl{font-weight:700;margin-right:6px;text-transform:uppercase;font-size:9px;letter-spacing:.35px;color:#1B5E9E}
.tcc-entry-next-due{color:#55504A;margin-left:6px}
.tcc-entry-meta{font-size:10px;color:#1B5E9E;margin-top:4px;line-height:1.4}
.tcc-entry-meta-err{color:#B32E1E}
.clv-meta{margin:4px 0 0;font-size:11px;color:#96918A}
.clv-toggle{display:flex;align-items:center;gap:6px;font-size:11px;color:#55504A;cursor:pointer;user-select:none}
.clv-toggle input{accent-color:#1A304A}
.clv-empty{margin:0;padding:16px 14px;font-size:12px;color:#96918A;font-style:italic}
.clv-wrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
.clv-table{width:100%;border-collapse:collapse;min-width:680px}
.clv-table th{padding:7px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#96918A;text-align:left;border-bottom:1px solid #E2DDD4;background:#FAFAF8;white-space:nowrap}
.clv-table td{padding:8px 10px;border-bottom:1px solid rgba(0,0,0,.05);vertical-align:top;font-size:12px;color:#1A1815}
.clv-row:hover td{background:#FBF7EE}
.clv-phase{font-size:11px;color:#55504A;max-width:140px}
.clv-num{text-align:center;color:#96918A;font-size:11px}
.clv-task{min-width:160px;max-width:220px}
.clv-task-name{display:block;font-weight:600;color:#1A304A;line-height:1.35}
.clv-task-due{display:block;font-size:10px;color:#96918A;margin-top:2px}
.clv-st{font-size:11px;white-space:nowrap}
.clv-who{font-size:11px;color:#55504A;max-width:120px;word-break:break-word}
.clv-comments{min-width:280px;max-width:480px}
.clv-cmt-lines{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.clv-cmt-line{display:flex;flex-direction:column;gap:2px;padding:6px 8px;background:#FAFAF8;border-left:2px solid #C89A3A;border-radius:0 4px 4px 0}
.clv-cmt-line-flag{border-left-color:#B32E1E;background:#FDF8F8}
.clv-cmt-meta{font-size:10px;color:#96918A}
.clv-cmt-meta strong{color:#1A304A;font-weight:600}
.clv-cmt-flag{margin-left:6px;font-size:9px;font-weight:700;color:#B32E1E;text-transform:uppercase}
.clv-cmt-text{font-size:11px;color:#1A1815;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.clv-cmt-next{font-size:10px;color:#1B5E9E;line-height:1.4}
.clv-no-cmt{font-size:11px;color:#C4BEB6;font-style:italic}
.clv-act{white-space:nowrap;text-align:right}
.clv-expand td{padding:0!important;background:#FBF7EE!important;border-bottom:1px solid #E2DDD4!important}
.clv-expand-inner{padding:12px 14px;max-width:min(520px,100%);box-sizing:border-box}
.clv-expand-lbl{font-size:11px;font-weight:600;color:#9A6E20;margin-bottom:10px;text-transform:uppercase;letter-spacing:.4px}
.cexp-inner{width:100%;max-width:min(480px,100%);box-sizing:border-box;min-width:0}
.cform{display:flex;flex-direction:column;gap:12px;width:100%;max-width:min(480px,100%);min-width:0}
.cform-context{margin-bottom:12px;padding:12px 14px;background:#F8F6F1;border-radius:10px;border:1px solid #EAE6DC}
.cform-context-proj{font-size:17px;font-weight:700;color:#1A304A;line-height:1.25;letter-spacing:-.01em}
.cform-context-phase{font-size:15px;font-weight:600;color:#55504A;margin-top:5px;line-height:1.3}
.cform-context-assignee{font-size:13px;font-weight:600;color:#1B5E9E;margin-top:8px;line-height:1.35}
.cform-context-assignee-empty{color:#96918A;font-weight:500}
.cform-assignee-picker{display:flex;flex-direction:column;gap:5px}
.cform-assignee-picker .ams{display:block;width:100%}
.cform-assignee-picker .ams-trigger{min-height:40px;font-size:12px}
.cform-assignee-field{display:flex;flex-direction:column;gap:6px;margin:0 0 12px}
.cform-assignee-hint{font-size:10px;color:#96918A;line-height:1.35}
.cform-complete{display:flex;align-items:flex-start;gap:10px;margin:4px 0 2px;padding:10px 12px;background:#EAF5EE;border:1px solid #C5E0CF;border-radius:8px;cursor:pointer;font-size:12px;color:#1A304A;line-height:1.35}
.cform-complete input{margin-top:2px;width:16px;height:16px;accent-color:#1A6A3C;flex-shrink:0}
.cform-complete strong{display:block;font-size:13px}
.cform-complete-hint{display:block;font-size:11px;color:#55504A;margin-top:2px;font-weight:400}
.cform-complete-done{font-size:11px;color:#1A6A3C;font-weight:600;margin:0 0 8px;padding:6px 10px;background:#EAF5EE;border-radius:6px}
.cform-meta{font-size:11px;color:#55504A;line-height:1.45;word-break:break-word}
.cform-field{display:flex;flex-direction:column;gap:4px;margin:0}
.cform-lbl{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.45px;color:#96918A}
.cform-lbl-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.cform-mic{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid #E2DDD4;border-radius:999px;background:#fff;color:#1A304A;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;line-height:1.2;flex-shrink:0}
.cform-mic:hover:not(:disabled){border-color:#C89A3A;background:#FBF7EE}
.cform-mic-on{border-color:#B32E1E;background:#FCECEA;color:#B32E1E;animation:cform-mic-pulse 1.4s ease-in-out infinite}
.cform-mic-off{opacity:.45;cursor:not-allowed}
.cform-mic:disabled{opacity:.5;cursor:not-allowed}
.cform-mic-lbl{font-size:10px;letter-spacing:.02em}
.cform-mic-hint{margin:2px 0 0;font-size:11px;color:#9A6E20;font-weight:500}
@keyframes cform-mic-pulse{0%,100%{box-shadow:0 0 0 0 rgba(179,46,30,.25)}50%{box-shadow:0 0 0 4px rgba(179,46,30,.12)}}
.cform-inp,.cform-textarea{width:100%;max-width:100%;box-sizing:border-box;padding:10px 11px;border:1.5px solid #E2DDD4;border-radius:6px;background:#fff;font-size:16px;font-family:'DM Sans',sans-serif;color:#1A1815}
.cform-inp:focus,.cform-textarea:focus{outline:none;border-color:#C89A3A;box-shadow:0 0 0 2px rgba(200,154,58,.2)}
.cform-inp-date{min-height:44px}
.cform-textarea{resize:vertical;min-height:88px;line-height:1.45}
.cform-foot{display:flex;justify-content:flex-end;padding-top:2px}
.cform-foot .btp{min-height:44px;padding:10px 20px;font-size:13px}
.cform-rich{max-width:min(480px,100%);min-width:0}
.cform-compact .cform-inp,.cform-compact .cform-textarea{font-size:13px;padding:8px 10px;line-height:1.4}
.cform-compact .cform-inp-date{min-height:38px}
.cform-compact .cform-textarea{min-height:72px}
.cform-compact .cform-lbl{font-size:9px}
.cform-compact .cform-meta{font-size:10px;margin-bottom:6px}
.cform-compact .cform-foot .btp{min-height:38px;padding:8px 16px;font-size:12px}
.cform-section{margin-top:14px;padding-top:14px;border-top:1px solid #E2DDD4}
.cform-section-title{margin:0 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#1A304A;font-family:'DM Sans',sans-serif}
.tcc-history{margin:0 0 14px;max-height:min(42vh,320px);overflow-y:auto;padding-right:2px}
.tcc-history-title{margin:0 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#1A304A;display:flex;align-items:center;gap:8px;font-family:'DM Sans',sans-serif}
.tcc-history-count{font-size:10px;font-weight:600;color:#96918A;background:#F3F0EA;border-radius:999px;padding:2px 8px}
.tcc-timeline-v2{gap:10px}
.tcc-timeline-v2 .tcc-entry{padding:10px 12px;border-radius:8px}
.tcc-entry-latest{border-left-color:#1A304A;background:#F8FAFD;box-shadow:0 1px 3px rgba(26,48,74,.06)}
.tcc-entry-seq{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.35px;color:#96918A;background:#F3F0EA;padding:2px 7px;border-radius:999px;flex-shrink:0}
.tcc-entry-latest .tcc-entry-seq{color:#1A304A;background:#EEF4FC}
.tcc-entry-next-text{font-weight:500}
.dash-cal-proj-search{min-height:40px}
.mw-cal-drawer .tcc-history{flex:1 1 auto;min-height:100px;max-height:min(40vh,300px)}
.mw-cal-drawer .cform-section{flex-shrink:0}
.mw-cal-drawer .cform-rich{max-width:100%}
.c-email-meta{font-size:10px;color:#1B5E9E;margin-top:6px}
.att-pick{margin-top:4px;padding:10px 12px;background:#F8F6F1;border:1px dashed #E2DDD4;border-radius:8px;max-width:100%;min-width:0;box-sizing:border-box}
.att-pick-compact{padding:8px 10px}
.att-pick-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px}
.att-pick-title{font-size:11px;font-weight:600;color:#1A304A}
.att-pick-add{padding:6px 12px;border-radius:6px;border:1px solid #1B5E9E;background:#fff;color:#1B5E9E;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif}
.att-pick-add:hover{background:#EEF4FC}
.att-pick-input{display:none}
.att-pick-hint{font-size:10px;color:#96918A;margin:0 0 8px;line-height:1.4}
.att-pick-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.att-pick-item{display:flex;align-items:flex-start;gap:8px;padding:8px;background:#fff;border:1px solid #E2DDD4;border-radius:6px}
.att-pick-fields{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.att-pick-meta{font-size:10px;color:#96918A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.att-pick-rm{border:none;background:transparent;color:#B32E1E;font-size:14px;cursor:pointer;padding:4px;line-height:1}
.att-pick-empty{font-size:11px;color:#96918A;margin:0;font-style:italic}
.att-links{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.att-link{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;background:#EEF4FC;border:1px solid #C5D9ED;color:#1B5E9E;font-size:11px;font-weight:600;text-decoration:none}
.att-link:hover{background:#dbeafe}
.nrp{margin-top:4px;padding:10px 12px;background:#fff;border:1px solid #E2DDD4;border-radius:8px;max-width:100%;min-width:0;box-sizing:border-box}
.nrp-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-bottom:8px}
.nrp-title{font-size:11px;font-weight:700;color:#1A304A}
.nrp-ok{font-size:10px;color:#1A6A3C}
.nrp-warn{font-size:10px;color:#AE6418}
.nrp-link{border:none;background:none;color:#1B5E9E;font-size:10px;font-weight:600;cursor:pointer;text-decoration:underline;padding:0;font-family:'DM Sans',sans-serif}
.nrp-group{margin-bottom:8px}
.nrp-group-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:4px}
.nrp-group-title{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:#96918A}
.nrp-group-hint{font-size:10px;color:#C4BEB6}
.nrp-chips{display:flex;flex-wrap:wrap;gap:5px}
.nrp-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:999px;border:1px solid #E2DDD4;background:#FAFAF8;font-size:11px;cursor:pointer;user-select:none}
.nrp-chip.on{background:#EEF4FC;border-color:#1B5E9E}
.nrp-chip.dim{opacity:.55}
.nrp-chip input{accent-color:#1A304A}
.nrp-no-email{font-size:9px;color:#AE6418}
.nrp-loading,.nrp-err,.nrp-empty{font-size:11px;color:#96918A;margin:0}
.nrp-err{color:#B32E1E}
.nrp-auto-banner{font-size:11px;line-height:1.45;padding:8px 10px;background:#EEF4FC;border:1px solid #C5D9ED;border-radius:6px;color:#1A304A;margin-bottom:4px;word-break:break-word;overflow-wrap:anywhere}
.nrp-auto-banner strong{color:#1B5E9E}
.nrp-auto-names{color:#55504A;font-weight:400}
.nrp-auto-warn{background:#FDF3E8;border-color:#E8C490;color:#AE6418}
.nrp-extras{margin-top:0}
.task-files{margin:10px 0;padding:10px 12px;background:#fff;border:1px solid #E2DDD4;border-radius:8px;max-width:100%;min-width:0;box-sizing:border-box}
.task-files-head{margin-bottom:8px}
.task-files-title{font-size:11px;font-weight:700;color:#1A304A;display:block}
.task-files-sub{font-size:10px;color:#96918A}
.mw-editor-wrap{margin-top:8px;padding-top:8px;border-top:1px solid #E2DDD4;max-width:100%;overflow-x:hidden;box-sizing:border-box}
.mw-comment-history{margin-bottom:12px}
.mw-comment-history-title{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#9A6E20;margin-bottom:8px}
.mw-ch-item{margin-bottom:7px}
.st-filter{display:inline-flex;flex-wrap:wrap;gap:5px;align-items:center;max-width:min(520px,100%)}
.st-chip input{position:absolute;opacity:0;width:0;height:0}
.st-chip label{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:4px 9px;border-radius:4px;border:1px solid #E2DDD4;background:#fff;cursor:pointer;user-select:none;white-space:nowrap}
.st-chip.on label{background:#EEF4FC;border-color:#1A304A;color:#1A304A;font-weight:600}
.st-chip-clear{font-size:10px;color:#1B5E9E;background:none;border:none;cursor:pointer;padding:2px 6px;text-decoration:underline}
.mw-open-task{margin-top:8px}
.citem{background:#fff;border:1px solid #E2DDD4;border-radius:5px;padding:9px 11px;margin-bottom:7px}
.citem:last-child{margin-bottom:0}
.cinp{width:100%;padding:7px 9px;border:1px solid #E2DDD4;border-radius:5px;font-size:12px;resize:vertical;background:#fff;font-family:'DM Sans',sans-serif;min-height:52px}
.cinp:focus{outline:none;border-color:#C89A3A}
.gw{background:#fff;border:1px solid #E2DDD4;border-radius:8px;overflow:hidden}
.gsplit{display:flex;max-height:calc(100vh-310px);overflow:hidden}
.gnames{width:260px;flex-shrink:0;border-right:1.5px solid #E2DDD4;overflow-y:auto;overflow-x:hidden}
.gchart{flex:1;overflow:auto}
.gmhdr{display:flex;background:#F3F0EA;border-bottom:1px solid #E2DDD4;position:sticky;top:0;z-index:5}
.gmon{flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px;color:#96918A;text-transform:uppercase;letter-spacing:.5px;border-right:1px solid #E2DDD4;font-family:'DM Sans',sans-serif}
.gphn{height:28px;display:flex;align-items:center;padding:0 8px 0 11px;background:#F3F0EA;border-bottom:1px solid #E2DDD4;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;cursor:pointer}
.gtn{height:26px;display:flex;align-items:center;padding:0 5px 0 18px;border-bottom:1px solid rgba(0,0,0,.04);overflow:hidden}
.gtn:hover{background:#F3F0EA}
.gphc{height:28px;background:#F3F0EA;border-bottom:1px solid #E2DDD4;position:relative}
.gtc{height:26px;border-bottom:1px solid rgba(0,0,0,.04);position:relative}
.gbar{position:absolute;top:4px;bottom:4px;border-radius:3px;cursor:pointer;z-index:2;transition:filter .12s}
.gbar:hover{filter:brightness(.88)}
.gtline{position:absolute;top:0;bottom:0;width:2px;background:#C89A3A;opacity:.7;z-index:3;pointer-events:none}
.ggl{position:absolute;top:0;bottom:0;width:1px;background:rgba(0,0,0,.04);pointer-events:none}
.ri{background:#FBF7EE;border:1px solid #E8D4A0;border-radius:8px;padding:13px 16px;margin-bottom:14px}
.rc{background:#fff;border:1px solid #E2DDD4;border-radius:8px;margin-bottom:9px;overflow:hidden}
.rch{padding:11px 15px;display:flex;align-items:center;justify-content:space-between;cursor:pointer}
.rch:hover{background:#F3F0EA}
.rcbody{padding:13px 15px;border-top:1px solid #E2DDD4}
.rgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
.rdocs{margin:0;padding-left:15px}
.rdocs li{font-size:12px;color:#55504A;margin-bottom:2px}
.rnote{background:#FDF3E8;border:1px solid #E8C490;border-radius:5px;padding:8px 11px;margin-top:9px;font-size:12px;color:#AE6418}
.mb{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:500;backdrop-filter:blur(2px)}
.tcm-backdrop{position:fixed;inset:0;z-index:700;display:flex;align-items:center;justify-content:center;padding:20px 16px;background:rgba(26,48,74,.52);backdrop-filter:blur(6px);animation:tcm-fade-in .2s ease}
.tcm-dialog{position:relative;width:min(960px,100%);max-height:min(90vh,880px);display:flex;flex-direction:column;background:#fff;border-radius:14px;border:1px solid #E2DDD4;box-shadow:0 24px 80px rgba(26,48,74,.28),0 0 0 1px rgba(255,255,255,.08) inset;overflow:hidden;animation:tcm-rise .28s cubic-bezier(.22,1,.36,1)}
@keyframes tcm-fade-in{from{opacity:0}to{opacity:1}}
@keyframes tcm-rise{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
.tcm-hero{position:relative;color:#fff;flex-shrink:0;border-bottom:3px solid #C89A3A}
.tcm-hero-bg{position:absolute;inset:0;background:linear-gradient(135deg,#1A304A 0%,#253E60 45%,#2A4A6E 100%);opacity:1}
.tcm-hero-bg::after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse 80% 120% at 100% 0%,rgba(200,154,58,.22),transparent 55%)}
.tcm-hero-inner{position:relative;padding:18px 22px 16px}
.tcm-hero-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px}
.tcm-kicker{font-size:13px;font-weight:600;letter-spacing:.2px;color:rgba(255,255,255,.88);display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;line-height:1.35}
.tcm-kicker-proj{font-size:16px;font-weight:700;color:#fff;letter-spacing:-.01em}
.tcm-kicker-phase{font-size:14px;font-weight:600;color:rgba(255,255,255,.92)}
.tcm-kicker-dot{opacity:.45;font-size:12px}
.tcm-close{width:36px;height:36px;border:none;border-radius:8px;background:rgba(255,255,255,.12);color:#fff;font-size:18px;cursor:pointer;flex-shrink:0;transition:background .15s}
.tcm-close:hover{background:rgba(255,255,255,.22)}
.tcm-title{margin:0;font-size:clamp(22px,3vw,28px);font-weight:600;line-height:1.15;color:#fff}
.tcm-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center}
.tcm-chip{font-size:11px;font-weight:500;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.12);color:rgba(255,255,255,.92);border:1px solid rgba(255,255,255,.15)}
.tcm-chip-gold{background:rgba(200,154,58,.25);border-color:rgba(232,212,160,.45);color:#F5E6C8}
.tcm-chip-assignee{font-size:12px;font-weight:600;background:rgba(255,255,255,.18);border-color:rgba(255,255,255,.28)}
.tcm-chip-muted{opacity:.75;font-weight:500}
.tcm-assignee-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.14)}
.tcm-assignee-lbl{font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:rgba(255,255,255,.7);flex-shrink:0}
.tcm-assignee-row .ams{min-width:min(280px,100%);flex:1}
.tcm-assignee-row .ams-trigger{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.28);color:#fff;min-height:36px}
.tcm-assignee-row .ams-trigger:hover{background:rgba(255,255,255,.18)}
.tcm-assignee-row .ams-chip{background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.3);color:#fff}
.tcm-assignee-hint{font-size:10px;color:rgba(255,255,255,.65);line-height:1.35;width:100%}
.tcm-body{display:grid;grid-template-columns:1fr 1fr;flex:1;min-height:0;overflow:hidden}
.tcm-pane{display:flex;flex-direction:column;min-height:0;min-width:0;border-right:1px solid #E2DDD4}
.tcm-pane-compose{border-right:none;background:#FBF9F5}
.tcm-pane-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-bottom:1px solid #EAE6DC;background:#F8F6F1;flex-shrink:0;flex-wrap:wrap}
.tcm-pane-title{margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#1A304A}
.tcm-pane-hint{font-size:10px;color:#96918A}
.tcm-pane-scroll{flex:1;overflow-y:auto;padding:14px 16px 16px;min-height:120px}
.tcm-pane-scroll-compose .cform-section{margin-top:0;padding-top:0;border-top:none}
.tcm-pane-scroll .tcc-history{max-height:none;margin-bottom:0}
.tcm-mode{display:flex;gap:4px;background:#fff;border:1px solid #E2DDD4;border-radius:8px;padding:3px}
.tcm-mode-btn{border:none;background:transparent;padding:6px 12px;font-size:11px;font-weight:600;color:#55504A;border-radius:6px;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .15s}
.tcm-mode-btn.act{background:#1A304A;color:#fff;box-shadow:0 1px 4px rgba(26,48,74,.2)}
.tcm-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;border-top:1px solid #E2DDD4;background:#fff;flex-shrink:0;flex-wrap:wrap}
.tcm-foot-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.tcm-foot-note{margin:0;font-size:10px;color:#96918A;line-height:1.45;flex:1;min-width:200px}
.tcm-open-btn{white-space:nowrap;font-weight:600}
.tcm-hero .badge{background:rgba(255,255,255,.15)!important;border-color:rgba(255,255,255,.25)!important;color:#fff!important}
.mbox{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:600;background:#fff;border:1px solid #E2DDD4;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.12);width:560px;max-width:calc(100vw - 32px);max-height:80vh;display:flex;flex-direction:column}
.mbox.wide{width:700px}
.fg{margin-bottom:13px}
.fg label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#96918A;margin-bottom:4px;font-weight:600}
.fg input,.fg select,.fg textarea{width:100%;padding:7px 9px;border:1px solid #E2DDD4;border-radius:5px;font-size:13px;background:#fff;color:#1A1815;font-family:'DM Sans',sans-serif}
.fg input:focus,.fg select:focus,.fg textarea:focus{outline:none;border-color:#C89A3A}
.fgrid{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.tnav-status-hint{font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap;max-width:min(140px,32vw);overflow:hidden;text-overflow:ellipsis;line-height:1.3;flex-shrink:1;min-width:0}
.tnav-status-hint.err{color:#B32E1E;background:#FDECEA}
.tnav-status-hint.info{color:#1B5E9E;background:#EEF4FC}
.tnav-status-hint.ok{color:#1A6A3C;background:#EAF5EE}
.tnav-mongo{font-size:10px;color:#96918A;padding:0 4px;white-space:nowrap;flex-shrink:0}
.gtt{position:fixed;background:#1A304A;color:#fff;padding:9px 13px;border-radius:5px;font-size:12px;z-index:400;pointer-events:none;opacity:0;transition:opacity .12s;max-width:230px;box-shadow:0 4px 16px rgba(0,0,0,.2)}
.gtt.show{opacity:1}
.codebox{background:#12131A;color:#E8D49A;padding:13px;border-radius:5px;font-family:monospace;font-size:10.5px;line-height:1.6;max-height:210px;overflow-y:auto;white-space:pre-wrap;word-break:break-all}
.ppbar{height:3px;background:#E2DDD4;border-radius:2px;width:70px;overflow:hidden;display:inline-block;vertical-align:middle}
.ppfill{height:100%;border-radius:2px}
.tnav-brand{display:flex;align-items:center;gap:9px;flex-shrink:0}
.tnav-row{display:contents}
.tnav-menu-btn{display:none;align-items:center;justify-content:center;padding:8px 12px;border:1px solid #E2DDD4;border-radius:6px;background:#fff;color:#1A304A;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;margin-left:auto}
.ttable-wrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
.ttable-wrap .ttable{min-width:900px}
.phases-stack{display:flex;flex-direction:column;gap:12px}
.task-tip{flex:1;min-width:0}
.stabs{overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.stabs::-webkit-scrollbar{display:none}
.pjhdr-stats{text-align:right;flex-shrink:0}
@media (max-width:960px){
  .kgrid{grid-template-columns:repeat(3,1fr)}
  .pgrid{grid-template-columns:repeat(2,1fr)}
  .nact{max-width:100%}
}
@media (max-width:768px){
  .dash-reports-stats{grid-template-columns:repeat(2,1fr)}
  .dash-reports-stat.wide{grid-column:span 2}
  .tcm-body{grid-template-columns:1fr}
  .tcm-pane{border-right:none;border-bottom:1px solid #E2DDD4;max-height:min(38vh,320px)}
  .tcm-pane-compose{max-height:none}
  .tcm-backdrop{padding:12px 8px;align-items:flex-end}
  .tcm-dialog{max-height:min(92vh,100dvh - 16px);border-radius:14px 14px 10px 10px}
  .tcm-foot .btg{width:100%}
  .tnav{position:sticky;top:0;flex-direction:column;align-items:stretch;padding:10px 12px;gap:8px}
  .tnav-row{display:flex;align-items:center;width:100%;gap:8px;min-width:0}
  .tnav-brand{border-right:none;padding-right:0;margin-right:0;flex:1;min-width:0}
  .tnav-menu-btn{display:inline-flex;flex-shrink:0}
  .proj-sel-wrap{width:100%;padding:0;display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px 10px}
  .proj-picker{width:100%}
  .proj-picker .proj-search{max-width:none;width:100%;min-height:40px;font-size:13px}
  .proj-picker .proj-sel{max-width:none;width:100%;min-height:44px;font-size:14px}
.mw-nav-tab{flex-shrink:0;min-height:40px;font-weight:600}
.mw-nav-tab.act{background:#1A304A;color:#fff;border-color:#1A304A}
.proj-sel-wrap .proj-sel-lbl{width:100%}
.proj-sel-wrap .proj-sel{flex:1;min-width:0}
@media(min-width:769px){
  .proj-sel-wrap .proj-sel-lbl{width:auto}
  .proj-sel-wrap .proj-sel{flex:1;min-width:140px;max-width:280px}
}
  .proj-sel{max-width:none;width:100%;min-height:44px;font-size:14px}
  .nact{display:none;flex-direction:column;align-items:stretch;width:100%;padding:10px 0 4px;border-left:none;border-top:1.5px solid #E2DDD4;gap:10px}
  .nact.open{display:flex}
  .nact-grp{width:100%;justify-content:flex-start}
  .nact-sep{display:none}
  .file-lbl,.btg,.btp,.btp-add{min-height:44px;padding:10px 12px;font-size:13px}
  .main{margin-top:0;padding:12px 10px calc(24px + env(safe-area-inset-bottom,0px));overflow-x:hidden;max-width:100vw}
  .cexp-panel{padding:12px 10px}
  .cexp-inner,.cform,.cform-rich{max-width:100%}
  .tcc-consolidated{padding:10px 8px}
  .tcc-card-head{flex-direction:column;align-items:stretch}
  .tcc-card-actions{justify-content:flex-end}
  .tcol-comments{max-width:none}
  .clv-head{flex-direction:column}
  .clv-comments{max-width:none;min-width:200px}
  .att-pick-head{flex-direction:column;align-items:stretch}
  .att-pick-add{width:100%;text-align:center;min-height:44px}
  .nrp-auto-banner{font-size:10px;padding:6px 8px}
  .kgrid{grid-template-columns:repeat(2,1fr);gap:8px}
  .pgrid{grid-template-columns:1fr}
  .dg2{grid-template-columns:1fr}
  .fgrid{grid-template-columns:1fr}
  .rgrid{grid-template-columns:1fr}
  .pjhdr-v2{flex-direction:column;padding:16px 18px}
  .pjhdr-side{align-items:flex-start;text-align:left;width:100%}
  .pjhdr-chips,.pjhdr-actions{justify-content:flex-start}
  .pjhdr-pct{font-size:2rem}
  .stabs-v2{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
  .pj-hero-body{flex-direction:column;padding:18px 16px 12px;gap:20px}
  .pj-hero-aside{width:100%;justify-content:space-between}
  .pj-stat-grid{flex:1;min-width:0}
  .pj-hero-foot{padding:12px 16px}
  .pj-workspace-body{padding:14px 12px 18px}
  .pj-tabs{padding:0 4px}
  .pj-tab{padding:12px 14px;font-size:12px;min-height:44px}
  .tasks-toolbar{flex-direction:column;align-items:stretch}
  .tasks-toolbar-actions{justify-content:flex-start}
  .pjhdr{flex-direction:column;align-items:stretch;padding:14px 16px;gap:14px}
  .pjhdr-stats{text-align:left}
  .pjhdr-stats .disp{font-size:32px}
  .pjhdr-actions{justify-content:flex-start!important}
  .stabs{margin-bottom:14px}
  .stab{padding:10px 14px;font-size:13px;min-height:44px;white-space:nowrap}
  .psh{flex-wrap:wrap;gap:8px;padding:12px}
  .task-tip{display:none}
  .tact{opacity:1}
  .bts,.btg{min-height:40px;min-width:40px}
  .abt{min-height:32px;min-width:32px}
  .abt-sub{min-height:28px;min-width:28px;width:28px}
  .di{width:100%;max-width:140px}
  .ni{width:100%;max-width:64px}
  .ttable-wrap .ttable{min-width:860px}
  .gsplit{flex-direction:column;max-height:none}
  .gnames{width:100%;max-height:min(220px,35vh);border-right:none;border-bottom:1.5px solid #E2DDD4}
  .gchart{min-height:240px}
  .mbox{width:calc(100vw - 20px);max-height:min(88vh,100dvh - 24px)}
  .mbox.wide{width:calc(100vw - 20px)}
  .nact-grp .btg,.nact-grp .btp,.nact-grp .file-lbl{min-height:40px}
  .tnav-status-hint{max-width:min(100px,24vw)}
  .dash-stab{padding:10px 14px;font-size:12px}
  .disp[style*="fontSize:30"]{font-size:24px!important}
  .disp[style*="fontSize:24"]{font-size:20px!important}
  .disp[style*="fontSize:40"]{font-size:32px!important}
}
@media (max-width:480px){
  .kgrid{grid-template-columns:1fr}
  .fbar{flex-direction:column;align-items:stretch}
  .fbar select,.fbar .fbtn{width:100%}
  .pcard{flex-direction:column;align-items:flex-start}
  .pch,.psh{font-size:11px}
  .pjhdr-v2{flex-direction:column;padding:16px 18px}
  .pjhdr-side{align-items:flex-start;text-align:left;width:100%}
  .pjhdr-chips{justify-content:flex-start}
  .pjhdr-actions{justify-content:flex-start}
  .stabs-v2{width:100%;overflow-x:auto}
  .tasks-toolbar{flex-direction:column;align-items:stretch}
  .tasks-toolbar-actions{justify-content:flex-start}
  .ttable-wrap .ttable{min-width:520px}
  .cexp-panel{padding:10px 8px}
  .cform-foot .btp{width:100%}
  .att-pick-item{flex-wrap:wrap}
}
`;

function ActionFilters({
  horizonDays,
  setHorizonDays,
  statusFilters,
  setStatusFilters,
  assigneeFilter,
  setAssigneeFilter,
  assignees,
  departmentFilter,
  setDepartmentFilter,
  departments,
  roleFilter,
  setRoleFilter,
  roleOptions,
  showHorizon = true,
  allowAllHorizon = false,
}) {
  return (
    <div className="fbar">
      {showHorizon && (
        <>
          <label>Actions in</label>
          {allowAllHorizon && (
            <button type="button" className={`fbtn${horizonDays == null ? ' on' : ''}`} onClick={() => setHorizonDays(null)}>
              All
            </button>
          )}
          {[7, 15, 30].map((n) => (
            <button key={n} type="button" className={`fbtn${horizonDays === n ? ' on' : ''}`} onClick={() => setHorizonDays(n)}>
              {n} days
            </button>
          ))}
        </>
      )}
      <label style={{ marginLeft: showHorizon ? 8 : 0 }}>Status</label>
      <StatusFilterChips value={statusFilters} onChange={setStatusFilters} />
      <label>Assignee</label>
      <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
        <option value="">All</option>
        <option value={UNASSIGNED_FILTER}>No Assignee</option>
        {assignees.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      {departments?.length ? (
        <>
          <label>Department</label>
          <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
            <option value="">All</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </>
      ) : null}
      {roleOptions?.length ? (
        <>
          <label>Role</label>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All</option>
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {r.length > 42 ? `${r.slice(0, 40)}…` : r}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  );
}

function taskPassesFilters(t, dm, phaseName, { statusFilters, assigneeFilter, departmentFilter, departments, roleFilter, horizonDays, todayStr }) {
  if (!taskMatchesAssigneeFilter(t.who, assigneeFilter)) return false;
  if (!taskMatchesDepartment(t, phaseName, departmentFilter, departments)) return false;
  if (!taskMatchesRoleFilter(t, roleFilter)) return false;
  const st = taskStatus(t, dm);
  if (!taskMatchesStatusFilters(st, statusFilters)) return false;
  if (horizonDays != null && horizonDays > 0) {
    const d = dm[t.id];
    if (!d) return false;
    if (st === 'completed') return false;
    const dsStart = dbDays(todayStr, d.s);
    const dsEnd = dbDays(todayStr, d.e);
    const inWindow =
      (dsStart >= 0 && dsStart <= horizonDays) || (dsEnd >= 0 && dsEnd <= horizonDays);
    if (!inWindow) return false;
  }
  return true;
}

// ── NAV STATUS (replaces blocking toasts) ─────────────────
function useNavStatus(){
  const[navHint,setNavHint]=useState(null);
  const timerRef=useRef(null);
  const toast=useCallback((msg,type="")=>{
    const formatted=formatNavStatusMessage(msg,type);
    if(!formatted.show){
      if(timerRef.current)clearTimeout(timerRef.current);
      setNavHint(null);
      return;
    }
    if(timerRef.current)clearTimeout(timerRef.current);
    setNavHint(formatted);
    timerRef.current=setTimeout(()=>setNavHint(null),formatted.type==="err"?8000:4000);
  },[]);
  useEffect(()=>()=>{if(timerRef.current)clearTimeout(timerRef.current);},[]);
  return{navHint,toast};
}

// ── GANTT COMPONENT ──────────────────────────────────────
function GanttView({proj}){
  const namesRef=useRef(null);const chartRef=useRef(null);
  const[tip,setTip]=useState(null);const[tipPos,setTipPos]=useState({x:0,y:0});
  const dm=cDates(proj);
  const TW=Math.round(GDAYS*DPX);
  const todayPx=Math.round((TODAY-GS)/864e5*DPX);
  // months
  const months=[];let cur=new Date(GS);
  while(cur<=GE){const y=cur.getFullYear(),m=cur.getMonth();months.push({lbl:MON[m]+(y>2025?" "+String(y).slice(2):""),d:new Date(y,m+1,0).getDate()});cur=new Date(y,m+1,1);}
  // grid lines
  const gridLines=[];let gl=0;months.forEach((m,i)=>{gridLines.push(<div key={i} className="ggl" style={{left:gl}}/>);gl+=Math.round(m.d*DPX);});
  const TL=<div className="gtline" style={{left:todayPx}}/>;
  useEffect(()=>{
    const n=namesRef.current,c=chartRef.current;if(!n||!c)return;
    let syn=false;
    const ns=()=>{if(!syn){syn=true;c.scrollTop=n.scrollTop;syn=false;}};
    const cs=()=>{if(!syn){syn=true;n.scrollTop=c.scrollTop;syn=false;}};
    n.addEventListener("scroll",ns);c.addEventListener("scroll",cs);
    c.scrollLeft=Math.max(0,todayPx-160);
    return()=>{n.removeEventListener("scroll",ns);c.removeEventListener("scroll",cs);};
  },[todayPx]);
  const displayPhases=useMemo(()=>expandPhasesForDisplay(proj.phases),[proj.phases]);
  return(
    <div className="gw">
      <div style={{padding:"8px 13px",background:"#F3F0EA",borderBottom:"1px solid #E2DDD4",display:"flex",gap:12,fontSize:11,color:"#96918A",flexWrap:"wrap"}}>
        {Object.entries(SCOL).map(([k,v])=><span key={k}><span style={{display:"inline-block",width:8,height:8,borderRadius:2,background:v,marginRight:3,verticalAlign:"middle"}}/>{k}</span>)}
        <span style={{marginLeft:"auto",color:"#9A6E20"}}><span style={{display:"inline-block",width:2,height:12,background:"#C89A3A",marginRight:4,verticalAlign:"middle"}}/> Today</span>
      </div>
      <div className="gsplit">
        <div ref={namesRef} className="gnames">
          <div style={{height:28,background:"#F3F0EA",borderBottom:"1px solid #E2DDD4",display:"flex",alignItems:"center",padding:"0 11px",fontSize:10,textTransform:"uppercase",letterSpacing:".7px",color:"#96918A",flexShrink:0}}>Task / Phase</div>
          {displayPhases.map(ph=>{
            const treeRows=annotateTreeMeta(ph.tasks);
            return(
            <div key={ph.id}>
              <div className="gphn" style={{color:ph.col,borderLeft:`3px solid ${ph.col}`}}>{ph.name}</div>
              {treeRows.map(({task:t,depth})=>(
                <div key={t.id} className="gtn" title={t.name} style={{paddingLeft:11+Math.max(0,depth)*12}}>
                  <span style={{fontSize:11.5,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{depth>0?"└ ":""}{t.name}</span>
            </div>
          ))}
            </div>
            );
          })}
        </div>
        <div ref={chartRef} className="gchart">
          <div className="gmhdr" style={{minWidth:TW}}>
            {months.map((m,i)=><div key={i} className="gmon" style={{width:Math.round(m.d*DPX)}}>{m.lbl}</div>)}
            {TL}
          </div>
          {displayPhases.map(ph=>{
            const treeRows=annotateTreeMeta(ph.tasks);
            return(
            <div key={ph.id}>
              <div className="gphc" style={{minWidth:TW,background:ph.col+"10"}}>{gridLines}{TL}</div>
              {treeRows.map(({task:t})=>{
                const d=dm[t.id];const st=gSt(t,dm);const sc=SCOL[st]||"#9A9590";
                let bar=null;
                if(d?.s){
                  const L=Math.round((new Date(d.s)-GS)/864e5*DPX);
                  const W=Math.max(Math.round((new Date(d.e)-new Date(d.s))/864e5*DPX)+Math.round(DPX),4);
                  const dur=Math.round((new Date(d.e)-new Date(d.s))/864e5)+1;
                  bar=<div className="gbar" style={{left:L,width:W,background:sc,opacity:st==="upcoming"?.5:.82}}
                    onMouseEnter={e=>{setTip({name:t.name,s:d.s,e:d.e,dur,st});setTipPos({x:e.clientX,y:e.clientY});}}
                    onMouseMove={e=>setTipPos({x:e.clientX,y:e.clientY})}
                    onMouseLeave={()=>setTip(null)}>
                    {W>28&&<span style={{fontSize:9,padding:"0 4px",color:"rgba(255,255,255,.9)",fontWeight:600}}>{dur}d</span>}
                  </div>;
                }
                return <div key={t.id} className="gtc" style={{minWidth:TW}}>{gridLines}{TL}{bar}</div>;
              })}
            </div>
            );
          })}
        </div>
      </div>
      {tip&&<div className="gtt show" style={{left:Math.min(tipPos.x+12,window.innerWidth-240),top:Math.min(tipPos.y-10,window.innerHeight-120)}}>
        <div style={{fontWeight:600,marginBottom:5,fontSize:12.5,color:"#C89A3A"}}>{tip.name}</div>
        {[["Start",fmt(tip.s)],["End",fmt(tip.e)],["Duration",tip.dur+"d"],["Status",tip.st]].map(([k,v])=>(
          <div key={k} style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:3}}>
            <span style={{color:"rgba(255,255,255,.5)",fontSize:11}}>{k}</span>
            <span style={{fontSize:11,fontWeight:500,color:k==="Status"?(SCOL[tip.st]||"#fff"):"#fff"}}>{v}</span>
          </div>
        ))}
      </div>}
    </div>
  );
}

// ── REGULATIONS COMPONENT ────────────────────────────────
function RegView({proj,regStatus,setRegStatus}){
  const[open,setOpen]=useState({});
  const isGHQ=proj.id==="ghq";
  const smap={Pending:C.gray,Applied:C.org,Obtained:C.green,"N/A":C.tx3};
  return(
    <div>
      <div className="ri">
        <div className="disp" style={{fontSize:16,fontWeight:600,color:C.navy,marginBottom:4}}>Regulatory Reference — {proj.name}, {proj.loc}</div>
        <p style={{fontSize:12,color:C.tx2,lineHeight:1.6}}>
          {isGHQ?"Statutory approvals for a 33-floor Grade-A commercial tower in PCMC, Maharashtra. Based on applicable legislation as of 2025."
            :`Regulatory requirements for ${proj.type} in ${proj.loc}.`}
          <span style={{color:C.tx3,fontSize:11,display:"block",marginTop:3}}>Click ▾ to expand. Status dropdowns are saved.</span>
        </p>
      </div>
      {REGS.map(r=>{
        const saved=regStatus[proj.id+"_"+r.id]||"Pending";
        return(
          <div key={r.id} className="rc">
            <div className="rch" onClick={()=>setOpen(p=>({...p,[r.id]:!p[r.id]}))}>
              <div style={{display:"flex",alignItems:"center",gap:9,flex:1,minWidth:0}}>
                <span style={{padding:"2px 7px",borderRadius:3,fontSize:10,fontWeight:600,textTransform:"uppercase",background:r.cc+"20",color:r.cc,border:`1px solid ${r.cc}50`,flexShrink:0}}>{r.cat}</span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:C.navy}}>{r.title}</div>
                  <div style={{fontSize:11,color:C.tx3,marginTop:1}}>{r.auth}</div>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0,marginLeft:12}}>
                <select className="bts" style={{color:smap[saved]||C.gray}} onClick={e=>e.stopPropagation()}
                  onChange={e=>{e.stopPropagation();setRegStatus(p=>({...p,[proj.id+"_"+r.id]:e.target.value}));}}>
                  {["Pending","Applied","Obtained","N/A"].map(s=><option key={s} value={s} style={{color:smap[s]}}>{s}</option>)}
                </select>
                <span style={{color:C.tx3,fontSize:12}}>{open[r.id]?"▲":"▾"}</span>
              </div>
            </div>
            {open[r.id]&&<div className="rcbody">
              <div className="rgrid">
                <div><div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".5px",color:C.tx3,marginBottom:3}}>Governing Act</div><div style={{fontSize:12,color:C.tx,lineHeight:1.5}}>{r.act}</div></div>
                <div><div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".5px",color:C.tx3,marginBottom:3}}>Timeline</div><div style={{fontSize:12,color:C.tx}}>⏱ {r.tl}</div></div>
                <div style={{gridColumn:"1/-1"}}><div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".5px",color:C.tx3,marginBottom:3}}>Applicability</div><div style={{fontSize:12,color:C.tx,lineHeight:1.5}}>{r.ap}</div></div>
              </div>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".5px",color:C.tx3,marginBottom:5}}>Key Documents Required</div>
              <ul className="rdocs">{r.docs.map((d,i)=><li key={i}>{d}</li>)}</ul>
              {r.note&&<div className="rnote"><strong>⚑ Note:</strong> {r.note}</div>}
            </div>}
          </div>
        );
      })}
    </div>
  );
}

// ── TASKS VIEW ───────────────────────────────────────────
function phaseExpandKey(projId,phId){return`${projId}:${phId}`;}

function truncateText(text, max = 72) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function TasksView({proj,dispatch,toast,departments,loginUser,assigneeRoster}){
  const dm=useMemo(()=>cDates(proj),[proj.id,proj.ko,proj.phases]);
  const[commentTarget,setCommentTarget]=useState(null);
  const[expandedPh,setExpandedPh]=useState({});
  const[expandedTasks,setExpandedTasks]=useState({}); // false = collapsed; missing/true = expanded
  const[showCommentsConsolidated,setShowCommentsConsolidated]=useState(true);
  const[showOnlyWithComments,setShowOnlyWithComments]=useState(true);
  const[dragTask,setDragTask]=useState(null);
  const[dragOverId,setDragOverId]=useState(null);
  const[dragPhase,setDragPhase]=useState(null);
  const[dragOverPhId,setDragOverPhId]=useState(null);
  const[horizonDays,setHorizonDays]=useState(null);
  const[statusFilters,setStatusFilters]=useState([]);
  const[assigneeFilter,setAssigneeFilter]=useState("");
  const[departmentFilter,setDepartmentFilter]=useState("");
  const[roleFilter,setRoleFilter]=useState("");
  const assignees=useMemo(()=>collectAssignees([proj]),[proj]);
  const roleOptions=useMemo(()=>collectAllRoles([proj]),[proj]);
  const displayPhases=useMemo(()=>expandPhasesForDisplay(proj.phases),[proj.phases]);
  const todayStr=todayIso();
  const filters={statusFilters,assigneeFilter,departmentFilter,departments,roleFilter,horizonDays,todayStr};
  const filtersActive=!!(statusFilters.length||assigneeFilter||departmentFilter||roleFilter||horizonDays!=null);
  const expandAll=()=>{
    const nextPh={};
    const nextTasks={};
    displayPhases.forEach(ph=>{
      nextPh[phaseExpandKey(proj.id,ph.id)]=true;
      annotateTreeMeta(ph.tasks).forEach(({task:t,hasChildren})=>{
        if(hasChildren) nextTasks[t.id]=true;
      });
    });
    setExpandedPh(nextPh);
    setExpandedTasks(nextTasks);
  };
  const collapseAll=()=>{
    const nextPh={};
    const nextTasks={};
    displayPhases.forEach(ph=>{
      nextPh[phaseExpandKey(proj.id,ph.id)]=false;
      annotateTreeMeta(ph.tasks).forEach(({task:t,hasChildren})=>{
        if(hasChildren) nextTasks[t.id]=false;
      });
    });
    setExpandedPh(nextPh);
    setExpandedTasks(nextTasks);
  };
  const toggleTaskExpand=(tId)=>{
    setExpandedTasks(prev=>{
      const open=prev[tId]!==false;
      return {...prev,[tId]:!open};
    });
  };
  const dropReorder=(ph,fromId,toId)=>{
    if(!fromId||!toId||fromId===toId)return;
    dispatch({type:"reorderTask",projId:proj.id,phId:realPhaseId(ph),fromId,toId});
    toast("Task order updated","ok");
  };
  const dropReorderPhase=(fromId,toId)=>{
    if(!fromId||!toId||fromId===toId)return;
    dispatch({type:"reorderPhase",projId:proj.id,fromId,toId});
    toast("Section order updated","ok");
  };
  const authorName=loginUser?.ready?(loginUser.name||"User"):"";
  const openCommentModal=(ph,task)=>setCommentTarget({ph,task});
  const closeCommentModal=()=>setCommentTarget(null);
  const statusLabelFor=(v)=>TASK_STATUS_OPTIONS.find(o=>o.value===v)?.label||v;
  const notifyStatus=(ph,t,oldVal,newVal)=>{
    if(!oldVal||oldVal===newVal||!authorName)return;
    void notifyTaskStatusChange({
      projectId:proj.id,
      taskId:t.id,
      projectName:proj.name,
      phaseName:ph.name,
      taskWho:t.who,
      taskName:t.name,
      author:authorName,
      oldLabel:statusLabelFor(oldVal),
      newLabel:statusLabelFor(newVal),
    },toast);
  };
  return(
    <div className="tasks-view">
      <div className="tasks-filters-card">
        <ActionFilters horizonDays={horizonDays} setHorizonDays={setHorizonDays} statusFilters={statusFilters} setStatusFilters={setStatusFilters} assigneeFilter={assigneeFilter} setAssigneeFilter={setAssigneeFilter} assignees={assignees} departmentFilter={departmentFilter} setDepartmentFilter={setDepartmentFilter} departments={departments} roleFilter={roleFilter} setRoleFilter={setRoleFilter} roleOptions={roleOptions} allowAllHorizon/>
      </div>
      <div className="tasks-toolbar">
        <p className="tasks-toolbar-tip">Drag ⋮⋮ to reorder · ▸/▾ expands subtasks · ⊞ adds a subtask · Parent dates follow first→last subtask · {filtersActive?"Clear filters to enable drag reorder":"Expand phases to edit tasks"}</p>
        <div className="tasks-toolbar-actions">
          <button type="button" className={`btg${showCommentsConsolidated?" btg-on":""}`} onClick={()=>setShowCommentsConsolidated(v=>!v)} title="Show comment list for filtered tasks">{showCommentsConsolidated?"Comments on":"Show comments"}</button>
          <button type="button" className="btg" onClick={expandAll}>Expand all</button>
          <button type="button" className="btg" onClick={collapseAll}>Collapse all</button>
          <button className="btg" onClick={()=>dispatch({type:"addPhase",projId:proj.id})}>+ Phase</button>
          <button className="btg" onClick={()=>{
            const dm2=cDates(proj);let csv="Phase,Parent_ID,Task ID,Task,Start,End,Dur,Assignee,Status,Comments\n";
            proj.phases.forEach(ph=>orderTasksAsTree(ph.tasks).forEach(t=>{
              if(!taskPassesFilters(t,dm2,ph.name,filters))return;
              const d=dm2[t.id]||{s:"",e:""};
              const cm=sortCommentsChronologically(t.comments).map(({comment:c})=>formatCommentLine(c)).join(" | ");
              csv+=`"${ph.name}","${taskParentId(t)||""}","${t.id}","${t.name}","${d.s}","${d.e}","${t.dur}","${t.who||""}","${statusLabel(taskStatus(t,dm2))}","${cm.replace(/"/g,'""')}"\n`;
            }));
            const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=proj.name.replace(/\s+/g,"_")+"_Schedule.csv";a.click();toast("CSV exported","ok");
          }}>Export CSV</button>
        </div>
      </div>
      <div className="phases-stack">
      {displayPhases.map((ph,pi)=>{
        const sourcePhId=realPhaseId(ph);
        const byId=indexTasksById(ph.tasks);
        const treeRows=annotateTreeMeta(ph.tasks)
          .filter(({task:t})=>taskPassesFilters(t,dm,ph.name,filters))
          .filter(({task:t})=>!isHiddenByCollapsedAncestor(t,byId,expandedTasks));
        const visible=treeRows.map((r)=>r.task);
        if(departmentFilter&&visible.length===0)return null;
        const comp=visible.filter(t=>taskStatus(t,dm)==="completed").length;
        const pct=visible.length?Math.round(comp/visible.length*100):0;
        const ek=phaseExpandKey(proj.id,ph.id);
        const isOpen=expandedPh[ek]!==false;
        const dept=getDepartmentForPhase(ph._section==="design"?"Design & Team Appointments":ph._section==="approval"?"Regulatory Approvals":ph.name,departments);
        const isPhDragOver=dragOverPhId===sourcePhId&&dragPhase?.phId&&dragPhase.phId!==sourcePhId;
        return(
          <div key={ph.id} className={`ps${isPhDragOver?" ps-drag-over":""}${ph._section?` ps-section-${ph._section}`:""}`} style={{"--phase-accent":ph.col||"#CEC8BB"}}
            onDragOver={e=>{if(!dragPhase||dragPhase.phId===sourcePhId)return;e.preventDefault();e.dataTransfer.dropEffect="move";setDragOverPhId(sourcePhId);}}
            onDragLeave={()=>{if(dragOverPhId===sourcePhId)setDragOverPhId(null);}}
            onDrop={e=>{
              e.preventDefault();
              setDragOverPhId(null);
              if(!dragPhase||dragPhase.phId===sourcePhId)return;
              dropReorderPhase(dragPhase.phId,sourcePhId);
              setDragPhase(null);
            }}
          >
            <div className="psh" onClick={()=>setExpandedPh(p=>({...p,[ek]:!isOpen}))}>
              <div className="psh-left">
                <span className="pdrag" draggable={!ph._section} title="Drag section to reorder"
                  onClick={e=>e.stopPropagation()}
                  onDragStart={e=>{if(ph._section){e.preventDefault();return;}e.stopPropagation();setDragPhase({phId:sourcePhId});e.dataTransfer.effectAllowed="move";}}
                  onDragEnd={()=>{setDragPhase(null);setDragOverPhId(null);}}
                >⋮⋮</span>
                <span className="ps-meta" aria-hidden>{isOpen?"▾":"▸"}</span>
                <span className="ps-phase-dot" style={{width:9,height:9,borderRadius:"50%",background:ph.col,flexShrink:0,display:"inline-block"}}/>
                <span className="ps-phase-name" style={{color:ph.col}}>{ph.name}</span>
                {ph._section?<span className="ps-dept" title="View section only — Mongo data unchanged">{ph._section==="design"?"Design work":"Approvals & regulatory"}</span>:null}
                {dept?<span className="ps-dept" title="Department head">{dept.name} · {dept.head}</span>:null}
                <span className="ps-meta">{visible.length}{visible.length!==ph.tasks.length?` / ${ph.tasks.length}`:""} tasks</span>
                <div className="ppbar"><div className="ppfill" style={{width:`${pct}%`,background:ph.col}}/></div>
                <span className="ps-meta">{pct}%</span>
              </div>
              <div className="ps-actions" onClick={e=>e.stopPropagation()}>
                {(()=>{
                  const incomplete=visible.filter(t=>taskStatus(t,dm)!=="completed");
                  if(!incomplete.length){
                    return visible.length>0?<span className="ps-all-done" title="All visible tasks complete">All done</span>:null;
                  }
                  return(
                    <button type="button" className="bts ps-complete-all" title={`Mark ${incomplete.length} task(s) complete`}
                      onClick={()=>{
                        const n=incomplete.length;
                        const scope=filtersActive?"visible ":"";
                        if(!confirm(`Complete all ${n} ${scope}task${n!==1?"s":""} in "${ph.name}"?`))return;
                        dispatch({type:"bulkCompletePhase",projId:proj.id,phId:sourcePhId,taskIds:incomplete.map(t=>t.id)});
                        toast(`Marked ${n} complete`,"ok");
                      }}
                    >Complete all</button>
                  );
                })()}
                <button className="bts" onClick={()=>dispatch({type:"addTask",projId:proj.id,phId:sourcePhId,afterId:null})}>+ Task</button>
                {!ph._section?<button className="bts" onClick={()=>{if(confirm(`Delete phase "${ph.name}"?`))dispatch({type:"delPhase",projId:proj.id,phId:sourcePhId});}}>✕</button>:null}
              </div>
            </div>
            {isOpen&&<div className="ttable-wrap"><table className="ttable">
              <thead><tr>
                <th className="tcol-drag" aria-label="Reorder"/>
                <th className="tcol-num">#</th>
                <th className="tcol-task">Task / subtask</th>
                <th className="tcol-start">Start</th>
                <th className="tcol-dur">Dur</th>
                <th className="tcol-end">End</th>
                <th className="tcol-who">Assignee</th>
                <th className="tcol-status">Status</th>
                <th className="tcol-comments">Comments</th>
                <th className="tcol-del" aria-label="Delete"/>
              </tr></thead>
              <tbody>
                {treeRows.map(({task:t,depth,hasChildren},rowIdx)=>{
                  const seqIdx=rowIdx+1;
                  const d=dm[t.id]||{s:"",e:""};const st=taskStatus(t,dm);const dueIso=currentDueIso(t,dm);const heat=dueDateHeat(dueIso,{status:st,todayStr});const od=st==="overdue"&&dueIso?dbDays(dueIso,todayStr):0;
                  const rolledUp=!!(hasChildren&&d.rolledUp);
                  const taskOpen=expandedTasks[t.id]!==false;
                  const rolledDur=rolledUp?dateSpanDays(d.s,d.e):(t.dur??"");
                  const taskComments=collectTaskComments(proj,ph,t);
                  const cc=taskComments.length;
                  const latestComment=getLatestComment(taskComments);
                  const canDrag=!filtersActive;
                  const isDragOver=dragOverId===t.id&&dragTask?.phId===ph.id;
                  return(
                    <tr key={t.id} className={`trow${depth>0?" trow-sub":""}${isDragOver?" trow-drag-over":""}`}
                      onDragOver={e=>{if(!canDrag||!dragTask||dragTask.phId!==sourcePhId)return;e.preventDefault();e.dataTransfer.dropEffect="move";setDragOverId(t.id);}}
                      onDragLeave={()=>{if(dragOverId===t.id)setDragOverId(null);}}
                      onDrop={e=>{
                        e.preventDefault();
                        setDragOverId(null);
                        if(!canDrag||!dragTask||dragTask.phId!==sourcePhId)return;
                        dropReorder(ph,dragTask.tId,t.id);
                        setDragTask(null);
                      }}
                    >
                      <td className="tcol-drag">
                        <span className={`tdrag${canDrag?"":" tdrag-off"}`} draggable={canDrag} title={canDrag?"Drag to reorder (subtree moves together)":"Clear filters to reorder"}
                          onDragStart={e=>{if(!canDrag){e.preventDefault();return;}setDragTask({phId:sourcePhId,tId:t.id});e.dataTransfer.effectAllowed="move";}}
                          onDragEnd={()=>{setDragTask(null);setDragOverId(null);}}
                        >⋮⋮</span>
                      </td>
                      <td className="tcol-num">{seqIdx}</td>
                      <td className="tcol-task">
                        <div className="ttree-cell">
                          <span className="ttree-indent" style={{width:Math.max(0,depth)*14}} aria-hidden/>
                          {hasChildren?(
                            <button type="button" className="ttree-toggle" aria-expanded={taskOpen} title={taskOpen?"Collapse subtasks":"Expand subtasks"}
                              onClick={(e)=>{e.stopPropagation();toggleTaskExpand(t.id);}}
                            >{taskOpen?"▾":"▸"}</button>
                          ):(
                            <span className="ttree-toggle-spacer" aria-hidden>{depth>0?"└":""}</span>
                          )}
                          <div className="ttree-main">
                            <div className="ttree-name-row">
                              <div className="ec" contentEditable suppressContentEditableWarning
                                onBlur={e=>dispatch({type:"updTask",projId:proj.id,phId:sourcePhId,tId:t.id,f:"name",v:e.target.textContent.trim()})}
                                onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();e.target.blur();}}}
                              >{t.name}</div>
                              <button type="button" className="abt abt-sub" aria-label="Add subtask" title="Add subtask under this activity" onClick={()=>{
                                dispatch({type:"addTask",projId:proj.id,phId:sourcePhId,parentId:t.id,name:"New subtask"});
                                setExpandedTasks(prev=>({...prev,[t.id]:true}));
                                toast("Subtask added","ok");
                              }}>⊞</button>
                            </div>
                            {hasChildren?<span className="ttree-parent-tag">has subtasks · dates from first→last</span>:null}
                          </div>
                        </div>
                      </td>
                      <td className="tcol-start">{rolledUp?(
                        <input type="date" className="di di-ro" value={d.s||""} readOnly title="Start = first subtask start" tabIndex={-1}/>
                      ):(
                        <input type="date" className="di" value={t.ms||d.s||""} onChange={e=>dispatch({type:"setMS",projId:proj.id,phId:sourcePhId,tId:t.id,v:e.target.value||null})}/>
                      )}</td>
                      <td className="tcol-dur">{rolledUp?(
                        <input type="number" className="ni ni-ro" value={rolledDur} readOnly title="Duration spans first subtask start → last subtask end" tabIndex={-1}/>
                      ):(
                        <input type="number" className="ni" value={t.dur??""} min={1} max={999} onChange={e=>dispatch({type:"updTask",projId:proj.id,phId:sourcePhId,tId:t.id,f:"dur",v:parseInt(e.target.value)||1})}/>
                      )}</td>
                      <td className="tcol-end" style={{color:C.tx2,fontSize:12,whiteSpace:"nowrap"}} title={rolledUp?"End = last subtask end":undefined}>{fmt(d.e)}</td>
                      <td className="tcol-who">
                        <AssigneeMultiSelect compact value={t.who||""} options={assigneeRoster} onChange={v=>dispatch({type:"updTask",projId:proj.id,phId:sourcePhId,tId:t.id,f:"who",v})}/>
                      </td>
                      <td className="tcol-status">
                        <div className={`status-wrap status-wrap-${st}`}>
                          <select className="status-sel" style={{color:dueHeatColor(heat==="none"?st:heat)||SCOL[st]||C.gray}}
                            value={taskStatusSelectValue(t)}
                            onChange={e=>{
                              const v=e.target.value;
                              const prev=taskStatusSelectValue(t);
                              dispatch({type:"setTaskStatus",projId:proj.id,phId:sourcePhId,tId:t.id,v});
                              notifyStatus(ph,t,prev,v);
                            }}>
                            {TASK_STATUS_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        {st==="overdue"&&<span className="badge bov" style={{marginLeft:4}} title="Due missed">+{od}d</span>}
                        {heat==="nearing"&&<span className="badge bpa" style={{marginLeft:4}} title="Nearing due date">Due soon</span>}
                        {heat==="ontrack"&&st!=="completed"&&st!=="paused"&&<span className="badge bcomp" style={{marginLeft:4}} title="Well within due date">On track</span>}
                      </td>
                      <td className="tcol-comments">
                        {!showCommentsConsolidated&&latestComment?(
                          <div className="tcol-cmt-preview" title={latestComment.text}>
                            <span className="tcol-cmt-author">{latestComment.author||"Anon"} · {latestComment.ts||"—"}</span>
                            <span className="tcol-cmt-text">{truncateText(latestComment.text, 80)}</span>
                          </div>
                        ):null}
                        {cc>0?<span className="tcol-count" title={`${cc} comment${cc!==1?"s":""}`}>{cc}</span>:null}
                        <button type="button" className="bts tcm-open-btn" title="View comment history and post an update" onClick={(e)=>{
                          e.stopPropagation();
                          openCommentModal({...ph,id:sourcePhId},t);
                        }}>{cc?`Comments (${cc})`:"Add comment"}</button>
                      </td>
                      <td className="tcol-del"><div className="tact">
                        <button type="button" className="abt del" title="Delete (includes subtasks)" onClick={()=>{
                          const nKids=annotateTreeMeta(ph.tasks).find(r=>r.task.id===t.id)?.hasChildren;
                          const msg=nKids
                            ?`Delete "${t.name}" and all its subtasks?`
                            :`Delete "${t.name}"?`;
                          if(confirm(msg))dispatch({type:"delTask",projId:proj.id,phId:sourcePhId,tId:t.id});
                        }}>🗑</button>
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>}
          </div>
        );
      }).filter(Boolean)}
      </div>
      {showCommentsConsolidated?(
        <TaskCommentsListSection
          proj={proj}
          dm={dm}
          filters={filters}
          filtersActive={filtersActive}
          taskPassesFilters={taskPassesFilters}
          statusLabel={statusLabel}
          taskStatus={taskStatus}
          fmt={fmt}
          onOpenComments={openCommentModal}
          showOnlyWithComments={showOnlyWithComments}
          setShowOnlyWithComments={setShowOnlyWithComments}
        />
      ):null}
      <TaskCommentModal
        open={!!commentTarget}
        onClose={closeCommentModal}
        proj={proj}
        ph={commentTarget?.ph}
        task={commentTarget?.task}
        dispatch={dispatch}
        toast={toast}
        authorName={authorName}
        authorEmail={loginUser?.email}
        departments={departments}
        assigneeOptions={assigneeRoster}
      />
    </div>
  );
}

// ── DASHBOARD ────────────────────────────────────────────
const emptyProjForm=()=>({name:"",loc:"",type:"Residential",floors:10,status:"Pre-Construction",ko:"2026-01-01",col:"#1A304A"});
function projFormFromProject(p){
  if(!p)return emptyProjForm();
  return{name:p.name||"",loc:p.loc||"",type:p.type||"Residential",floors:p.floors||10,status:p.status||"Pre-Construction",ko:p.ko||"2026-01-01",col:p.col||"#1A304A"};
}
function ProjectFormFields({form,setForm}){
  return(
    <div className="fgrid">
      <div className="fg" style={{gridColumn:"1/-1"}}><label>Project Name</label><input type="text" value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Baner Heights"/></div>
      <div className="fg"><label>Location</label><input type="text" value={form.loc} onChange={e=>setForm(p=>({...p,loc:e.target.value}))} placeholder="e.g. Baner, Pune"/></div>
      <div className="fg"><label>Type</label><select value={form.type} onChange={e=>setForm(p=>({...p,type:e.target.value}))}><option>Residential</option><option>Commercial</option><option>Mixed-Use</option><option>Grade-A Commercial Tower</option><option>Luxury Villa</option></select></div>
      <div className="fg"><label>Floors</label><input type="number" value={form.floors} onChange={e=>setForm(p=>({...p,floors:parseInt(e.target.value,10)||1}))} min={1}/></div>
      <div className="fg"><label>Status</label><select value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))}><option>Pre-Construction</option><option>Pipeline</option><option>Evaluation</option><option>Acquired</option><option>Under Construction</option></select></div>
      <div className="fg"><label>Kickoff Date</label><input type="date" value={form.ko} onChange={e=>setForm(p=>({...p,ko:e.target.value}))}/></div>
      <div className="fg"><label>Brand Color</label><input type="color" value={form.col} onChange={e=>setForm(p=>({...p,col:e.target.value}))}/></div>
    </div>
  );
}

function Dashboard({projects,cloudUrl,setCloudUrl,toast,onOpenProject,onOpenMyWork,onEditProject,onDeleteProject,onAddProject,onImportJson,onImportExcel,departments,canDeleteProjects,dispatch,loginUser,activityLog,syncLoading}){
  const[dashTab,setDashTab]=useState("overview");
  const[horizonDays,setHorizonDays]=useState(30);
  const[statusFilters,setStatusFilters]=useState([]);
  const[assigneeFilter,setAssigneeFilter]=useState("");
  const[departmentFilter,setDepartmentFilter]=useState("");
  const[roleFilter,setRoleFilter]=useState("");
  const[projSearch,setProjSearch]=useState("");
  const displayProjects=useMemo(()=>filterAndSortProjects(projects,projSearch),[projects,projSearch]);
  const assignees=useMemo(()=>collectAssignees(displayProjects),[displayProjects]);
  const roleOptions=useMemo(()=>collectAllRoles(displayProjects),[displayProjects]);
  const todayStr=todayIso();
  const filters=useMemo(()=>({statusFilters,assigneeFilter,departmentFilter,departments,roleFilter,horizonDays,todayStr}),[statusFilters,assigneeFilter,departmentFilter,departments,roleFilter,horizonDays,todayStr]);
  const overviewStats=useMemo(()=>{
    const allStats=displayProjects.map(p=>({p,s:pStats(p)}));
    const tT=allStats.reduce((a,x)=>a+x.s.tot,0),tC=allStats.reduce((a,x)=>a+x.s.comp,0),
          tO=allStats.reduce((a,x)=>a+x.s.ov,0),tI=allStats.reduce((a,x)=>a+x.s.ip,0);
    const op=tT?Math.round(tC/tT*100):0;
    const statusData=[{name:"Completed",v:tC,c:"#1A6A3C"},{name:"In Progress",v:tI,c:"#1B5E9E"},{name:"Overdue",v:tO,c:"#B32E1E"},{name:"Not Started",v:allStats.reduce((a,x)=>a+x.s.up,0),c:"#9A9590"}];
    const ghq=displayProjects.find(p=>p.id==="ghq");
    const phaseData=ghq?ghq.phases.map(ph=>{const dm=cDates(ghq);const c=ph.tasks.filter(t=>taskStatus(t,dm)==="completed").length;return{name:ph.name.substring(0,12),pct:ph.tasks.length?Math.round(c/ph.tasks.length*100):0,col:ph.col};}):[];
    const upcoming=[],iss=[];
    displayProjects.forEach(proj=>{
      const dm=cDates(proj);
      proj.phases.forEach(ph=>ph.tasks.forEach(t=>{
        const d=dm[t.id];if(!d)return;const st=taskStatus(t,dm);
        if(st==="overdue")iss.push({proj,ph,t,d,dy:dbDays(d.e,todayStr)});
        const isAction=st==="inprogress"||st==="notstarted"||st==="upcoming"||st==="paused";
        if(isAction&&taskPassesFilters(t,dm,ph.name,filters)){
          const dsStart=dbDays(todayStr,d.s);
          const dsEnd=dbDays(todayStr,d.e);
          const ds=Math.min(dsStart>=0?dsStart:999,dsEnd>=0?dsEnd:999);
          upcoming.push({proj,ph,t,d,ds,st});
        }
        (t.comments||[]).forEach(c=>{if(c.flag)iss.push({proj,ph,t,d,com:c});});
      }));
    });
    upcoming.sort((a,b)=>a.ds-b.ds);
    return{allStats,tT,tC,tO,tI,op,statusData,phaseData,upcoming,iss};
  },[displayProjects,filters,todayStr]);
  const{allStats,tT,tC,tO,tI,op,statusData,phaseData,upcoming,iss}=overviewStats;
  if(syncLoading&&!displayProjects.length){
    return(
      <div style={{padding:"48px 20px",textAlign:"center"}}>
        <h1 className="disp" style={{fontSize:28,fontWeight:600,color:C.navy,marginBottom:10}}>Loading workspace…</h1>
        <p style={{color:C.tx2,fontSize:13}}>Fetching the latest projects and comments from MongoDB.</p>
      </div>
    );
  }
  return(
  <div>
      <div style={{marginBottom:20}}>
        <h1 className="disp" style={{fontSize:30,fontWeight:600,color:C.navy,lineHeight:1.1}}>Pre-Construction Command Centre</h1>
        <p style={{color:C.tx2,fontSize:13,marginTop:4}}>
          Golden Abodes · {displayProjects.length}{projSearch.trim()?` of ${projects.length}`:""} Projects · {fmt(todayStr)}
        </p>
        <input
          type="search"
          className="dash-proj-search"
          placeholder="Search projects by name, location…"
          value={projSearch}
          onChange={e=>setProjSearch(e.target.value)}
          aria-label="Search projects on dashboard"
        />
        <div className="dash-actions">
          {onOpenMyWork?<button type="button" className="mw-cta" onClick={onOpenMyWork}>◎ My Work — your assignments</button>:null}
          {onAddProject?<button type="button" className="btp-add" onClick={onAddProject}>+ Add project</button>:null}
          {onImportJson?<label className="file-lbl">Import JSON<input type="file" accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f)onImportJson(f);e.target.value="";}}/></label>:null}
          {onImportExcel?<label className="file-lbl">Import Excel<input type="file" accept=".xlsx,.xls" onChange={e=>{const f=e.target.files?.[0];if(f)onImportExcel(f);e.target.value="";}}/></label>:null}
      </div>
      </div>
      <div className="dash-stabs" role="tablist" aria-label="Dashboard views">
        <button type="button" role="tab" aria-selected={dashTab==="ask"} className={`dash-stab${dashTab==="ask"?" act":""}`} onClick={()=>setDashTab("ask")}>Ask AI</button>
        <button type="button" role="tab" aria-selected={dashTab==="overview"} className={`dash-stab${dashTab==="overview"?" act":""}`} onClick={()=>setDashTab("overview")}>Overview</button>
        <button type="button" role="tab" aria-selected={dashTab==="calendar"} className={`dash-stab${dashTab==="calendar"?" act":""}`} onClick={()=>setDashTab("calendar")}>Work Calendar</button>
        <button type="button" role="tab" aria-selected={dashTab==="reports"} className={`dash-stab${dashTab==="reports"?" act":""}`} onClick={()=>setDashTab("reports")}>Reports</button>
      </div>
      {dashTab==="ask"?(
        <AnalyticsAskView projects={displayProjects} dispatch={dispatch} toast={toast} onOpenProject={onOpenProject} loginUser={loginUser}/>
      ):dashTab==="calendar"?(
        <DashboardCalendarView projects={displayProjects} sourceProjects={projects} departments={departments} dispatch={dispatch} toast={toast} loginUser={loginUser} onOpenProject={onOpenProject}/>
      ):dashTab==="reports"?(
        <DashboardReportsView activityLog={activityLog||[]} projects={displayProjects} onOpenProject={onOpenProject} dispatch={dispatch} toast={toast} loginUser={loginUser}/>
      ):(
      <>
      <PortfolioRagMatrix projects={displayProjects} departments={departments} onOpenProject={onOpenProject}/>
      <div className="kgrid">
        {[{l:"Total Tasks",v:tT,c:C.navy},{l:"Completed",v:tC,c:C.green,sub:`${op}% overall`},{l:"In Progress",v:tI,c:C.blue},{l:"Overdue",v:tO,c:C.red,sub:tO>0?"Needs attention":"All on track"},{l:"Projects",v:displayProjects.length,c:C.gold}].map((k,i)=>(
          <div key={i} className="kcard" style={{"--acc":k.c}}>
            <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".8px",color:C.tx3,marginBottom:7}}>{k.l}</div>
            <div className="disp" style={{fontSize:30,fontWeight:600,color:k.c,lineHeight:1}}>{k.v}</div>
            {k.sub&&<div style={{fontSize:11,color:C.tx3,marginTop:3}}>{k.sub}</div>}
          </div>
        ))}
      </div>
      <div className="pgrid">
        {allStats.length?allStats.map(({p,s})=>{
          const r=34,circ=2*Math.PI*r,off=circ*(1-s.pct/100);
          const dm=cDates(p);let nxt=null;
          for(const ph of p.phases)for(const t of ph.tasks){const st=taskStatus(t,dm);if(st==="inprogress"||st==="notstarted"){nxt=t;break;}if(nxt)break;}
          return(
            <div key={p.id} className="pcard" style={{cursor:onOpenProject?"pointer":"default"}} onClick={()=>onOpenProject&&onOpenProject(p.id)}>
              <svg width="64" height="64" viewBox="0 0 80 80" style={{flexShrink:0}}>
                <circle fill="none" stroke="#CEC8BB" strokeWidth="4" cx="40" cy="40" r={r}/>
                <circle fill="none" stroke={p.col} strokeWidth="4" strokeLinecap="round" cx="40" cy="40" r={r}
                  strokeDasharray={circ.toFixed(1)} strokeDashoffset={off.toFixed(1)} transform="rotate(-90 40 40)" style={{transition:"stroke-dashoffset .4s"}}/>
                <text x="40" y="44" textAnchor="middle" fill={p.col} fontSize="13" fontWeight="600" fontFamily="Cormorant Garamond,serif">{s.pct}%</text>
              </svg>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:13,color:C.navy,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</div>
                <div style={{fontSize:11,color:C.tx3,marginTop:1}}>{p.loc} · {p.floors}F{p.ko?` · Kickoff ${fmt(p.ko)}`:""}</div>
                <div style={{display:"flex",gap:7,marginTop:4,fontSize:11}}>
                  <span style={{color:C.green}}>✓{s.comp}</span>
                  <span style={{color:C.blue}}>{s.ip} active</span>
                  <span style={{color:C.red}}>{s.ov} late</span>
                </div>
                {nxt&&<div style={{fontSize:11,color:C.tx3,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>↳ {nxt.name}</div>}
                <div style={{display:"flex",gap:5,marginTop:8}} onClick={e=>e.stopPropagation()}>
                  {onEditProject&&<button type="button" className="bts" onClick={()=>onEditProject(p)}>Edit</button>}
                  {canDeleteProjects&&onDeleteProject&&<button type="button" className="btd bts" onClick={()=>onDeleteProject(p)}>Delete</button>}
                </div>
              </div>
            </div>
          );
        }):(
          <p style={{gridColumn:"1/-1",padding:"24px 8px",color:C.tx3,fontSize:13}}>
            {projSearch.trim()?`No projects match “${projSearch.trim()}”.`:"No projects yet — add one to get started."}
          </p>
        )}
      </div>
      <ActionFilters horizonDays={horizonDays} setHorizonDays={setHorizonDays} statusFilters={statusFilters} setStatusFilters={setStatusFilters} assigneeFilter={assigneeFilter} setAssigneeFilter={setAssigneeFilter} assignees={assignees} departmentFilter={departmentFilter} setDepartmentFilter={setDepartmentFilter} departments={departments} roleFilter={roleFilter} setRoleFilter={setRoleFilter} roleOptions={roleOptions}/>
      <div className="dg2">
        <div className="card">
          <div style={{padding:"13px 18px",borderBottom:`1px solid ${C.bd}`}}><span className="disp" style={{fontSize:15,fontWeight:600,color:C.navy}}>Status Breakdown</span></div>
          <div style={{padding:"14px 18px",height:200}}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={statusData} dataKey="v" cx="40%" outerRadius={70} paddingAngle={2}>
                {statusData.map((d,i)=><Cell key={i} fill={d.c}/>)}
              </Pie><Legend iconSize={10} iconType="square" formatter={(v,e)=><span style={{fontSize:11,color:C.tx2}}>{v}: {e.payload.v}</span>}/><Tooltip formatter={(v,n)=>[v,n]}/></PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div style={{padding:"13px 18px",borderBottom:`1px solid ${C.bd}`}}><span className="disp" style={{fontSize:15,fontWeight:600,color:C.navy}}>Phase Progress — Golden HQ</span></div>
          <div style={{padding:"14px 18px",height:200}}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={phaseData} margin={{left:-10}}>
                <XAxis dataKey="name" tick={{fontSize:9}} /><YAxis tickFormatter={v=>v+"%"} tick={{fontSize:9}} domain={[0,100]}/>
                <Tooltip formatter={v=>[v+"%","Complete"]}/><Bar dataKey="pct" radius={[3,3,0,0]}>{phaseData.map((d,i)=><Cell key={i} fill={d.col+"BB"}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="dg2">
        <div className="card">
          <div style={{padding:"13px 18px",borderBottom:`1px solid ${C.bd}`}}><span className="disp" style={{fontSize:15,fontWeight:600,color:C.navy}}>Upcoming Actions <span style={{fontSize:12,fontWeight:400,color:C.tx3}}>(next {horizonDays} days)</span></span></div>
          <div style={{padding:"0 18px",maxHeight:260,overflowY:"auto"}}>
            {upcoming.length?upcoming.slice(0,15).map((x,i)=>(
              <div key={i} style={{display:"flex",alignItems:"flex-start",gap:9,padding:"8px 0",borderBottom:i<upcoming.length-1?`1px solid ${C.bd}`:"none"}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:SCOL[x.st]||C.gray,marginTop:4,flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:500}}>{x.t.name}</div>
                  <div style={{fontSize:11,color:C.tx3,marginTop:1}}>{x.proj.name} · {x.t.who?`${x.t.who} · `:""}{x.ds<=0?"Today / due":`${x.ds}d to start`} · End {fmt(x.d.e)}</div>
                </div>
                <span className={`badge ${statusBadgeClass(x.st)}`} style={{flexShrink:0}}>{statusLabel(x.st)}</span>
              </div>
            )):<p style={{padding:"16px 0",color:C.tx3,fontSize:12}}>No actions match filters in the next {horizonDays} days</p>}
          </div>
        </div>
        <div className="card">
          <div style={{padding:"13px 18px",borderBottom:`1px solid ${C.bd}`}}><span className="disp" style={{fontSize:15,fontWeight:600,color:C.red}}>⚠ Issues & Bottlenecks</span></div>
          <div style={{padding:"14px 18px",maxHeight:260,overflowY:"auto"}}>
            {iss.length?iss.slice(0,5).map((x,i)=>(
              <div key={i} style={{padding:"9px 11px",background:C.redbg,border:`1px solid ${C.redbd}`,borderRadius:5,marginBottom:7}}>
                <div style={{fontSize:12,fontWeight:600,color:C.red}}>{x.com?`⚑ ${x.t.name}`:`⚠ ${x.t.name} — Overdue ${x.dy}d`}</div>
                <div style={{fontSize:11,color:C.tx2,marginTop:2}}>{x.proj.name} · {x.com?x.com.text.substring(0,80):("Was due "+fmt(x.d.e))}</div>
              </div>
            )):<div style={{color:C.green,fontSize:12,padding:"8px 0"}}>✓ No active issues</div>}
          </div>
        </div>
      </div>
      <div className="card" style={{padding:"16px 18px",marginBottom:16}}>
        <div className="disp" style={{fontSize:15,fontWeight:600,color:C.navy,marginBottom:10}}>☁️ Cloud Sync — Connect to V3 Project Planning</div>
        <p style={{fontSize:12,color:C.tx2,marginBottom:12,lineHeight:1.6}}>Enter your Google Apps Script Web App URL (same URL used in the V3 Pre-Construction Tracker) to push/pull data across all team members. The data format is identical — both tools share the same JSON schema.</p>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <input type="text" value={cloudUrl} onChange={e=>setCloudUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" style={{flex:1,minWidth:220,padding:"7px 10px",border:`1px solid ${C.bd}`,borderRadius:5,fontSize:12,fontFamily:"'DM Sans',sans-serif"}}/>
          <button className="btp" onClick={()=>{if(!cloudUrl){toast("Enter URL first","err");return;}fetch(cloudUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projects,cloudUrl})}).then(r=>r.ok?toast("Pushed to cloud ✓","ok"):toast("Cloud error","err")).catch(()=>toast("Network error","err"));}}>Push to Cloud</button>
          <button className="btg" onClick={()=>{if(!cloudUrl){toast("Enter URL first","err");return;}toast("Pulling from cloud…");fetch(cloudUrl).then(r=>r.json()).then(d=>{if(d?.projects)toast("Pulled — reload to apply","ok");else toast("No data found","err");}).catch(()=>toast("Cloud error","err"));}}>Pull from Cloud</button>
        </div>
        <div style={{marginTop:10,padding:"10px 12px",background:C.goldbg,border:`1px solid ${C.goldbd}`,borderRadius:5,fontSize:11,color:C.tx2}}>
          <strong style={{color:C.gold}}>Google Apps Script (same script works for both V3 and this React app):</strong><br/>
          Deploy at <code style={{background:"rgba(0,0,0,.06)",padding:"1px 4px",borderRadius:3}}>script.google.com</code> as Web App (Execute as: Me, Access: Anyone). 
          The <code style={{background:"rgba(0,0,0,.06)",padding:"1px 4px",borderRadius:3}}>doGet</code> returns JSON, <code style={{background:"rgba(0,0,0,.06)",padding:"1px 4px",borderRadius:3}}>doPost</code> saves it. Both apps POST/GET from the same endpoint.
        </div>
      </div>
      </>
      )}
    </div>
  );
}

// ── REDUCER ──────────────────────────────────────────────
const STRUCTURAL_ACTIONS=new Set(["addTask","delTask","addPhase","delPhase","addProject","delProject","reorderTask","reorderPhase"]);
/** Persist to Mongo soon after comments, status, assignees, and structural changes. */
const MONGO_FLUSH_ACTIONS=new Set([
  ...STRUCTURAL_ACTIONS,
  "addComment","updComment","markDone","setTaskStatus",
  "updTask","bulkAssignByRole","bulkAssignByDepartment","setMS","setDepartmentHead","setKO","updProject",
]);

function reducer(state,action){
  // Cheap no-ops first — never deep-clone the whole portfolio for flag clears / already-hydrated.
  if(action.type==="clearFlushFlag"){
    if(!state.__flushPending)return state;
    const next={...state};
    delete next.__flushPending;
    return next;
  }
  if(action.type==="clearCommentRepairFlag"){
    if(!state.__commentsRepairPending)return state;
    const next={...state};
    delete next.__commentsRepairPending;
    return next;
  }
  if(action.type==="loadState"){
    const preservedLog=Array.isArray(action.state?.activityLog)?action.state.activityLog:null;
    const incoming=action.state&&typeof action.state==="object"?action.state:{};
    const needsHydrate=!(incoming.__lifecycleHydrated===LIFECYCLE_VERSION)&&!action.skipHydrate;
    const quick={
      ...incoming,
      projects:Array.isArray(incoming.projects)?incoming.projects:[],
      activityLog:dedupeActivityLog(Array.isArray(preservedLog)?preservedLog:(Array.isArray(incoming.activityLog)?incoming.activityLog:[])).slice(0,300),
      _removedProjectIds:Array.isArray(incoming._removedProjectIds)?incoming._removedProjectIds:[],
    };
    if(needsHydrate)quick.__needsHydrate=true;
    else if(quick.__needsHydrate)delete quick.__needsHydrate;
    ensureStateDepartments(quick);
    (quick.projects||[]).forEach((proj)=>{
      applyTaskTombstonesToProject(proj);
      (proj.phases||[]).forEach(ph=>{
        (ph.tasks||[]).forEach(t=>{
          normalizeParentIdOnTask(t);
          if(!t.status){
            if(t.ae)t.status="completed";
            else if(t.as)t.status="inprogress";
            else t.status="notstarted";
          }
          if(!Array.isArray(t.roles))t.roles=parseRolesInput(t.roles);
          if(!Array.isArray(t.comments)||typeof t.comments==="string"||(t.comments&&typeof t.comments==="object"&&!Array.isArray(t.comments))){
            t.comments=normalizeTaskComments(t.comments);
          }
        });
      });
    });
    return quick;
  }
  if(action.type==="hydrateWorkspace"){
    if(!state.__needsHydrate)return state;
    if(state.__lifecycleHydrated===LIFECYCLE_VERSION){
      const next={...state};
      delete next.__needsHydrate;
      return next;
    }
    const S=JSON.parse(JSON.stringify(state));
    const{state:merged,totalAdded}=mergeLifecycleIntoState(S);
    migratePreWorkFollowUpState(merged);
    mergeAkashActivitiesIntoState(merged);
    migrateAssigneeNamesState(merged);
    // Comment repair stays on server write path — avoid client repair→save→reload loops.
    ensureStateDepartments(merged);
    (merged.projects||[]).forEach((proj)=>applyTaskTombstonesToProject(proj));
    if(merged.__needsHydrate)delete merged.__needsHydrate;
    merged.__lifecycleHydrated=LIFECYCLE_VERSION;
    if(totalAdded>0)merged.__flushPending=true;
    (merged.projects||[]).forEach(proj=>{
      (proj.phases||[]).forEach(ph=>{
        (ph.tasks||[]).forEach(t=>{
          normalizeParentIdOnTask(t);
          if(!Array.isArray(t.roles))t.roles=parseRolesInput(t.roles);
        });
      });
    });
    return merged;
  }

  const S=JSON.parse(JSON.stringify(state));
  const fp=(pid)=>S.projects.find(p=>p.id===pid);
  const fph=(pid,phid)=>fp(pid)?.phases.find(ph=>ph.id===phid);
  /** Prefer phase hint, then search whole project so assignee/status edits never silently no-op. */
  const ft=(pid,phid,tid)=>{
    const want=String(tid||"");
    if(!want)return null;
    const hinted=fph(pid,phid)?.tasks?.find(t=>String(t.id)===want);
    if(hinted)return hinted;
    const p=fp(pid);
    if(!p)return null;
    for(const ph of p.phases||[]){
      const hit=(ph.tasks||[]).find(t=>String(t.id)===want);
      if(hit)return hit;
    }
    return null;
  };
  const stampWho=(t,who)=>{
    t.who=who;
    t.whoUpdatedAt=new Date().toISOString();
  };
  let activityAction=action;
  switch(action.type){
    case"setKO":{
      const p=fp(action.pid);
      if(p){p.ko=action.v;applyKickoffOffsets(p);}
      break;
    }
    case"updTask":{
      const t=ft(action.projId,action.phId,action.tId);
      if(!t)break;
      if(action.f==="roles")t.roles=parseRolesInput(action.v);
      else if(action.f==="dur")t.dur=parseInt(action.v,10)||1;
      else if(action.f==="who")stampWho(t,action.v);
      else t[action.f]=action.v;
      break;
    }
    case"bulkAssignByRole":{
      const p=fp(action.projId);
      if(!p||!action.role)break;
      const role=String(action.role).trim();
      const who=String(action.who||"").trim();
      if(!who)break;
      let updated=0;
      (p.phases||[]).forEach((ph)=>{
        (ph.tasks||[]).forEach((t)=>{
          if(!taskHasRole(t,role))return;
          if(action.onlyUnassigned&&String(t.who||"").trim())return;
          if(!action.overwrite&&t.who===who)return;
          stampWho(t,who);
          updated+=1;
        });
      });
      activityAction={...action,updatedCount:updated,role,who};
      break;
    }
    case"bulkAssignByDepartment":{
      const p=fp(action.projId);
      if(!p||!action.deptId)break;
      const who=String(action.who||"").trim();
      if(!who)break;
      let updated=0;
      (p.phases||[]).forEach((ph)=>{
        if(!taskInDepartment(ph,action.deptId,S.departments))return;
        (ph.tasks||[]).forEach((t)=>{
          if(action.onlyUnassigned&&String(t.who||"").trim())return;
          if(!action.overwrite&&t.who===who)return;
          stampWho(t,who);
          updated+=1;
        });
      });
      activityAction={...action,updatedCount:updated,deptId:action.deptId,who};
      break;
    }
    case"setDepartmentHead":{
      const d=(S.departments||[]).find(x=>x.id===action.deptId);
      if(d)d.head=typeof action.head==="string"?action.head:"";
      break;
    }
    case"setMS":{
      const t=ft(action.projId,action.phId,action.tId);
      if(!t)break;
      t.ms=action.v||null;
      t.msManual=!!action.v;
      break;
    }
    case"setTaskStatus":{
      const t=ft(action.projId,action.phId,action.tId);if(!t)break;
      const td=todayIso();const v=action.v;
      t.status=v;
      if(v==="completed"){t.ae=td;if(!t.as)t.as=td;}
      else if(v==="inprogress"){t.ae=null;if(!t.as)t.as=td;}
      else{t.ae=null;t.as=null;}
      break;
    }
    case"markDone":{const t=ft(action.projId,action.phId,action.tId);if(t){const td=todayIso();t.status="completed";t.ae=td;if(!t.as)t.as=td;}break;}
    case"bulkCompletePhase":{
      const ph=fph(action.projId,action.phId);
      if(!ph)break;
      const td=todayIso();
      const idSet=Array.isArray(action.taskIds)?new Set(action.taskIds):null;
      let updated=0;
      (ph.tasks||[]).forEach((t)=>{
        if(idSet&&!idSet.has(t.id))return;
        if(t.status==="completed"&&t.ae)return;
        t.status="completed";
        t.ae=td;
        if(!t.as)t.as=td;
        updated+=1;
      });
      activityAction={...action,updatedCount:updated,phaseName:ph.name};
      break;
    }
    case"delTask":{
      const p=fp(action.projId);
      const ph=fph(action.projId,action.phId);
      if(ph){
        const doomedIds=idsToDeleteWithDescendants(ph.tasks,action.tId);
        const doomedSet=new Set(doomedIds.map(String));
        const doomed=ph.tasks.find(t=>t.id===action.tId);
        ph.tasks=ph.tasks.filter(t=>!doomedSet.has(String(t.id)));
        if(p){
          if(!Array.isArray(p._removedTaskIds))p._removedTaskIds=[];
          doomedIds.forEach((rid)=>{
            const id=String(rid||"").trim();
            if(id&&!p._removedTaskIds.includes(id))p._removedTaskIds.push(id);
          });
        }
        activityAction={...action,taskName:doomed?.name||"",deletedCount:doomedIds.length};
      }
      break;
    }
    case"addTask":{
      const ph=fph(action.projId,action.phId);if(!ph)break;
      const parentId=action.parentId||action.ex?.parentId||null;
      const id=uid();
      const nt=mkT(id,action.name||(parentId?"New subtask":"New Task"),action.dur||7,action.pred||[],null,{source:"user",parentId:parentId||null,...action.ex||{}});
      if(parentId){
        const byId=indexTasksById(ph.tasks);
        if(!byId.has(String(parentId))){nt.parentId=null;}
        else{
          const insertAt=insertIndexAfterParent(ph.tasks,parentId);
          ph.tasks.splice(insertAt,0,nt);
          break;
        }
      }
      if(action.afterId){const i=ph.tasks.findIndex(t=>t.id===action.afterId);if(i>=0){ph.tasks.splice(i+1,0,nt);break;}}
      ph.tasks.push(nt);break;
    }
    case"reorderTask":{
      const ph=fph(action.projId,action.phId);if(!ph||!ph.tasks?.length)break;
      ph.tasks=reorderSubtree(ph.tasks,action.fromId,action.toId);
      break;
    }
    case"reorderPhase":{
      const p=fp(action.projId);if(!p||!p.phases?.length)break;
      const fromIdx=p.phases.findIndex(ph=>ph.id===action.fromId);
      const toIdx=p.phases.findIndex(ph=>ph.id===action.toId);
      if(fromIdx<0||toIdx<0||fromIdx===toIdx)break;
      const[item]=p.phases.splice(fromIdx,1);
      p.phases.splice(toIdx,0,item);
      break;
    }
    case"delPhase":{const p=fp(action.projId);if(p)p.phases=p.phases.filter(ph=>ph.id!==action.phId);break;}
    case"addPhase":{
      const p=fp(action.projId);if(!p)break;
      const id="ph_"+Date.now();p.phases.push({id,name:action.name||"New Phase",col:action.col||PCOL[0],open:true,tasks:[]});break;
    }
    case"addComment":{const t=ft(action.projId,action.phId,action.tId);if(t){if(!Array.isArray(t.comments))t.comments=[];t.comments.push(ensureCommentCreatedAt(action.comment));}break;}
    case"addTaskAttachments":{
      const p=fp(action.projId);
      if(!p)break;
      for(const ph of p.phases||[]){
        const t=ph.tasks.find(x=>x.id===action.tId);
        if(t){if(!Array.isArray(t.attachments))t.attachments=[];t.attachments.push(...(action.attachments||[]));break;}
      }
      break;
    }
    case"updComment":{
      const t=ft(action.projId,action.phId,action.tId);
      if(!t||!Array.isArray(t.comments))break;
      const i=action.commentIndex;
      if(i<0||i>=t.comments.length)break;
      Object.assign(t.comments[i],action.patch||{});
      break;
    }
    case"addProject":S.projects.push(action.proj);break;
    case"delProject":{
      S.projects=S.projects.filter(p=>p.id!==action.pid);
      if(!Array.isArray(S._removedProjectIds))S._removedProjectIds=[];
      const rid=String(action.pid||"").trim();
      if(rid&&!S._removedProjectIds.includes(rid))S._removedProjectIds.push(rid);
      break;
    }
    case"updProject":{
      const p=fp(action.pid);
      if(!p)break;
      const f=action.fields||{};
      ["name","loc","type","floors","status","ko","col"].forEach(k=>{
        if(f[k]!==undefined)p[k]=f[k];
      });
      break;
    }
    case"setCloudUrl":S.cloudUrl=action.v;break;
    default:break;
  }
  if(action.type!=="loadState"&&action.type!=="hydrateWorkspace"&&action.type!=="clearFlushFlag"&&action.type!=="clearCommentRepairFlag"){
    recordActivityFromAction(S,activityAction);
  }
  if(MONGO_FLUSH_ACTIONS.has(action.type))S.__flushPending=true;
  return S;
}

// ── DEPARTMENT HEADS ─────────────────────────────────────
function DepartmentHeadsModal({open,onClose,departments,dispatch,toast}){
  if(!open)return null;
  return(
    <Modal open onClose={onClose} title="Department heads & filters" wide
      footer={<button type="button" className="btp" onClick={()=>{toast("Department heads updated","ok");onClose();}}>Done</button>}>
      <p style={{fontSize:12,color:C.tx2,lineHeight:1.55,marginBottom:14}}>
        Each lifecycle phase maps to one department. Use the <strong>Department</strong> and <strong>Role</strong> filters on Tasks and Dashboard.
        Edit heads below — saved with your workspace in MongoDB.
      </p>
      {(departments||[]).map(d=>(
        <div key={d.id} className="fg" style={{marginBottom:14,paddingBottom:12,borderBottom:`1px solid ${C.bd}`}}>
          <label style={{fontWeight:600,color:C.navy}}>{d.name}</label>
          <input type="text" defaultValue={d.head||""} placeholder="Department head name"
            onBlur={e=>dispatch({type:"setDepartmentHead",deptId:d.id,head:e.target.value.trim()})}/>
          <div style={{fontSize:10,color:C.tx3,marginTop:6,lineHeight:1.45}}>
            Covers phases: {(d.phaseNames||[]).slice(0,6).join(" · ")}{(d.phaseNames?.length>6?" …":"")}
          </div>
        </div>
      ))}
    </Modal>
  );
}

// ── MODAL COMPONENT ──────────────────────────────────────
function Modal({open,onClose,title,wide,children,footer}){
  if(!open)return null;
  return(
    <>
      <div className="mb" onClick={onClose}/>
      <div className={`mbox${wide?" wide":""}`}>
        <div style={{padding:"16px 18px",borderBottom:`1px solid ${C.bd}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <span className="disp" style={{fontSize:19,fontWeight:600,color:C.navy}}>{title}</span>
          <button style={{width:26,height:26,border:"none",background:"none",fontSize:17,color:C.tx3,cursor:"pointer",borderRadius:4}} onClick={onClose}>✕</button>
        </div>
        <div style={{padding:"18px",overflowY:"auto",flex:1}}>{children}</div>
        {footer&&<div style={{padding:"13px 18px",borderTop:`1px solid ${C.bd}`,display:"flex",justifyContent:"flex-end",gap:7,flexShrink:0}}>{footer}</div>}
      </div>
    </>
  );
}

// ── MAIN APP ─────────────────────────────────────────────
const CLOUD_LABELS={loading:"Mongo…",synced:"Mongo ✓",dirty:"Saving…",saving:"Saving…",new:"Mongo (new)",offline:"Mongo offline",local:"Local only",error:"Mongo error",conflict:"Conflict"};

export default function App(){
  const[state,dispatch]=useReducer(reducer,null,()=>buildInit());
  const[curView,setCurView]=useState("dashboard");
  const[subTab,setSubTab]=useState({});
  const[regStatus,setRegStatus]=useState({});
  const[modal,setModal]=useState(null);
  const[navOpen,setNavOpen]=useState(false);
  const[editProjId,setEditProjId]=useState(null);
  const[cloudStatus,setCloudStatus]=useState("loading");
  const mongoFlushRef=useRef(null);
  const mongoReloadRef=useRef(null);
  const deleteFlushPendingRef=useRef(false);
  const loginUser=useLoginUser();
  const[projectRoster,setProjectRoster]=useState({names:[],projectTagged:[],securityUsers:[]});
  useEffect(()=>{
    setPreconActivityActor(loginUser?.ready?loginUser.name:null);
  },[loginUser?.ready,loginUser?.name]);
  const canDeleteProjects=useMemo(()=>canDeletePreconProjects(loginUser),[loginUser]);
  const{navHint,toast}=useNavStatus();
  const visibleProjects=useMemo(()=>filterProjectsForUser(state.projects,loginUser),[state.projects,loginUser]);
  const curProj=state.projects.find(p=>p.id===curView);
  useEffect(()=>{
    let alive=true;
    (async()=>{
      if(!loginUser?.ready||!loginUser?.authenticated){
        if(alive)setProjectRoster({names:[],projectTagged:[],securityUsers:[]});
        return;
      }
      const roster=await fetchPreconTeamRoster(curProj?{id:curProj.id,name:curProj.name}:null);
      if(alive)setProjectRoster(roster);
    })();
    return()=>{alive=false;};
  },[loginUser?.ready,loginUser?.authenticated,curProj?.id,curProj?.name]);
  const rosterLoginUser=useMemo(()=>({
    ...loginUser,
    teamNames:projectRoster.names?.length?projectRoster.names:(loginUser?.teamNames||[]),
    projectTaggedNames:projectRoster.projectTagged?.length?projectRoster.projectTagged:(loginUser?.projectTaggedNames||[]),
    securityUserNames:projectRoster.securityUsers?.length?projectRoster.securityUsers:(loginUser?.securityUserNames||loginUser?.teamNames||[]),
  }),[loginUser,projectRoster]);
  const rosterProjects=useMemo(()=>projectsForAssigneeRoster(state.projects,loginUser,curProj),[state.projects,loginUser,curProj]);
  const assigneeRoster=useMemo(()=>buildAssigneeRoster(rosterProjects,state.departments,rosterLoginUser),[rosterProjects,state.departments,rosterLoginUser]);
  const viewSelectValue=curView==="mywork"||curView==="dashboard"||state.projects.some(p=>p.id===curView)?curView:"dashboard";

  // inject styles
  useEffect(()=>{
    const s=document.createElement("style");s.textContent=STYLES;document.head.appendChild(s);return()=>s.remove();
  },[]);

  const sv=(id)=>{if(id==="__add"){setModal("addProj");return;}setCurView(id);};
  const sst=(pid,tab)=>setSubTab(p=>({...p,[pid]:tab}));
  const cloudUrl=state.cloudUrl;
  const setCloudUrl=(v)=>dispatch({type:"setCloudUrl",v});

  const exportJSON=()=>{
    const b=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
    const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="GA_PreConstruction_"+iso(new Date())+".json";a.click();toast("JSON exported","ok");
  };
  const importJSON=(file)=>{
    const r=new FileReader();
    r.onload=e=>{
      try{
        const d=parseJsonState(e.target.result);
        dispatch({type:"loadState",state:d});
        toast("Workspace imported from JSON","ok");
      }catch(err){toast(err?.message||"Invalid JSON","err");}
    };
    r.readAsText(file);
  };
  const importExcel=(file)=>{
    if(cloudStatus==="loading"){
      toast("Wait for Mongo sync to finish, then import again","err");
      return;
    }
    const scope=curProj?{scopeProjectId:curProj.id,scopeProjectName:curProj.name}:null;
    const r=new FileReader();
    r.onload=e=>{
      try{
        const{state:imported,summary}=importExcelIntoState(state,e.target.result,scope||{});
        dispatch({type:"loadState",state:imported});
        const scopeNote=summary.scopeProject?` into ${summary.scopeProject}`:"";
        const skipNote=summary.rowsSkipped?`, ${summary.rowsSkipped} rows for other projects skipped`:"";
        toast(`Excel imported${scopeNote}: ${summary.tasksUpdated} updated, ${summary.tasksAdded} new${skipNote}`,"ok");
        void mongoFlushRef.current?.();
      }catch(err){toast(err?.message||"Excel import failed","err");}
    };
    r.readAsArrayBuffer(file);
  };

  const[newProj,setNewProj]=useState(emptyProjForm);
  const[editProj,setEditProj]=useState(emptyProjForm);

  const confirmDeleteProject=(p)=>{
    if(!canDeleteProjects){toast("Only the platform admin can delete projects","err");return;}
    if(!p||!confirm(`Delete project "${p.name}" and all its tasks?`))return;
    deleteFlushPendingRef.current=true;
    dispatch({type:"delProject",pid:p.id});
    if(curView===p.id)setCurView("dashboard");
    toast("Project deleted — saving…","ok");
  };

  useEffect(()=>{
    if(!deleteFlushPendingRef.current)return;
    deleteFlushPendingRef.current=false;
    void mongoFlushRef.current?.();
  },[state.projects.length,state._removedProjectIds?.length]);
  const openEditProject=(p)=>{
    if(!p)return;
    setEditProjId(p.id);
    setEditProj(projFormFromProject(p));
    setModal("editProj");
  };

  return(
    <div style={{minHeight:"100dvh",background:C.bg,maxWidth:"100vw",overflowX:"hidden"}}>
      <MongoSyncAdapter state={state} dispatch={dispatch} toast={toast} flushRef={mongoFlushRef} reloadRef={mongoReloadRef} onSyncStatus={setCloudStatus} canDeleteProjects={canDeleteProjects}/>
      <nav className="tnav">
        <div className="tnav-row">
          <div className="tnav-brand" style={{borderRight:`1.5px solid ${C.bd}`,paddingRight:12,marginRight:2}}>
          <div className="nlogo">GA</div>
            <div style={{minWidth:0}}>
            <div className="disp" style={{fontSize:14,fontWeight:600,color:C.navy}}>Command Centre</div>
            <div style={{fontSize:10,color:C.tx3,letterSpacing:".5px",textTransform:"uppercase"}}>Pre-Construction</div>
          </div>
        </div>
          <button type="button" className="tnav-menu-btn" aria-expanded={navOpen} onClick={()=>setNavOpen(o=>!o)}>
            {navOpen?"Close":"Menu"}
          </button>
        </div>
        <div className="proj-sel-wrap">
          <button
            type="button"
            className={`btg mw-nav-tab${curView==="mywork"?" act":""}`}
            onClick={()=>{setCurView("mywork");setNavOpen(false);}}
            title="Your tasks across all projects"
          >
            ◎ My Work
          </button>
          <ProjectNavPicker
            projects={state.projects}
            value={viewSelectValue}
            onChange={sv}
            onCloseNav={()=>setNavOpen(false)}
          />
        </div>
        <div className={`nact${navOpen?" open":""}`}>
          <div className="nact-grp">
            <button type="button" className="btg" onClick={()=>setModal("deptHeads")} title="Edit department heads (Design, Acquisition, Execution)">Departments</button>
            <button type="button" className="btp-add" onClick={()=>setModal("addProj")}>+ Add project</button>
            <label className="file-lbl" title="Replace workspace from JSON backup">Import JSON<input type="file" accept=".json,application/json" onChange={e=>{if(e.target.files?.[0])importJSON(e.target.files[0]);e.target.value="";}}/></label>
            <label className="file-lbl" title={curProj?`Merge tasks into "${curProj.name}" (Project column must match). Wait until Mongo shows ✓ before importing.`:"Merge all projects from Excel dump/report. Wait until Mongo shows ✓ before importing."}>Import Excel<input type="file" accept=".xlsx,.xls" disabled={cloudStatus==="loading"} onChange={e=>{if(e.target.files?.[0])importExcel(e.target.files[0]);e.target.value="";}}/></label>
          </div>
          <span className="nact-sep" aria-hidden="true"/>
          <div className="nact-grp">
            <button type="button" className="btg" title="Excel — current stored fields" onClick={()=>{try{downloadPreconExcel(state,"snapshot");toast("Excel dump downloaded","ok");}catch{toast("Excel export failed","err");}}}>Export dump</button>
            <button type="button" className="btg" title="Excel — computed dates, status, comments" onClick={()=>{try{downloadPreconExcel(state,"report");toast("Excel report downloaded","ok");}catch{toast("Excel export failed","err");}}}>Export report</button>
            <button type="button" className="btg" title="Download full workspace JSON" onClick={exportJSON}>Export JSON</button>
          </div>
          <span className="nact-sep" aria-hidden="true"/>
          {navHint?(
            <span className={`tnav-status-hint ${navHint.type||"info"}`} title={navHint.full} role="status">
              {navHint.short}
            </span>
          ):null}
          <span className="tnav-mongo" title="MongoDB sync">{CLOUD_LABELS[cloudStatus]||cloudStatus}</span>
          <button type="button" className="btg" title="Reload workspace from MongoDB" disabled={cloudStatus==="loading"} onClick={()=>{if(mongoReloadRef.current)void mongoReloadRef.current();else toast("Cloud reload unavailable","err");}}>↻ Reload</button>
          <button type="button" className="btp" disabled={cloudStatus==="loading"||cloudStatus==="saving"} onClick={async()=>{
            if(!mongoFlushRef.current){toast("Cloud save unavailable","err");return;}
            const ok=await mongoFlushRef.current();
            if(ok)toast("Saved to server — teammates can ↻ Reload to see comments & tasks","ok");
          }}>Save</button>
        </div>
      </nav>

      <main className={`main${curProj?" main-proj":""}`}>
        {curView==="dashboard"
          ?<Dashboard projects={state.projects} cloudUrl={cloudUrl} setCloudUrl={setCloudUrl} toast={toast} onOpenProject={id=>setCurView(id)} onOpenMyWork={()=>setCurView("mywork")} onEditProject={openEditProject} onDeleteProject={confirmDeleteProject} onAddProject={()=>setModal("addProj")} onImportJson={importJSON} onImportExcel={importExcel} departments={state.departments} canDeleteProjects={canDeleteProjects} dispatch={dispatch} loginUser={loginUser} activityLog={state.activityLog} syncLoading={cloudStatus==="loading"}/>
          :curView==="mywork"
          ?<MyWorkView projects={visibleProjects} loginUser={loginUser} departments={state.departments} dispatch={dispatch} toast={toast} onOpenProject={id=>{setCurView(id);setSubTab(p=>({...p,[id]:"tasks"}));}}/>
          :curProj?(()=>{
            const s=pStats(curProj);const sub=subTab[curProj.id]||"tasks";
            return(
              <ProjectPageShell
                project={curProj}
                stats={s}
                activeTab={sub}
                onTabChange={(t)=>sst(curProj.id,t)}
                onKickoffChange={(v)=>dispatch({type:"setKO",pid:curProj.id,v})}
                onAddPhase={()=>setModal("addPhase_"+curProj.id)}
                onEditProject={()=>openEditProject(curProj)}
                onDeleteProject={()=>confirmDeleteProject(curProj)}
                canDeleteProjects={canDeleteProjects}
              >
                {sub==="tasks"&&<TasksView proj={curProj} dispatch={dispatch} toast={toast} departments={state.departments} loginUser={loginUser} assigneeRoster={assigneeRoster}/>}
                {sub==="allocate"&&<BulkAllocateView proj={curProj} dispatch={dispatch} assigneeRoster={assigneeRoster} departments={state.departments} toast={toast} onEditDepartments={()=>setModal("deptHeads")}/>}
                {sub==="gantt"&&<GanttView proj={curProj}/>}
                {sub==="regs"&&<RegView proj={curProj} regStatus={regStatus} setRegStatus={setRegStatus}/>}
              </ProjectPageShell>
            );
          })()
          :<p style={{padding:40,color:C.tx3}}>View not found</p>
        }
      </main>

      <DepartmentHeadsModal open={modal==="deptHeads"} onClose={()=>setModal(null)} departments={state.departments} dispatch={dispatch} toast={toast}/>

      {/* Add Project Modal */}
      <Modal open={modal==="addProj"} onClose={()=>{setModal(null);setNewProj(emptyProjForm());}} title="Add New Project"
        footer={<><button className="btg" onClick={()=>{setModal(null);setNewProj(emptyProjForm());}}>Cancel</button>
          <button className="btp" onClick={()=>{
            if(!newProj.name.trim()){toast("Name required","err");return;}
            const pid="prj_"+Date.now();
            const phases=buildLifecyclePhasesForProject(pid);
            const{cp}=mkPhasesFor(pid);
            phases.push(cp);
            applyKickoffOffsets({...newProj,ko:newProj.ko,phases});
            dispatch({type:"addProject",proj:{...newProj,id:pid,phases}});
            const taskN=phases.reduce((s,ph)=>s+(ph.tasks?.length||0),0);
            setModal(null);setNewProj(emptyProjForm());setCurView(pid);
            toast(`Project created — ${taskN} activities scheduled from kickoff ${newProj.ko}`,"ok");
          }}>Create</button></>}>
        <ProjectFormFields form={newProj} setForm={setNewProj}/>
      </Modal>

      {/* Edit Project Modal */}
      <Modal open={modal==="editProj"} onClose={()=>{setModal(null);setEditProjId(null);}} title="Edit Project"
        footer={<><button className="btg" onClick={()=>{setModal(null);setEditProjId(null);}}>Cancel</button>
          <button className="btp" onClick={()=>{
            if(!editProj.name.trim()){toast("Name required","err");return;}
            if(!editProjId){setModal(null);return;}
            dispatch({type:"updProject",pid:editProjId,fields:editProj});
            setModal(null);setEditProjId(null);toast("Project updated","ok");
          }}>Save</button></>}>
        <ProjectFormFields form={editProj} setForm={setEditProj}/>
      </Modal>

      {/* Add Phase Modal */}
      {modal?.startsWith("addPhase_")&&(()=>{
        const pid=modal.replace("addPhase_","");
        let phaseName="",phaseCol=PCOL[0];
        return(
          <Modal open title="Add Phase" onClose={()=>setModal(null)}
            footer={<><button className="btg" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btp" onClick={()=>{dispatch({type:"addPhase",projId:pid,name:document.getElementById("ph_nm")?.value||"New Phase",col:document.getElementById("ph_col")?.value||PCOL[0]});setModal(null);toast("Phase added","ok");}}>Add</button></>}>
            <div className="fg"><label>Phase Name</label><input id="ph_nm" type="text" placeholder="e.g. Construction Readiness" defaultValue=""/></div>
            <div className="fg"><label>Color</label><input id="ph_col" type="color" defaultValue="#2A6E7A"/></div>
          </Modal>
        );
      })()}

    </div>
  );
}
