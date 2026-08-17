import assert from 'node:assert/strict';
import {
  normalizePhaseName,
  phaseLifecycle,
  sortPhasesByLifecycle,
} from './preconPhaseLifecycle.js';

assert.equal(
  normalizePhaseName('Project Finnancial Working'),
  normalizePhaseName('Project Financial Working'),
);
assert.equal(
  normalizePhaseName('Construction Pre-requisite'),
  normalizePhaseName('Construction Prerequisite'),
);

const phases = [
  { id: 'property', name: 'Property Management Services' },
  { id: 'sales-office', name: 'Sales Office Setup' },
  { id: 'marketing', name: 'Marketing & Sales' },
  { id: 'unknown', name: 'Special Project Workstream' },
  { id: 'due-diligence', name: 'Technical & Legal Due Diligence' },
  { id: 'financial', name: 'Project Finnancial Working' },
  { id: 'prerequisite', name: 'Construction Pre-requisite' },
  { id: 'registration', name: 'Registration' },
  { id: 'approval', name: 'Approval' },
  { id: 'design', name: 'Design' },
  { id: 'land', name: 'Land Acquisition & Feasibility' },
  { id: 'financing', name: 'Financing & Pre-Construction' },
  { id: 'execution', name: 'Construction Execution' },
  { id: 'handover', name: 'Handover & Post-Sales' },
  { id: 'closure', name: 'Closure & Exit' },
];

assert.deepEqual(
  sortPhasesByLifecycle(phases).map((phase) => phase.id),
  [
    'land',
    'due-diligence',
    'financial',
    'registration',
    'design',
    'approval',
    'financing',
    'prerequisite',
    'execution',
    'marketing',
    'sales-office',
    'handover',
    'closure',
    'property',
    'unknown',
  ],
);

assert.deepEqual(
  ['land', 'due-diligence', 'financial', 'registration', 'design', 'approval', 'financing', 'prerequisite', 'execution', 'marketing', 'sales-office', 'handover', 'closure', 'property']
    .map((id) => phaseLifecycle(phases.find((phase) => phase.id === id)).label),
  ['1', '1', '2', '3', '4', '4', '5', '5', '6', '7', '7B', '8', '9', '10'],
);

assert.equal(
  phaseLifecycle({ name: 'Works', tasks: [{ name: 'Site Preparation' }] }).label,
  '6',
);

console.log('preconPhaseLifecycle tests passed');
