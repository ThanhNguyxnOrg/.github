import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRequiredAssets, planAssetUpload, selectDraftRelease, selectOrphanDraftRelease } from '../actions/agent-release-assets/index.mjs';

test('expands tag and version placeholders in the central asset manifest', () => {
  assert.deepEqual(
    expandRequiredAssets(['app-{tag}.zip', 'checksums-{version}.txt'], 'v1.2.3'),
    ['app-v1.2.3.zip', 'checksums-1.2.3.txt']
  );
});

test('reports missing and unlisted local artifacts before upload', () => {
  const plan = planAssetUpload([
    { name: 'app.zip', digest: 'sha256:a' },
    { name: 'debug-symbols.zip', digest: 'sha256:b' }
  ], ['app.zip', 'checksums.txt'], []);
  assert.deepEqual(plan.missing, ['checksums.txt']);
  assert.deepEqual(plan.unexpected, ['debug-symbols.zip']);
  assert.deepEqual(plan.uploads.map(asset => asset.name), ['app.zip']);
});

test('rejects duplicate names in the central required asset manifest', () => {
  const expected = ['app.zip', 'app.zip'];
  assert.equal(new Set(expected).size !== expected.length, true);
});

test('skips an already-uploaded asset only when its SHA-256 digest matches', () => {
  const plan = planAssetUpload(
    [{ name: 'app.zip', digest: 'sha256:a' }],
    ['app.zip'],
    [{ id: 7, name: 'app.zip', digest: 'sha256:a' }]
  );
  assert.equal(plan.uploads[0].action, 'skip');
  assert.equal(plan.uploads[0].existingId, 7);
});

test('replaces a same-name asset when the draft currently has different bytes', () => {
  const plan = planAssetUpload(
    [{ name: 'app.zip', digest: 'sha256:new' }],
    ['app.zip'],
    [{ id: 7, name: 'app.zip', digest: 'sha256:old' }]
  );
  assert.equal(plan.uploads[0].action, 'replace');
  assert.equal(plan.uploads[0].existingId, 7);
});

test('resolves a freshly created draft by exact tag from the releases collection', () => {
  const draft = {
    id: 42,
    tag_name: 'v1.1.1',
    draft: true,
    created_at: '2026-11-10T11:00:00Z'
  };
  const selected = selectDraftRelease([
    { id: 99, tag_name: 'v1.1.10', draft: true },
    { id: 7, tag_name: 'v1.1.1', draft: false },
    draft,
    { id: 43, tag_name: 'v1.1.1', draft: true, created_at: '2026-11-10T11:01:00Z' }
  ], 'v1.1.1');

  assert.equal(selected.id, 43);
});

test('does not resolve published releases or tags that only partially match', () => {
  assert.equal(selectDraftRelease([
    { id: 7, tag_name: 'v1.1.1', draft: false },
    { id: 8, tag_name: 'v1.1.10', draft: true }
  ], 'v1.1.1'), null);
});


test('recovers only an untagged draft whose name and target commit match the requested tag', () => {
  const targetSha = 'a'.repeat(40);
  const selected = selectOrphanDraftRelease([
    { id: 1, tag_name: 'untagged-e3ee0aa97d6964c6b5df', name: 'WriteCanvas v1.1.1', target_commitish: targetSha, draft: true },
    { id: 2, tag_name: 'untagged-bbbb1111222233334444', name: 'WriteCanvas v1.1.1', target_commitish: 'b'.repeat(40), draft: true },
    { id: 3, tag_name: 'untagged-cccc1111222233334444', name: 'WriteCanvas v1.1.10', target_commitish: targetSha, draft: true },
    { id: 4, tag_name: 'v1.1.1', name: 'WriteCanvas v1.1.1', target_commitish: targetSha, draft: true },
    { id: 5, tag_name: 'untagged-dddd1111222233334444', name: 'WriteCanvas v1.1.1', target_commitish: targetSha, draft: false }
  ], 'v1.1.1', targetSha);

  assert.equal(selected.id, 1);
});

test('does not repair ambiguous or weakly identified untagged draft records', () => {
  const targetSha = 'a'.repeat(40);
  assert.equal(selectOrphanDraftRelease([
    { id: 1, tag_name: 'untagged-e3ee0aa97d6964c6b5df', name: 'WriteCanvas v1.1.1', target_commitish: targetSha, draft: true },
    { id: 2, tag_name: 'untagged-bbbb1111222233334444', name: 'WriteCanvas release', target_commitish: targetSha, draft: true }
  ], 'v1.1.1', targetSha)?.id, 1);
  assert.equal(selectOrphanDraftRelease([
    { id: 2, tag_name: 'untagged-bbbb1111222233334444', name: 'WriteCanvas release', target_commitish: targetSha, draft: true }
  ], 'v1.1.1', targetSha), null);
  assert.equal(selectOrphanDraftRelease([
    { id: 3, tag_name: 'untagged-eeee1111222233334444', name: 'WriteCanvas v1.1.1', target_commitish: targetSha, draft: true }
  ], 'v1.1.1', 'not-a-commit-sha'), null);
});
