import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Fixtures: one shared asset directory. Configuration is read at import time,
// so the environment must be set before importing the action module.
const assetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-assets-'));
const appBytes = Buffer.from('fake-windows-installer');
const checksumsBytes = Buffer.from('fake-checksums');
fs.writeFileSync(path.join(assetDir, 'app.zip'), appBytes);
fs.writeFileSync(path.join(assetDir, 'checksums.txt'), checksumsBytes);
const digestOf = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

process.env.GH_TOKEN = 'test-token';
process.env.REPOSITORY = 'ThanhNguyxnOrg/WriteCanvas';
process.env.RELEASE_TAG = 'v1.3.1';
process.env.ASSET_PATH = assetDir;
process.env.POLICY_REF = 'main';
process.env.API_URL = 'https://api.github.com';

const { main } = await import('../actions/agent-release-assets/index.mjs');

function createFetchStub({ verificationAssets }) {
  const calls = [];
  const stub = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url: String(url), method, body: options.body || null });
    const json = (data, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: async () => JSON.stringify(data),
      json: async () => data
    });
    const href = String(url);
    if (href.startsWith('https://raw.githubusercontent.com/')) {
      return json({ repositories: { WriteCanvas: { requiredAssets: ['app.zip', 'checksums.txt'] } } });
    }
    if (href === 'https://api.github.com/repos/ThanhNguyxnOrg/WriteCanvas/releases/tags/v1.3.1') {
      return json({
        id: 42,
        tag_name: 'v1.3.1',
        draft: true,
        html_url: 'https://github.com/ThanhNguyxnOrg/WriteCanvas/releases/tag/v1.3.1',
        upload_url: 'https://uploads.github.com/repos/ThanhNguyxnOrg/WriteCanvas/releases/42/assets{?name,label}',
        assets: [
          { id: 7, name: 'app.zip', digest: digestOf(appBytes), state: 'uploaded' },
          { id: 8, name: 'checksums.txt', digest: digestOf(checksumsBytes), state: 'uploaded' }
        ]
      });
    }
    if (href === 'https://api.github.com/repos/ThanhNguyxnOrg/WriteCanvas/releases/42') {
      if (method === 'GET') {
        return json({ id: 42, tag_name: 'v1.3.1', draft: true, assets: verificationAssets });
      }
      if (method === 'PATCH') {
        return json({
          id: 42,
          tag_name: 'v1.3.1',
          draft: false,
          html_url: 'https://github.com/ThanhNguyxnOrg/WriteCanvas/releases/tag/v1.3.1'
        });
      }
    }
    throw new Error(`Unexpected fetch: ${method} ${href}`);
  };
  stub.calls = calls;
  return stub;
}

test('publishes the draft exactly once after the asset manifest verifies', async () => {
  const fetchStub = createFetchStub({
    verificationAssets: [
      { name: 'app.zip', state: 'uploaded' },
      { name: 'checksums.txt', state: 'uploaded' }
    ]
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchStub;
  try {
    await main();
  } finally {
    globalThis.fetch = originalFetch;
  }
  const publishes = fetchStub.calls.filter(
    call => call.method === 'PATCH' && call.url === 'https://api.github.com/repos/ThanhNguyxnOrg/WriteCanvas/releases/42'
  );
  assert.equal(publishes.length, 1);
  assert.deepEqual(JSON.parse(publishes[0].body), { draft: false });
});

test('does not publish when the asset manifest verification fails', async () => {
  const fetchStub = createFetchStub({
    verificationAssets: [{ name: 'app.zip', state: 'uploaded' }]
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchStub;
  try {
    await assert.rejects(main(), /Release is still missing required assets: checksums\.txt/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const publishes = fetchStub.calls.filter(call => call.method === 'PATCH');
  assert.equal(publishes.length, 0);
});
