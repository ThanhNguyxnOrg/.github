import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeReleaseNotes } from './release-notes.mjs';

// Fixtures: one shared asset directory. Configuration is read at import time,
// so the environment must be set before importing the action module.
const assetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-assets-'));
const appBytes = Buffer.from('fake-windows-installer');
const checksumsBytes = Buffer.from(createHash('sha256').update(appBytes).digest('hex') + '  app.zip\n');
fs.writeFileSync(path.join(assetDir, 'app.zip'), appBytes);
fs.writeFileSync(path.join(assetDir, 'checksums.txt'), checksumsBytes);
const digestOf = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

process.env.GH_TOKEN = 'test-token';
process.env.REPOSITORY = 'ThanhNguyxnOrg/WriteCanvas';
process.env.RELEASE_TAG = 'v1.3.1';
process.env.ASSET_PATH = assetDir;
process.env.POLICY_REF = 'main';
process.env.API_URL = 'https://api.github.com';
process.env.RELEASE_LOOKUP_ATTEMPTS = '2';
process.env.RELEASE_LOOKUP_DELAY_MS = '0';

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
      { name: 'app.zip', state: 'uploaded', digest: digestOf(appBytes) },
      { name: 'checksums.txt', state: 'uploaded', digest: digestOf(checksumsBytes) }
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
  assert.equal(fetchStub.calls.filter(call => call.method === 'POST' || call.method === 'DELETE').length, 0);
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

const assets = () => [
  { id: 7, name: 'app.zip', state: 'uploaded', digest: digestOf(appBytes) },
  { id: 8, name: 'checksums.txt', state: 'uploaded', digest: digestOf(checksumsBytes) }
];
const draft = (id = 42) => ({
  id, tag_name: 'v1.3.1', draft: true, assets: assets(),
  upload_url: 'https://uploads.github.com/assets{?name,label}'
});
const sha = 'a'.repeat(40);
const baselineSha = 'b'.repeat(40);
const fallbackCommits = [
  { sha: 'c'.repeat(40), commit: { message: 'fix: bundle offline runtime (#62)' } },
  { sha: 'd'.repeat(40), commit: { message: 'Update translation chunking (#68)' } }
];
const fallbackNotes = makeReleaseNotes(fallbackCommits, 'ThanhNguyxnOrg/WriteCanvas');

async function runLifecycle(config = {}, expectedError) {
  const calls = [];
  let created = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ href, method, body });
    const json = (data, status = 200) => ({
      ok: status < 400, status, text: async () => JSON.stringify(data), json: async () => data
    });
    if (href.startsWith('https://raw.githubusercontent.com/')) {
      return json({ repositories: { WriteCanvas: {
        requiredAssets: ['app.zip', 'checksums.txt'], changelogPath: 'docs/CHANGELOG.md', baselineSha
      } } });
    }
    if (href.includes('/releases/tags/')) {
      return config.lookup404 ? json({ message: 'Not Found' }, 404) : json(config.release || draft());
    }
    if (href.includes('/releases?')) {
      return json(created ? config.afterCreate || [draft()] : config.collection || []);
    }
    if (href.includes('/tags?')) {
      return json([{ name: 'v1.3.0', commit: { sha: baselineSha } }, { name: 'v1.3.1', commit: { sha } }]);
    }
    if (href.includes('/compare/')) {
      assert.equal(href, `https://api.github.com/repos/ThanhNguyxnOrg/WriteCanvas/compare/${baselineSha}...${sha}?per_page=100&page=1`);
      if (config.notesError) return json({ message: 'Forbidden' }, 403);
      return json({ status: 'ahead', total_commits: 2, commits: config.incompleteNotes ? fallbackCommits.slice(0, 1) : fallbackCommits });
    }
    if (href.includes('/git/ref/')) {
      return config.noTag ? json({ message: 'Not Found' }, 404) : json({ object: { type: 'commit', sha } });
    }
    if (href.includes('/contents/')) {
      assert.ok(href.endsWith('/contents/docs/CHANGELOG.md?ref=' + sha));
      return json({ content: Buffer.from('## [1.3.1]\n\nRelease notes\n\n## [1.3.0]\nOld').toString('base64') });
    }
    if (href.endsWith('/releases') && method === 'POST') {
      created = true;
      return json(config.created || draft());
    }
    if (method === 'DELETE') return json(null);
    if (/\/releases\/\d+$/.test(href)) {
      if (method === 'GET' && href.endsWith('/50')) {
        return json(config.ownDraftRefresh || { ...draft(50), assets: [] });
      }
      if (method === 'PATCH') {
        return json(body.draft === false ? { ...draft(), draft: false } : draft());
      }
      return json({ ...draft(), assets: config.verificationAssets || assets() });
    }
    throw new Error('Unexpected fetch: ' + method + ' ' + href);
  };
  try {
    if (expectedError) await assert.rejects(main(), expectedError);
    else await main();
  } finally {
    globalThis.fetch = originalFetch;
  }
  return calls;
}

