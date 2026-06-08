import React, { useState, useEffect, useRef, useCallback, useReducer, useMemo } from 'react';
import { MongoSyncAdapter } from "./mongoSync.jsx";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { cDates, dbDays } from "./preconDates.js";
import { downloadPreconExcel, collectAssignees, iterAllTasks } from "./preconExport.js";
import { importExcelIntoState, parseJsonState } from "./preconImport.js";
import {
  buildLifecyclePhasesForProject,
  mergeLifecycleIntoState,
  applyKickoffOffsets,
} from "./preconLifecycle.js";
import {
  ensureStateDepartments,
  getDepartmentForPhase,
  formatRoles,
  parseRolesInput,
  taskMatchesDepartment,
  taskMatchesRoleFilter,
  collectAllRoles,
} from "./preconDepartments.js";
import { PortfolioRagMatrix } from "./PortfolioRagMatrix.jsx";
import { ensureCommentCreatedAt, formatCommentLine, sortCommentsChronologically } from "./preconComments.js";
import { useLoginUser } from "./useLoginUser.js";
import { MyWorkView } from "./MyWorkView.jsx";
import { CommentForm } from "./CommentForm.jsx";
import { AttachmentLinks } from "./AttachmentPicker.jsx";
import { TaskActivityFiles } from "./TaskActivityFiles.jsx";
import { AssigneeMultiSelect } from "./AssigneeMultiSelect.jsx";
import { filterProjectsForUser, buildAssigneeRoster, assigneeMatches, projectsForAssigneeRoster } from "./preconAssignees.js";
import { migratePreWorkFollowUpState, applyGhqPreWorkToPhases } from "./preconGhqPreWorkMigrate.js";
import {
  taskStatus,
  taskStatusSelectValue,
  statusLabel,
  statusBadgeClass,
  todayDate,
  todayIso,
  TASK_STATUS_OPTIONS,
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
const mkT=(id,nm,dur,pred=[],par=null,ex={})=>({id,name:nm,dur,pred,par,ms:null,who:"",roles:Array.isArray(ex.roles)?ex.roles:[],comments:[],as:null,ae:null,status:"notstarted",...ex});
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
    ]
  };
  const merged = mergeLifecycleIntoState(init).state;
  migratePreWorkFollowUpState(merged);
  const ghq = merged.projects?.find((p) => p.id === "ghq");
  if (ghq) applyGhqPreWorkToPhases(ghq.phases);
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
.proj-sel-lbl{font-size:10px;font-weight:600;color:#96918A;text-transform:uppercase;letter-spacing:.4px;flex-shrink:0}
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
.mywork{margin:0 auto;max-width:1100px}
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
.mw-projects .mw-proj-chips{display:flex;flex-wrap:wrap;gap:6px}
.mw-proj-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;border:1px solid #E2DDD4;background:#fff;font-size:11px;cursor:pointer;user-select:none}
.mw-proj-chip.on{background:#EEF4FC;border-color:#1B5E9E;color:#1A304A}
.mw-proj-chip input{accent-color:#1A304A}
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
.ams-menu-hint{font-size:10px;color:#96918A;padding:4px 8px 8px}
.ams-opt{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:12px}
.ams-opt:hover{background:#F8F6F1}
.ams-opt.on{background:#EEF4FC}
.ams-opt input{accent-color:#1A304A;min-width:16px;min-height:16px}
.ams-empty{font-size:11px;color:#96918A;padding:8px}
.ams-clear{display:block;width:100%;margin-top:6px;padding:8px;border:none;background:#F3F0EA;color:#55504A;font-size:11px;border-radius:6px;cursor:pointer}
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
}
.stabs{display:flex;border-bottom:1.5px solid #E2DDD4;margin-bottom:18px}
.stab{padding:7px 15px;border:none;background:none;color:#55504A;font-size:12px;font-weight:500;cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-1.5px;transition:all .15s;font-family:'DM Sans',sans-serif}
.stab.act{color:#1A304A;border-bottom-color:#1A304A;font-weight:600}
.pjhdr{background:#fff;border:1px solid #E2DDD4;border-radius:8px;padding:18px 22px;margin-bottom:14px;display:flex;align-items:flex-start;justify-content:space-between;gap:20px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.ps{background:#fff;border:1px solid #E2DDD4;border-radius:8px;margin-bottom:10px;overflow:hidden}
.psh{padding:10px 14px;background:#F3F0EA;border-bottom:1px solid #E2DDD4;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none}
.ttable{width:100%;border-collapse:collapse}
.ttable th{padding:6px 9px;font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#96918A;text-align:left;border-bottom:1px solid #E2DDD4;background:#fff;white-space:nowrap;font-family:'DM Sans',sans-serif}
.ttable td{padding:6px 9px;border-bottom:1px solid rgba(0,0,0,.04);vertical-align:middle}
.trow:hover td{background:#F8F6F1}
.trow.trow-drag-over td{background:#FBF7EE;border-top:2px solid #C89A3A}
.tdrag{cursor:grab;color:#96918A;font-size:14px;line-height:1;user-select:none;padding:0 2px}
.tdrag:active{cursor:grabbing}
.tdrag.tdrag-off{opacity:.35;cursor:not-allowed}
.ec{border-radius:4px;padding:2px 4px;outline:none;font-size:12.5px;font-weight:500;font-family:'DM Sans',sans-serif;cursor:text;min-width:60px}
.ec:hover{background:#EAE6DC}
.ec:focus{outline:2px solid #C89A3A;background:#fff;border-radius:4px}
.di{padding:3px 6px;border:1.5px solid #C89A3A;border-radius:4px;background:#fff;font-size:12px;outline:none;width:122px;font-family:'DM Sans',sans-serif}
.ni{padding:3px 5px;border:1.5px solid #C89A3A;border-radius:4px;background:#fff;font-size:12px;outline:none;width:56px;font-family:'DM Sans',sans-serif}
.ti{width:100%;padding:3px 6px;border:1px solid #E2DDD4;border-radius:4px;background:transparent;font-size:12px;font-family:'DM Sans',sans-serif}
.ti:focus{outline:none;border-color:#C89A3A}
.tact{display:flex;gap:3px;opacity:0;transition:opacity .15s}
.trow:hover .tact{opacity:1}
.abt{width:21px;height:21px;border-radius:4px;border:none;background:transparent;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center}
.abt:hover{background:#EAE6DC}
.abt.del:hover{background:#FCECEA}
.cexp td{padding:14px 16px !important;background:#FBF7EE !important;vertical-align:top}
.cexp-inner{width:100%;max-width:100%;box-sizing:border-box}
.cform{display:flex;flex-direction:column;gap:12px;width:100%;max-width:520px}
.cform-meta{font-size:11px;color:#55504A;line-height:1.45;word-break:break-word}
.cform-field{display:flex;flex-direction:column;gap:4px;margin:0}
.cform-lbl{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.45px;color:#96918A}
.cform-inp,.cform-textarea{width:100%;max-width:100%;box-sizing:border-box;padding:10px 11px;border:1.5px solid #E2DDD4;border-radius:6px;background:#fff;font-size:16px;font-family:'DM Sans',sans-serif;color:#1A1815}
.cform-inp:focus,.cform-textarea:focus{outline:none;border-color:#C89A3A;box-shadow:0 0 0 2px rgba(200,154,58,.2)}
.cform-inp-date{min-height:44px}
.cform-textarea{resize:vertical;min-height:88px;line-height:1.45}
.cform-foot{display:flex;justify-content:flex-end;padding-top:2px}
.cform-foot .btp{min-height:44px;padding:10px 20px;font-size:13px}
.cform-rich{max-width:100%}
.c-email-meta{font-size:10px;color:#1B5E9E;margin-top:6px}
.att-pick{margin-top:4px;padding:10px 12px;background:#F8F6F1;border:1px dashed #E2DDD4;border-radius:8px}
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
.nrp{margin-top:4px;padding:10px 12px;background:#fff;border:1px solid #E2DDD4;border-radius:8px}
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
.nrp-auto-banner{font-size:11px;line-height:1.45;padding:8px 10px;background:#EEF4FC;border:1px solid #C5D9ED;border-radius:6px;color:#1A304A;margin-bottom:4px}
.nrp-auto-banner strong{color:#1B5E9E}
.nrp-auto-names{color:#55504A;font-weight:400}
.nrp-auto-warn{background:#FDF3E8;border-color:#E8C490;color:#AE6418}
.nrp-extras{margin-top:0}
.task-files{margin:10px 0;padding:10px 12px;background:#fff;border:1px solid #E2DDD4;border-radius:8px}
.task-files-head{margin-bottom:8px}
.task-files-title{font-size:11px;font-weight:700;color:#1A304A;display:block}
.task-files-sub{font-size:10px;color:#96918A}
.mw-editor-wrap{margin-top:8px;padding-top:8px;border-top:1px solid #E2DDD4}
.mw-comment-history{margin-bottom:12px}
.mw-comment-history-title{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#9A6E20;margin-bottom:8px}
.mw-ch-item{margin-bottom:7px}
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
.mbox{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:600;background:#fff;border:1px solid #E2DDD4;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.12);width:560px;max-width:calc(100vw - 32px);max-height:80vh;display:flex;flex-direction:column}
.mbox.wide{width:700px}
.fg{margin-bottom:13px}
.fg label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#96918A;margin-bottom:4px;font-weight:600}
.fg input,.fg select,.fg textarea{width:100%;padding:7px 9px;border:1px solid #E2DDD4;border-radius:5px;font-size:13px;background:#fff;color:#1A1815;font-family:'DM Sans',sans-serif}
.fg input:focus,.fg select:focus,.fg textarea:focus{outline:none;border-color:#C89A3A}
.fgrid{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.tarea{position:fixed;bottom:18px;right:18px;z-index:700;display:flex;flex-direction:column;gap:7px;pointer-events:none}
.toast{background:#1A304A;color:#fff;padding:9px 14px;border-radius:5px;font-size:12px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.15);opacity:0;transform:translateY(6px);transition:all .2s;pointer-events:auto}
.toast.show{opacity:1;transform:none}.toast.ok{background:#1A6A3C}.toast.err{background:#B32E1E}
.gtt{position:fixed;background:#1A304A;color:#fff;padding:9px 13px;border-radius:5px;font-size:12px;z-index:400;pointer-events:none;opacity:0;transition:opacity .12s;max-width:230px;box-shadow:0 4px 16px rgba(0,0,0,.2)}
.gtt.show{opacity:1}
.codebox{background:#12131A;color:#E8D49A;padding:13px;border-radius:5px;font-family:monospace;font-size:10.5px;line-height:1.6;max-height:210px;overflow-y:auto;white-space:pre-wrap;word-break:break-all}
.ppbar{height:3px;background:#E2DDD4;border-radius:2px;width:70px;overflow:hidden;display:inline-block;vertical-align:middle}
.ppfill{height:100%;border-radius:2px}
.tnav-brand{display:flex;align-items:center;gap:9px;flex-shrink:0}
.tnav-row{display:contents}
.tnav-menu-btn{display:none;align-items:center;justify-content:center;padding:8px 12px;border:1px solid #E2DDD4;border-radius:6px;background:#fff;color:#1A304A;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;margin-left:auto}
.ttable-wrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -2px}
.ttable-wrap .ttable{min-width:720px}
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
  .tnav{position:sticky;top:0;flex-direction:column;align-items:stretch;padding:10px 12px;gap:8px}
  .tnav-row{display:flex;align-items:center;width:100%;gap:8px;min-width:0}
  .tnav-brand{border-right:none;padding-right:0;margin-right:0;flex:1;min-width:0}
  .tnav-menu-btn{display:inline-flex;flex-shrink:0}
  .proj-sel-wrap{width:100%;padding:0;display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px 10px}
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
  .cexp-inner{max-width:none}
  .kgrid{grid-template-columns:repeat(2,1fr);gap:8px}
  .pgrid{grid-template-columns:1fr}
  .dg2{grid-template-columns:1fr}
  .fgrid{grid-template-columns:1fr}
  .rgrid{grid-template-columns:1fr}
  .pjhdr{flex-direction:column;align-items:stretch;padding:14px 16px;gap:14px}
  .pjhdr-stats{text-align:left}
  .pjhdr-stats .disp{font-size:32px}
  .pjhdr-actions{justify-content:flex-start!important}
  .stabs{margin-bottom:14px}
  .stab{padding:10px 14px;font-size:13px;min-height:44px;white-space:nowrap}
  .psh{flex-wrap:wrap;gap:8px;padding:12px}
  .task-tip{display:none}
  .tact{opacity:1}
  .abt,.bts,.btg{min-height:40px;min-width:40px}
  .di{width:100%;max-width:140px}
  .ni{width:64px}
  .gsplit{flex-direction:column;max-height:none}
  .gnames{width:100%;max-height:min(220px,35vh);border-right:none;border-bottom:1.5px solid #E2DDD4}
  .gchart{min-height:240px}
  .mbox{width:calc(100vw - 20px);max-height:min(88vh,100dvh - 24px)}
  .mbox.wide{width:calc(100vw - 20px)}
  .tarea{bottom:max(12px,env(safe-area-inset-bottom,12px));right:12px;left:12px;align-items:stretch}
  .toast{text-align:center}
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
  .ttable-wrap .ttable{min-width:640px}
  .cexp td{padding:12px 10px!important}
  .cform{max-width:none}
  .cform-foot .btp{width:100%}
  tr.cexp-tr td{display:block;width:100%;box-sizing:border-box;border-bottom:1px solid #E2DDD4}
}
`;

function ActionFilters({
  horizonDays,
  setHorizonDays,
  statusFilter,
  setStatusFilter,
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
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
        <option value="">All</option>
        {TASK_STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        <option value="overdue">Overdue</option>
      </select>
      <label>Assignee</label>
      <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
        <option value="">All</option>
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

function taskPassesFilters(t, dm, phaseName, { statusFilter, assigneeFilter, departmentFilter, departments, roleFilter, horizonDays, todayStr }) {
  if (assigneeFilter && !assigneeMatches(t.who, assigneeFilter)) return false;
  if (!taskMatchesDepartment(t, phaseName, departmentFilter, departments)) return false;
  if (!taskMatchesRoleFilter(t, roleFilter)) return false;
  const st = taskStatus(t, dm);
  if (statusFilter) {
    if (statusFilter === 'overdue' ? st !== 'overdue' : st !== statusFilter) return false;
  }
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

// ── TOAST HOOK ───────────────────────────────────────────
function useToasts(){
  const[toasts,setToasts]=useState([]);
  const add=useCallback((msg,type="")=>{
    const id=Date.now();
    setToasts(p=>[...p,{id,msg,type}]);
    setTimeout(()=>setToasts(p=>p.map(t=>t.id===id?{...t,show:true}:t)),10);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),2800);
  },[]);
  return{toasts,toast:add};
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
  return(
    <div className="gw">
      <div style={{padding:"8px 13px",background:"#F3F0EA",borderBottom:"1px solid #E2DDD4",display:"flex",gap:12,fontSize:11,color:"#96918A",flexWrap:"wrap"}}>
        {Object.entries(SCOL).map(([k,v])=><span key={k}><span style={{display:"inline-block",width:8,height:8,borderRadius:2,background:v,marginRight:3,verticalAlign:"middle"}}/>{k}</span>)}
        <span style={{marginLeft:"auto",color:"#9A6E20"}}><span style={{display:"inline-block",width:2,height:12,background:"#C89A3A",marginRight:4,verticalAlign:"middle"}}/> Today</span>
      </div>
      <div className="gsplit">
        <div ref={namesRef} className="gnames">
          <div style={{height:28,background:"#F3F0EA",borderBottom:"1px solid #E2DDD4",display:"flex",alignItems:"center",padding:"0 11px",fontSize:10,textTransform:"uppercase",letterSpacing:".7px",color:"#96918A",flexShrink:0}}>Task / Phase</div>
          {proj.phases.map(ph=>(
            <div key={ph.id}>
              <div className="gphn" style={{color:ph.col,borderLeft:`3px solid ${ph.col}`}}>{ph.name}</div>
              {ph.tasks.map(t=><div key={t.id} className="gtn" title={t.name}><span style={{fontSize:11.5,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.name}</span></div>)}
            </div>
          ))}
        </div>
        <div ref={chartRef} className="gchart">
          <div className="gmhdr" style={{minWidth:TW}}>
            {months.map((m,i)=><div key={i} className="gmon" style={{width:Math.round(m.d*DPX)}}>{m.lbl}</div>)}
            {TL}
          </div>
          {proj.phases.map(ph=>(
            <div key={ph.id}>
              <div className="gphc" style={{minWidth:TW,background:ph.col+"10"}}>{gridLines}{TL}</div>
              {ph.tasks.map(t=>{
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
          ))}
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

function TasksView({proj,dispatch,toast,departments,loginUser,assigneeRoster}){
  const dm=cDates(proj);
  const[expandedC,setExpandedC]=useState({});
  const[expandedPh,setExpandedPh]=useState({});
  const[dragTask,setDragTask]=useState(null);
  const[dragOverId,setDragOverId]=useState(null);
  const[horizonDays,setHorizonDays]=useState(null);
  const[statusFilter,setStatusFilter]=useState("");
  const[assigneeFilter,setAssigneeFilter]=useState("");
  const[departmentFilter,setDepartmentFilter]=useState("");
  const[roleFilter,setRoleFilter]=useState("");
  const assignees=useMemo(()=>collectAssignees([proj]),[proj]);
  const roleOptions=useMemo(()=>collectAllRoles([proj]),[proj]);
  const todayStr=todayIso();
  const filters={statusFilter,assigneeFilter,departmentFilter,departments,roleFilter,horizonDays,todayStr};
  const filtersActive=!!(statusFilter||assigneeFilter||departmentFilter||roleFilter||horizonDays!=null);
  const expandAll=()=>{
    const next={};
    proj.phases.forEach(ph=>{next[phaseExpandKey(proj.id,ph.id)]=true;});
    setExpandedPh(next);
  };
  const collapseAll=()=>{
    const next={};
    proj.phases.forEach(ph=>{next[phaseExpandKey(proj.id,ph.id)]=false;});
    setExpandedPh(next);
  };
  const dropReorder=(ph,fromId,toId)=>{
    if(!fromId||!toId||fromId===toId)return;
    dispatch({type:"reorderTask",projId:proj.id,phId:ph.id,fromId,toId});
    toast("Task order updated","ok");
  };
  const moveTaskByStep=(ph,tId,dir)=>{
    const idx=ph.tasks.findIndex(x=>x.id===tId);
    const to=idx+dir;
    if(idx<0||to<0||to>=ph.tasks.length)return;
    dispatch({type:"reorderTask",projId:proj.id,phId:ph.id,fromId:tId,toId:ph.tasks[to].id});
  };
  const authorName=loginUser?.ready?(loginUser.name||"User"):"";
  return(
    <div>
      <ActionFilters horizonDays={horizonDays} setHorizonDays={setHorizonDays} statusFilter={statusFilter} setStatusFilter={setStatusFilter} assigneeFilter={assigneeFilter} setAssigneeFilter={setAssigneeFilter} assignees={assignees} departmentFilter={departmentFilter} setDepartmentFilter={setDepartmentFilter} departments={departments} roleFilter={roleFilter} setRoleFilter={setRoleFilter} roleOptions={roleOptions} allowAllHorizon/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <span className="task-tip" style={{fontSize:12,color:C.tx3}}>💡 Drag ⋮⋮ to set chronology · {filtersActive?"Clear filters to reorder":"Expand phases below"}</span>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          <button type="button" className="btg" onClick={expandAll} title="Open every phase section">Expand all</button>
          <button type="button" className="btg" onClick={collapseAll} title="Close every phase section">Collapse all</button>
          <button className="btg" onClick={()=>dispatch({type:"addPhase",projId:proj.id})}>+ Phase</button>
          <button className="btg" onClick={()=>{
            const dm2=cDates(proj);let csv="Phase,Task,Start,End,Dur,Roles (Process),Assignee,Status,Comments\n";
            proj.phases.forEach(ph=>ph.tasks.forEach(t=>{
              if(!taskPassesFilters(t,dm2,ph.name,filters))return;
              const d=dm2[t.id]||{s:"",e:""};
              const cm=sortCommentsChronologically(t.comments).map(({comment:c})=>formatCommentLine(c)).join(" | ");
              csv+=`"${ph.name}","${t.name}","${d.s}","${d.e}","${t.dur}","${formatRoles(t)}","${t.who||""}","${statusLabel(taskStatus(t,dm2))}","${cm.replace(/"/g,'""')}"\n`;
            }));
            const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=proj.name.replace(/\s+/g,"_")+"_Schedule.csv";a.click();toast("CSV exported","ok");
          }}>Export CSV</button>
        </div>
      </div>
      {proj.phases.map((ph,pi)=>{
        const visible=ph.tasks.filter(t=>taskPassesFilters(t,dm,ph.name,filters));
        if(departmentFilter&&visible.length===0)return null;
        const comp=visible.filter(t=>taskStatus(t,dm)==="completed").length;
        const pct=visible.length?Math.round(comp/visible.length*100):0;
        const ek=phaseExpandKey(proj.id,ph.id);
        const isOpen=expandedPh[ek]!==false;
        const dept=getDepartmentForPhase(ph.name,departments);
        return(
          <div key={ph.id} className="ps">
            <div className="psh" onClick={()=>setExpandedPh(p=>({...p,[ek]:!isOpen}))}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span style={{fontSize:11,color:C.tx3,width:14,textAlign:"center",flexShrink:0}} aria-hidden>{isOpen?"▾":"▸"}</span>
                <div style={{width:9,height:9,borderRadius:"50%",background:ph.col,flexShrink:0}}/>
                <span style={{fontSize:12,fontWeight:600,textTransform:"uppercase",letterSpacing:".5px",color:ph.col}}>{ph.name}</span>
                {dept?<span style={{fontSize:10,color:C.tx2,background:C.sf2,padding:"2px 8px",borderRadius:4}} title="Department head">{dept.name} · {dept.head}</span>:null}
                <span style={{fontSize:11,color:C.tx3}}>{visible.length}{visible.length!==ph.tasks.length?` / ${ph.tasks.length}`:""} tasks</span>
                <div className="ppbar"><div className="ppfill" style={{width:`${pct}%`,background:ph.col}}/></div>
                <span style={{fontSize:11,color:C.tx3}}>{pct}%</span>
              </div>
              <div style={{display:"flex",gap:5}} onClick={e=>e.stopPropagation()}>
                <button className="bts" onClick={()=>dispatch({type:"addTask",projId:proj.id,phId:ph.id,afterId:null})}>+ Task</button>
                <button className="bts" onClick={()=>{if(confirm(`Delete phase "${ph.name}"?`))dispatch({type:"delPhase",projId:proj.id,phId:ph.id});}}>✕</button>
              </div>
            </div>
            {isOpen&&<div className="ttable-wrap"><table className="ttable">
              <thead><tr>
                <th style={{width:22}} aria-label="Reorder"/>
                <th style={{width:26}}>#</th><th>Task</th><th>Roles (Process)</th><th>Start ✏️</th><th>Dur</th><th>End</th>
                <th>Assignee</th><th>Status</th><th>Log</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {visible.map((t)=>{
                  const seqIdx=ph.tasks.findIndex(x=>x.id===t.id)+1;
                  const d=dm[t.id]||{s:"",e:""};const st=taskStatus(t,dm);const od=st==="overdue"?dbDays(d.e,todayStr):0;
                  const cc=t.comments.length;
                  const showC=expandedC[t.id];
                  const canDrag=!filtersActive;
                  const isDragOver=dragOverId===t.id&&dragTask?.phId===ph.id;
                  return(
                    <React.Fragment key={t.id}>
                      <tr className={`trow${isDragOver?" trow-drag-over":""}`}
                        onDragOver={e=>{if(!canDrag||!dragTask||dragTask.phId!==ph.id)return;e.preventDefault();e.dataTransfer.dropEffect="move";setDragOverId(t.id);}}
                        onDragLeave={()=>{if(dragOverId===t.id)setDragOverId(null);}}
                        onDrop={e=>{
                          e.preventDefault();
                          setDragOverId(null);
                          if(!canDrag||!dragTask||dragTask.phId!==ph.id)return;
                          dropReorder(ph,dragTask.tId,t.id);
                          setDragTask(null);
                        }}
                      >
                        <td style={{textAlign:"center",verticalAlign:"middle"}}>
                          <span className={`tdrag${canDrag?"":" tdrag-off"}`} draggable={canDrag} title={canDrag?"Drag to reorder":"Clear filters to reorder"}
                            onDragStart={e=>{if(!canDrag){e.preventDefault();return;}setDragTask({phId:ph.id,tId:t.id});e.dataTransfer.effectAllowed="move";}}
                            onDragEnd={()=>{setDragTask(null);setDragOverId(null);}}
                          >⋮⋮</span>
                        </td>
                        <td style={{textAlign:"center",color:C.tx3,fontSize:11}}>{seqIdx}</td>
                        <td style={{minWidth:180}}>
                          <div className="ec" contentEditable suppressContentEditableWarning
                            onBlur={e=>dispatch({type:"updTask",projId:proj.id,phId:ph.id,tId:t.id,f:"name",v:e.target.textContent.trim()})}
                            onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();e.target.blur();}}}
                          >{t.name}</div>
                        </td>
                        <td>
                          <input type="text" className="ti" defaultValue={formatRoles(t)} placeholder="e.g. Acq Lead, Architect" title="Roles from Process sheet — comma-separated"
                            style={{width:200,minWidth:140}} onBlur={e=>dispatch({type:"updTask",projId:proj.id,phId:ph.id,tId:t.id,f:"roles",v:e.target.value})}/>
                        </td>
                        <td><input type="date" className="di" defaultValue={t.ms||d.s||""} onChange={e=>dispatch({type:"setMS",projId:proj.id,phId:ph.id,tId:t.id,v:e.target.value||null})}/></td>
                        <td><input type="number" className="ni" defaultValue={t.dur} min={1} max={999} onChange={e=>dispatch({type:"updTask",projId:proj.id,phId:ph.id,tId:t.id,f:"dur",v:parseInt(e.target.value)||1})}/></td>
                        <td style={{color:C.tx2,fontSize:12,whiteSpace:"nowrap"}}>{fmt(d.e)}</td>
                        <td>
                          <AssigneeMultiSelect compact value={t.who||""} options={assigneeRoster} onChange={v=>dispatch({type:"updTask",projId:proj.id,phId:ph.id,tId:t.id,f:"who",v})}/>
                        </td>
                        <td>
                          <select className="bts" style={{minWidth:118,fontWeight:600,color:SCOL[st]||C.gray}}
                            value={taskStatusSelectValue(t)}
                            onChange={e=>dispatch({type:"setTaskStatus",projId:proj.id,phId:ph.id,tId:t.id,v:e.target.value})}>
                            {TASK_STATUS_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          {st==="overdue"&&<span className="badge bov" style={{marginLeft:4}}>+{od}d</span>}
                        </td>
                        <td><button className="bts" onClick={()=>setExpandedC(p=>({...p,[t.id]:!p[t.id]}))}>💬{cc||""}</button></td>
                        <td><div className="tact">
                          <button type="button" className="abt" title="Move up" disabled={filtersActive||seqIdx<=1} onClick={()=>moveTaskByStep(ph,t.id,-1)}>↑</button>
                          <button type="button" className="abt" title="Move down" disabled={filtersActive||seqIdx>=ph.tasks.length} onClick={()=>moveTaskByStep(ph,t.id,1)}>↓</button>
                          <button className="abt" title="Done" onClick={()=>{dispatch({type:"markDone",projId:proj.id,phId:ph.id,tId:t.id});toast("Marked complete","ok");}}>✓</button>
                          <button className="abt" title="Add after" onClick={()=>dispatch({type:"addTask",projId:proj.id,phId:ph.id,afterId:t.id})}>+</button>
                          <button className="abt del" title="Delete" onClick={()=>{if(confirm(`Delete "${t.name}"?`))dispatch({type:"delTask",projId:proj.id,phId:ph.id,tId:t.id});}}>🗑</button>
                        </div></td>
                      </tr>
                      {showC&&<tr className="cexp-tr"><td colSpan={11} className="cexp">
                        <div className="cexp-inner">
                        <div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:".5px",color:C.gold,marginBottom:10}}>Comments — {t.name}</div>
                        {t.comments.length>0?<div style={{marginBottom:12}}>
                          {sortCommentsChronologically(t.comments).map(({comment:cm,index:ci})=>(
                            <div key={`${ci}-${cm.createdAt||cm.ts||''}`} className="citem">
                              <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",gap:4,marginBottom:3}}>
                                <span style={{fontSize:11,fontWeight:600,color:C.navy}}>{cm.author||"Anon"}</span>
                                <span style={{fontSize:10,color:C.tx3}}>{cm.ts}</span>
                              </div>
                              <div style={{fontSize:12,color:C.tx,lineHeight:1.5}}>{cm.text}</div>
                              {(cm.nextAction||cm.nextActionDate)?<div style={{fontSize:11,color:C.navy,marginTop:6,lineHeight:1.45}}>
                                <span style={{fontWeight:600}}>Next action:</span> {cm.nextAction||"—"}
                                {cm.nextActionDate?<span style={{color:C.tx2}}> · Due {fmt(cm.nextActionDate)}</span>:null}
                              </div>:null}
                              <AttachmentLinks attachments={cm.attachments}/>
                              {cm.attachmentsPending?<div className="c-email-meta">📎 Uploading attachments…</div>:cm.attachmentError?<div className="c-email-meta">📎 Attachment failed: {cm.attachmentError}</div>:null}
                              {cm.notifyRecipients?.length?<div className="c-email-meta">
                                {cm.emailSent?`✉ Sent to ${cm.notifyRecipients.map(r=>r.name||r.email).join(", ")}`:cm.emailQueued?`✉ Email queued for ${cm.notifyRecipients.map(r=>r.name||r.email).join(", ")}`:cm.emailError?`✉ Email failed: ${cm.emailError}`:cm.notifyPending!==false?"✉ Sending notifications…":"✉ Notify pending"}
                              </div>:null}
                            </div>
                          ))}
                        </div>:<div style={{fontSize:12,color:C.tx3,fontStyle:"italic",marginBottom:10}}>No comments yet</div>}
                        <TaskActivityFiles proj={proj} ph={ph} task={t} dispatch={dispatch} toast={toast} authorName={authorName}/>
                        <CommentForm
                          projectId={proj.id}
                          taskId={t.id}
                          taskWho={t.who||""}
                          departments={departments}
                          authorName={authorName}
                          authorEmail={loginUser?.email}
                          projectName={proj.name}
                          phaseName={ph.name}
                          taskName={t.name}
                          taskAttachmentIds={(t.attachments||[]).map(a=>a.id).filter(Boolean)}
                          toast={toast}
                          onSaved={(comment)=>{
                            const idx=t.comments.length;
                            dispatch({type:"addComment",projId:proj.id,phId:ph.id,tId:t.id,comment});
                            setTimeout(()=>setExpandedC(p=>({...p,[t.id]:true})),50);
                            return idx;
                          }}
                          onNotifyComplete={(patch,commentIndex)=>{
                            dispatch({type:"updComment",projId:proj.id,phId:ph.id,tId:t.id,commentIndex,patch});
                          }}
                        />
                        </div>
                      </td></tr>}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table></div>}
          </div>
        );
      }).filter(Boolean)}
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

function Dashboard({projects,cloudUrl,setCloudUrl,toast,onOpenProject,onOpenMyWork,onEditProject,onDeleteProject,onAddProject,onImportJson,onImportExcel,departments}){
  const[horizonDays,setHorizonDays]=useState(30);
  const[statusFilter,setStatusFilter]=useState("");
  const[assigneeFilter,setAssigneeFilter]=useState("");
  const[departmentFilter,setDepartmentFilter]=useState("");
  const[roleFilter,setRoleFilter]=useState("");
  const assignees=useMemo(()=>collectAssignees(projects),[projects]);
  const roleOptions=useMemo(()=>collectAllRoles(projects),[projects]);
  const todayStr=todayIso();
  const filters={statusFilter,assigneeFilter,departmentFilter,departments,roleFilter,horizonDays,todayStr};
  const allStats=projects.map(p=>({p,s:pStats(p)}));
  const tT=allStats.reduce((a,x)=>a+x.s.tot,0),tC=allStats.reduce((a,x)=>a+x.s.comp,0),
        tO=allStats.reduce((a,x)=>a+x.s.ov,0),tI=allStats.reduce((a,x)=>a+x.s.ip,0);
  const op=tT?Math.round(tC/tT*100):0;
  const statusData=[{name:"Completed",v:tC,c:"#1A6A3C"},{name:"In Progress",v:tI,c:"#1B5E9E"},{name:"Overdue",v:tO,c:"#B32E1E"},{name:"Not Started",v:allStats.reduce((a,x)=>a+x.s.up,0),c:"#9A9590"}];
  const ghq=projects.find(p=>p.id==="ghq");
  const phaseData=ghq?ghq.phases.map(ph=>{const dm=cDates(ghq);const c=ph.tasks.filter(t=>taskStatus(t,dm)==="completed").length;return{name:ph.name.substring(0,12),pct:ph.tasks.length?Math.round(c/ph.tasks.length*100):0,col:ph.col};}):[];
  const upcoming=[],iss=[];
  projects.forEach(proj=>{
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
      t.comments.forEach(c=>{if(c.flag)iss.push({proj,ph,t,d,com:c});});
    }));
  });
  upcoming.sort((a,b)=>a.ds-b.ds);
  return(
    <div>
      <div style={{marginBottom:20}}>
        <h1 className="disp" style={{fontSize:30,fontWeight:600,color:C.navy,lineHeight:1.1}}>Pre-Construction Command Centre</h1>
        <p style={{color:C.tx2,fontSize:13,marginTop:4}}>Golden Abodes · {projects.length} Projects · {fmt(todayStr)}</p>
        <div className="dash-actions">
          {onOpenMyWork?<button type="button" className="mw-cta" onClick={onOpenMyWork}>◎ My Work — your assignments</button>:null}
          {onAddProject?<button type="button" className="btp-add" onClick={onAddProject}>+ Add project</button>:null}
          {onImportJson?<label className="file-lbl">Import JSON<input type="file" accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f)onImportJson(f);e.target.value="";}}/></label>:null}
          {onImportExcel?<label className="file-lbl">Import Excel<input type="file" accept=".xlsx,.xls" onChange={e=>{const f=e.target.files?.[0];if(f)onImportExcel(f);e.target.value="";}}/></label>:null}
        </div>
      </div>
      <PortfolioRagMatrix projects={projects} departments={departments} onOpenProject={onOpenProject}/>
      <div className="kgrid">
        {[{l:"Total Tasks",v:tT,c:C.navy},{l:"Completed",v:tC,c:C.green,sub:`${op}% overall`},{l:"In Progress",v:tI,c:C.blue},{l:"Overdue",v:tO,c:C.red,sub:tO>0?"Needs attention":"All on track"},{l:"Projects",v:projects.length,c:C.gold}].map((k,i)=>(
          <div key={i} className="kcard" style={{"--acc":k.c}}>
            <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".8px",color:C.tx3,marginBottom:7}}>{k.l}</div>
            <div className="disp" style={{fontSize:30,fontWeight:600,color:k.c,lineHeight:1}}>{k.v}</div>
            {k.sub&&<div style={{fontSize:11,color:C.tx3,marginTop:3}}>{k.sub}</div>}
          </div>
        ))}
      </div>
      <div className="pgrid">
        {allStats.map(({p,s})=>{
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
                <div style={{fontSize:11,color:C.tx3,marginTop:1}}>{p.loc} · {p.floors}F</div>
                <div style={{display:"flex",gap:7,marginTop:4,fontSize:11}}>
                  <span style={{color:C.green}}>✓{s.comp}</span>
                  <span style={{color:C.blue}}>{s.ip} active</span>
                  <span style={{color:C.red}}>{s.ov} late</span>
                </div>
                {nxt&&<div style={{fontSize:11,color:C.tx3,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>↳ {nxt.name}</div>}
                <div style={{display:"flex",gap:5,marginTop:8}} onClick={e=>e.stopPropagation()}>
                  {onEditProject&&<button type="button" className="bts" onClick={()=>onEditProject(p)}>Edit</button>}
                  {onDeleteProject&&<button type="button" className="btd bts" onClick={()=>onDeleteProject(p)}>Delete</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <ActionFilters horizonDays={horizonDays} setHorizonDays={setHorizonDays} statusFilter={statusFilter} setStatusFilter={setStatusFilter} assigneeFilter={assigneeFilter} setAssigneeFilter={setAssigneeFilter} assignees={assignees} departmentFilter={departmentFilter} setDepartmentFilter={setDepartmentFilter} departments={departments} roleFilter={roleFilter} setRoleFilter={setRoleFilter} roleOptions={roleOptions}/>
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
    </div>
  );
}

// ── REDUCER ──────────────────────────────────────────────
function reducer(state,action){
  const S=JSON.parse(JSON.stringify(state));
  const fp=(pid)=>S.projects.find(p=>p.id===pid);
  const fph=(pid,phid)=>fp(pid)?.phases.find(ph=>ph.id===phid);
  const ft=(pid,phid,tid)=>fph(pid,phid)?.tasks.find(t=>t.id===tid);
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
      else t[action.f]=action.v;
      break;
    }
    case"setDepartmentHead":{
      const d=(S.departments||[]).find(x=>x.id===action.deptId);
      if(d)d.head=typeof action.head==="string"?action.head:"";
      break;
    }
    case"setMS":{const t=ft(action.projId,action.phId,action.tId);if(t)t.ms=action.v;break;}
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
    case"delTask":{const ph=fph(action.projId,action.phId);if(ph)ph.tasks=ph.tasks.filter(t=>t.id!==action.tId);break;}
    case"addTask":{
      const ph=fph(action.projId,action.phId);if(!ph)break;
      const id=uid();const nt=mkT(id,action.name||"New Task",action.dur||7,action.pred||[],null,action.ex||{});
      if(action.afterId){const i=ph.tasks.findIndex(t=>t.id===action.afterId);if(i>=0){ph.tasks.splice(i+1,0,nt);break;}}
      ph.tasks.push(nt);break;
    }
    case"reorderTask":{
      const ph=fph(action.projId,action.phId);if(!ph||!ph.tasks?.length)break;
      const fromIdx=ph.tasks.findIndex(t=>t.id===action.fromId);
      const toIdx=ph.tasks.findIndex(t=>t.id===action.toId);
      if(fromIdx<0||toIdx<0||fromIdx===toIdx)break;
      const[item]=ph.tasks.splice(fromIdx,1);
      ph.tasks.splice(toIdx,0,item);
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
    case"loadState":{
      const{state:merged,totalAdded}=mergeLifecycleIntoState(action.state);
      migratePreWorkFollowUpState(merged);
      ensureStateDepartments(merged);
      (merged.projects||[]).forEach(proj=>{
        (proj.phases||[]).forEach(ph=>{
          (ph.tasks||[]).forEach(t=>{
            if(!t.status){
              if(t.ae)t.status="completed";
              else if(t.as)t.status="inprogress";
              else t.status="notstarted";
            }
            if(!Array.isArray(t.roles))t.roles=parseRolesInput(t.roles);
            if(Array.isArray(t.comments)){
              t.comments=t.comments.map((c)=>ensureCommentCreatedAt(c));
            }
          });
        });
      });
      return merged;
    }
    default:break;
  }
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
  const loginUser=useLoginUser();
  const{toasts,toast}=useToasts();
  const visibleProjects=useMemo(()=>filterProjectsForUser(state.projects,loginUser),[state.projects,loginUser]);
  const curProj=state.projects.find(p=>p.id===curView);
  const rosterProjects=useMemo(()=>projectsForAssigneeRoster(state.projects,loginUser,curProj),[state.projects,loginUser,curProj]);
  const assigneeRoster=useMemo(()=>buildAssigneeRoster(rosterProjects,state.departments,loginUser),[rosterProjects,state.departments,loginUser]);
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
    if(!p||!confirm(`Delete project "${p.name}" and all its tasks?`))return;
    dispatch({type:"delProject",pid:p.id});
    if(curView===p.id)setCurView("dashboard");
    toast("Project deleted","ok");
  };
  const openEditProject=(p)=>{
    if(!p)return;
    setEditProjId(p.id);
    setEditProj(projFormFromProject(p));
    setModal("editProj");
  };

  return(
    <div style={{minHeight:"100dvh",background:C.bg,maxWidth:"100vw",overflowX:"hidden"}}>
      <MongoSyncAdapter state={state} dispatch={dispatch} toast={toast} flushRef={mongoFlushRef} onSyncStatus={setCloudStatus}/>
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
          <label className="proj-sel-lbl" htmlFor="ga-precon-view">Project</label>
          <select
            id="ga-precon-view"
            className="proj-sel"
            value={viewSelectValue}
            onChange={e=>{sv(e.target.value);setNavOpen(false);}}
            aria-label="Select dashboard or project"
          >
            <option value="dashboard">Dashboard — all projects</option>
            <option value="mywork">My Work — your assignments</option>
            {visibleProjects.map(p=><option key={p.id} value={p.id}>{p.name}{p.loc?` · ${p.loc}`:""}</option>)}
          </select>
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
          <span style={{fontSize:10,color:C.tx3,padding:"0 4px",whiteSpace:"nowrap"}} title="MongoDB sync">{CLOUD_LABELS[cloudStatus]||cloudStatus}</span>
          <button type="button" className="btp" onClick={()=>{if(mongoFlushRef.current)mongoFlushRef.current();else toast("Cloud save unavailable","err");}}>Save</button>
        </div>
      </nav>

      <main className="main">
        {curView==="dashboard"
          ?<Dashboard projects={visibleProjects} cloudUrl={cloudUrl} setCloudUrl={setCloudUrl} toast={toast} onOpenProject={id=>setCurView(id)} onOpenMyWork={()=>setCurView("mywork")} onEditProject={openEditProject} onDeleteProject={confirmDeleteProject} onAddProject={()=>setModal("addProj")} onImportJson={importJSON} onImportExcel={importExcel} departments={state.departments}/>
          :curView==="mywork"
          ?<MyWorkView projects={visibleProjects} loginUser={loginUser} departments={state.departments} dispatch={dispatch} toast={toast} onOpenProject={id=>{setCurView(id);setSubTab(p=>({...p,[id]:"tasks"}));}}/>
          :curProj?(()=>{
            const s=pStats(curProj);const sub=subTab[curProj.id]||"tasks";
            return(
              <div>
                <div className="pjhdr">
                  <div>
                    <h2 className="disp" style={{fontSize:24,fontWeight:600,color:C.navy}}>{curProj.name}</h2>
                    <div style={{display:"flex",gap:14,marginTop:7,flexWrap:"wrap",fontSize:12,color:C.tx2}}>
                      <span>📍 <strong>{curProj.loc}</strong></span>
                      <span>{curProj.type} · {curProj.floors}F</span>
                      <span className={`badge ${curProj.status==="Pre-Construction"?"bip":"bup"}`}>{curProj.status}</span>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginTop:8}}>
                      <label style={{fontSize:11,color:C.tx3}}>Kickoff:</label>
                      <input type="date" defaultValue={curProj.ko} onChange={e=>dispatch({type:"setKO",pid:curProj.id,v:e.target.value})} style={{padding:"3px 7px",border:`1px solid ${C.bd}`,borderRadius:4,fontSize:12,fontFamily:"'DM Sans',sans-serif"}}/>
                      <span style={{fontSize:11,color:C.tx3}}>↳ cascades to all auto-dates</span>
                    </div>
                  </div>
                  <div className="pjhdr-stats">
                    <div className="disp" style={{fontSize:40,fontWeight:600,color:C.navy,lineHeight:1}}>{s.pct}%</div>
                    <div style={{fontSize:11,color:C.tx3,textTransform:"uppercase",letterSpacing:".6px"}}>Complete</div>
                    <div className="pjhdr-actions" style={{display:"flex",gap:8,marginTop:6,fontSize:11,justifyContent:"flex-end"}}>
                      <span style={{color:C.green}}>✓{s.comp}</span><span style={{color:C.blue}}>{s.ip} active</span>
                      <span style={{color:C.red}}>{s.ov} late</span><span style={{color:C.gray}}>{s.up} upcoming</span>
                    </div>
                    <div className="pjhdr-actions" style={{display:"flex",gap:5,marginTop:9,justifyContent:"flex-end",flexWrap:"wrap"}}>
                      <button className="bts" onClick={()=>setModal("addPhase_"+curProj.id)}>+ Phase</button>
                      <button className="bts" onClick={()=>openEditProject(curProj)}>Edit</button>
                      <button className="btd bts" onClick={()=>confirmDeleteProject(curProj)}>Delete</button>
                    </div>
                  </div>
                </div>
                <div className="stabs">
                  {[["tasks","📋 Tasks & Schedule"],["gantt","📅 Gantt"],["regs","⚖️ Regulatory"]].map(([t,l])=>(
                    <button key={t} className={`stab${sub===t?" act":""}`} onClick={()=>sst(curProj.id,t)}>{l}</button>
                  ))}
                </div>
                {sub==="tasks"&&<TasksView proj={curProj} dispatch={dispatch} toast={toast} departments={state.departments} loginUser={loginUser} assigneeRoster={assigneeRoster}/>}
                {sub==="gantt"&&<GanttView proj={curProj}/>}
                {sub==="regs"&&<RegView proj={curProj} regStatus={regStatus} setRegStatus={setRegStatus}/>}
              </div>
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

      {/* Toasts */}
      <div className="tarea">
        {toasts.map(t=><div key={t.id} className={`toast${t.show?" show":""} ${t.type}`}>{t.msg}</div>)}
      </div>
    </div>
  );
}
