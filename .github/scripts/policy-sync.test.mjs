import test from 'node:test';
import assert from 'node:assert/strict';
import { planPolicySync, AUTO_EXCLUDE_REASON } from './policy-sync.mjs';

const baseCi = { schemaVersion: 1, organization: 'ThanhNguyxnOrg', defaults: {}, repositories: {} };
const baseRelease = { repositories: {}, excluded: { '.github': 'Automation control plane; not a product release.' } };

test('newly discovered repositories are added fail-closed to both policies', () => {
  const ci = JSON.parse(JSON.stringify(baseCi));
  const release = JSON.parse(JSON.stringify(baseRelease));
  const { inventory, changes } = planPolicySync({
    discovered: [{ name: 'new-repo', default_branch: 'main' }],
    ciPolicy: ci,
    releasePolicy: release
  });
  assert.deepEqual(ci.repositories['new-repo'], { defaultBranch: 'main', requiredChecks: [] });
  assert.equal(release.excluded['new-repo'], AUTO_EXCLUDE_REASON);
  assert.ok(inventory.includes('new-repo') && inventory.includes('.github'));
  assert.equal(changes.length, 2);
});

test('existing tuned profiles are never modified', () => {
  const tuned = { defaultBranch: 'master', requiredChecks: ['verify / Verify'] };
  const ci = JSON.parse(JSON.stringify(baseCi));
  ci.repositories['old-repo'] = tuned;
  const release = JSON.parse(JSON.stringify(baseRelease));
  release.repositories['old-repo'] = { branch: 'master', mode: 'tag' };
  const { changes } = planPolicySync({
    discovered: [{ name: 'old-repo', default_branch: 'main' }],
    ciPolicy: ci,
    releasePolicy: release
  });
  assert.deepEqual(ci.repositories['old-repo'], tuned);
  assert.equal(release.repositories['old-repo'].mode, 'tag');
  assert.equal(changes.length, 0);
});

test('stale auto-shaped entries are removed; custom entries survive with a warning', () => {
  const ci = JSON.parse(JSON.stringify(baseCi));
  ci.repositories['gone-auto'] = { defaultBranch: 'main', requiredChecks: [] };
  ci.repositories['gone-tuned'] = { defaultBranch: 'main', requiredChecks: ['build'] };
  const release = JSON.parse(JSON.stringify(baseRelease));
  release.excluded['gone-auto'] = AUTO_EXCLUDE_REASON;
  release.excluded['gone-tuned'] = 'Custom manual reason.';
  const { warnings } = planPolicySync({
    discovered: [{ name: 'alive', default_branch: 'main' }],
    ciPolicy: ci,
    releasePolicy: release
  });
  assert.equal(ci.repositories['gone-auto'], undefined);
  assert.deepEqual(ci.repositories['gone-tuned'].requiredChecks, ['build']);
  assert.equal(release.excluded['gone-auto'], undefined);
  assert.equal(release.excluded['gone-tuned'], 'Custom manual reason.');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /gone-tuned/);
});
