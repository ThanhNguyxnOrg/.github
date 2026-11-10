import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRequiredAssets, planAssetUpload, selectDraftRelease } from '../actions/agent-release-assets/index.mjs';

test('expands tag and version placeholders in the central asset manifest', () => {
  assert.deepEqual(
    expandRequiredAssets(['app-{tag}.zip', 'checksums-{version}.txt'], 'v1.2.3'),
    ['app-v1.2.3.zip', 'checksums-1.2.3.txt']
  );
});

test('reports every missing required local artifact before upload', () => {
  const plan = planAssetUpload([{ name: 'app.zip', digest: 'sha256:a' }], ['app.zip', 'checksums.txt'], []);
  assert.deepEqual(plan.missing, ['checksums.txt']);
  assert.equal(plan.uploads.length, 1);
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