test('creates a draft at the existing tag SHA after a short consistency wait', async () => {
  const calls = await runLifecycle({ lookup404: true });
  const posts = calls.filter(call => call.method === 'POST');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, {
    tag_name: 'v1.3.1', target_commitish: sha, name: 'WriteCanvas v1.3.1',
    body: fallbackNotes, draft: true, prerelease: false, generate_release_notes: false
  });
  assert.equal(calls.filter(call => call.href.includes('/releases/tags/')).length, 2);
});

test('tag lookup 404 uses the collection without creating a duplicate', async () => {
  const calls = await runLifecycle({ lookup404: true, collection: [draft()] });
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
});

test('repairs a safely identified orphan draft before attempting creation', async () => {
  const calls = await runLifecycle({ lookup404: true, collection: [{
    ...draft(), tag_name: 'untagged-abcdef1234', name: 'WriteCanvas v1.3.1', target_commitish: sha
  }] });
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  assert.deepEqual(calls.find(call => call.method === 'PATCH').body, {
    tag_name: 'v1.3.1', target_commitish: sha, body: fallbackNotes, draft: true
  });
});

test('fallback creation and orphan repair fail closed on incomplete notes or permission errors', async () => {
  for (const collection of [[], [{
    ...draft(), tag_name: 'untagged-abcdef1234', name: 'WriteCanvas v1.3.1', target_commitish: sha
  }]]) {
    for (const [config, error] of [
      [{ incompleteNotes: true }, /Incomplete release notes comparison/],
      [{ notesError: true }, /GitHub API 403/]
    ]) {
      const calls = await runLifecycle({ lookup404: true, collection, ...config }, error);
      assert.ok(calls.every(call => call.method === 'GET'));
    }
  }
});

test('missing tag fails without creating any ref or release', async () => {
  const calls = await runLifecycle({ lookup404: true, noTag: true }, /Git tag v1.3.1 does not exist/);
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('published matching assets are an immutable successful no-op', async () => {
  for (const lookup404 of [false, true]) {
    const release = { ...draft(), draft: false };
    const calls = await runLifecycle({ release, lookup404, collection: [release] });
    assert.ok(calls.every(call => call.method === 'GET'));
  }
});

test('published missing or mismatched assets fail without mutation', async () => {
  for (const remote of [[], [{ ...assets()[0], digest: 'sha256:wrong' }, assets()[1]]]) {
    const calls = await runLifecycle({ release: { ...draft(), draft: false, assets: remote } }, /missing or digest mismatch/);
    assert.ok(calls.every(call => call.method === 'GET'));
  }
});

test('duplicate race keeps lowest id and deletes only this run empty draft', async () => {
  const calls = await runLifecycle({
    lookup404: true, created: { ...draft(50), assets: [] },
    afterCreate: [draft(43), draft(42), { ...draft(50), assets: [] }]
  });
  assert.deepEqual(calls.filter(call => call.method === 'DELETE').map(call => call.href.split('/').pop()), ['50']);
  assert.ok(calls.find(call => call.method === 'PATCH').href.endsWith('/42'));
});

test('duplicate race preserves this run draft when it has assets', async () => {
  const calls = await runLifecycle({
    lookup404: true, created: draft(50), afterCreate: [draft(42), draft(50)]
  });
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 0);
});

test('duplicate race rechecks own draft and preserves newly uploaded assets or publication', async () => {
  for (const ownDraftRefresh of [draft(50), { ...draft(50), draft: false, assets: [] }]) {
    const calls = await runLifecycle({
      lookup404: true, created: { ...draft(50), assets: [] },
      afterCreate: [draft(42), { ...draft(50), assets: [] }], ownDraftRefresh
    });
    assert.ok(calls.some(call => call.method === 'GET' && call.href.endsWith('/50')));
    assert.equal(calls.filter(call => call.method === 'DELETE').length, 0);
  }
});

test('does not publish a manifest whose remote digest differs', async () => {
  const calls = await runLifecycle({ verificationAssets: [
    { ...assets()[0], digest: 'sha256:wrong' }, assets()[1]
  ] }, /digest mismatch/);
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 0);
});

test('rejects invalid, incomplete, and mismatched checksums before any release mutation', async () => {
  try {
    for (const content of ['invalid', '', '0'.repeat(64) + '  app.zip\n']) {
      fs.writeFileSync(path.join(assetDir, 'checksums.txt'), content);
      const calls = await runLifecycle({}, /checksums.txt/);
      assert.ok(calls.every(call => call.method === 'GET'));
    }
  } finally {
    fs.writeFileSync(path.join(assetDir, 'checksums.txt'), checksumsBytes);
  }
});
