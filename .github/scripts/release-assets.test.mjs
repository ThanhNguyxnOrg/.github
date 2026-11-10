import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRequiredAssets, planAssetUpload } from '../actions/agent-release-assets/index.mjs';

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
