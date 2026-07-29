/**
 * Quick assertions for assignee name matching (no stored-data impact).
 * Run: node src/preconAssignees.nameMatches.test.mjs
 */
import { nameMatches, assigneeMatches, taskMatchesAssigneeFilter } from './preconAssignees.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Exact / token matches that must keep working
assert(nameMatches('Nishigandha Patil', 'Nishigandha'), 'first name should match full name');
assert(nameMatches('Akash Borhade', 'Akash'), 'Akash short filter should match Akash Borhade');
assert(nameMatches('Nishigandha', 'Nishigandha Patil'), 'full filter should match first-name who');

// The bug: initial "A" must NOT match inside Nishigandha
assert(!nameMatches('A Borhade', 'Nishigandha'), 'initial A must not match Nishigandha');
assert(!nameMatches('A Borhade', 'Nishigandha Patil'), 'initial A must not match Nishigandha Patil');
assert(!assigneeMatches('A Borhade', 'Nishigandha'), 'assigneeMatches must reject A Borhade for Nishigandha');
assert(!taskMatchesAssigneeFilter('Akash Borhade', 'Nishigandha'), 'Akash tasks must not pass Nishigandha filter');
assert(taskMatchesAssigneeFilter('Nishigandha Patil', 'Nishigandha'), 'Nishigandha tasks must pass filter');
assert(taskMatchesAssigneeFilter('Akash; Nishigandha', 'Nishigandha'), 'multi-assignee including Nishigandha must pass');

console.log('preconAssignees.nameMatches.test.mjs: OK');
