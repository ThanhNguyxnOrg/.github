import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRequiredChecks, getRepositoryProfile } from './check-policy.mjs';

test('repository profiles are centrally defined and unknown repositories fail closed', () => {
  assert.equal(getRepositoryProfile('WriteCanvas').defaultBranch, 'master');
  assert.equal(getRepositoryProfile('WriteCanvas').autoMergeDependabot, true);
  assert.equal(getRepositoryProfile('unregistered-repo'), null);
});

test('every required check must be present and successful', () => {
  const checks = [
    { name: 'unit tests', status: 'completed', conclusion: 'success' },
    { name: 'typecheck', status: 'completed', conclusion: 'success' }
  ];
  assert.equal(evaluateRequiredChecks(checks, {}, ['unit tests', 'typecheck']).state, 'success');
  assert.deepEqual(evaluateRequiredChecks(checks, {}, ['unit tests', 'build']).missing, ['build']);
});

test('missing policy is unconfigured rather than implicitly green', () => {
  assert.equal(evaluateRequiredChecks([{ name: 'build', status: 'completed', conclusion: 'success' }], {}, []).state, 'unconfigured');
});

test('skipped or neutral required checks are not accepted', () => {
  assert.equal(evaluateRequiredChecks([{ name: 'build', status: 'completed', conclusion: 'skipped' }], {}, ['build']).state, 'failure');
  assert.equal(evaluateRequiredChecks([{ name: 'build', status: 'completed', conclusion: 'neutral' }], {}, ['build']).state, 'failure');
});

test('all instances of a duplicated required check must succeed', () => {
  const checks = [
    { name: 'build', status: 'completed', conclusion: 'success' },
    { name: 'build', status: 'completed', conclusion: 'failure' }
  ];
  assert.equal(evaluateRequiredChecks(checks, {}, ['build']).state, 'failure');
});

test('pending required or optional checks hold the gate', () => {
  assert.equal(evaluateRequiredChecks([{ name: 'build', status: 'in_progress' }], {}, ['build']).state, 'pending');
  assert.equal(evaluateRequiredChecks([{ name: 'build', status: 'completed', conclusion: 'success' }, { name: 'scan', status: 'queued' }], {}, ['build']).state, 'pending');
});

test('optional failures still fail closed', () => {
  const checks = [{ name: 'build', status: 'completed', conclusion: 'success' }, { name: 'lint', status: 'completed', conclusion: 'failure' }];
  assert.equal(evaluateRequiredChecks(checks, {}, ['build']).state, 'failure');
});

test('legacy commit statuses require their exact configured context', () => {
  assert.equal(evaluateRequiredChecks([], { statuses: [{ context: 'ci', state: 'success' }] }, [{ name: 'ci', kind: 'status' }]).state, 'success');
  assert.equal(evaluateRequiredChecks([], { statuses: [{ context: 'ci', state: 'success' }] }, [{ name: 'other', kind: 'status' }]).state, 'missing');
});
