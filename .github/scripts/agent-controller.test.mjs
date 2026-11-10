import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyVersionUpdate, evaluateCheckRollup, hasExplicitAutoMergeLabel, pullRequestCheckSha } from './agent-controller.mjs';

test('Dependabot update classification is SemVer-aware', () => {
  assert.equal(classifyVersionUpdate('Bump foo from 1.2.3 to 1.2.4'), 'patch');
  assert.equal(classifyVersionUpdate('Bump foo from 1.2.3 to 1.4.0'), 'minor');
  assert.equal(classifyVersionUpdate('Bump foo from 1.2.3 to 2.0.0'), 'major');
  assert.equal(classifyVersionUpdate('Bump actions/checkout from 4 to 5'), 'major');
  assert.equal(classifyVersionUpdate('Update dependencies'), 'unknown');
});

test('check rollup requires evidence and rejects failed or incomplete checks', () => {
  assert.equal(evaluateCheckRollup([], {}, ['tests']), 'missing');
  assert.equal(evaluateCheckRollup([{ name: 'tests', status: 'in_progress' }], {}, ['tests']), 'pending');
  assert.equal(evaluateCheckRollup([{ name: 'tests', status: 'completed', conclusion: 'failure' }], {}, ['tests']), 'failure');
  assert.equal(evaluateCheckRollup([{ name: 'tests', status: 'completed', conclusion: 'success' }], {}, ['tests']), 'success');
  assert.equal(evaluateCheckRollup([], {}, []), 'unconfigured');
});


test('regular pull requests require an explicit auto-merge label', () => {
  assert.equal(hasExplicitAutoMergeLabel([], { autoMergeDefault: true }), false);
  assert.equal(hasExplicitAutoMergeLabel([{ name: 'documentation' }], {}), false);
  assert.equal(hasExplicitAutoMergeLabel([{ name: 'automerge' }], {}), true);
  assert.equal(hasExplicitAutoMergeLabel([{ name: 'safe-update' }], {}), true);
  assert.equal(hasExplicitAutoMergeLabel([{ name: 'maintainer-approved' }], { autoMergeLabels: ['maintainer-approved'] }), true);
});

test('PR checks use the synthetic merge commit SHA', () => {
  const mergeSha = 'a'.repeat(40);
  assert.equal(pullRequestCheckSha({ head: { sha: 'b'.repeat(40) }, merge_commit_sha: mergeSha }), mergeSha);
  assert.equal(pullRequestCheckSha({ merge_commit_sha: null }), null);
  assert.equal(pullRequestCheckSha({ merge_commit_sha: 'invalid' }), null);
});
