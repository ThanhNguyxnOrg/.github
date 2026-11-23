import test from 'node:test';
import assert from 'node:assert/strict';
import { makeReleaseNotes, notesSincePublishedRelease } from './release-notes.mjs';

process.env.GH_TOKEN = 'test-token';
process.env.GITHUB_API_URL = 'https://api.github.com';
const { prepareReleaseCommit, ensureDraftRelease, repairOrphanDraftReleases, publishReadyDrafts } = await import('./release-controller.mjs');

const repo = 'ThanhNguyxnOrg/LayoutLingua';
const baseSha = '0'.repeat(40);
const targetSha = '3'.repeat(40);
const targetTag = 'v2.0.3';
const rule = { baselineSha: 'b'.repeat(40), mode: 'commit', releaseWorkflowName: 'Desktop', requiredAssets: ['app.zip'] };
const release = (tag_name, published_at = '2026-10-30T13:42:52Z') => ({ tag_name, draft: false, prerelease: false, published_at });
const tag = (name, sha) => ({ name, commit: { sha } });
const tags = [tag('v2.0.0', baseSha), tag(targetTag, targetSha)];
const commits = [
  { sha: 'a1442c2'.padEnd(40, '0'), commit: { message: 'fix: bundle the Argos offline runtime (#62)' } },
  { sha: '423f3e5'.padEnd(40, '0'), commit: { message: 'fix: bound and diagnose frozen runtime smoke checks (#66)' } },
  { sha: '940c0cc'.padEnd(40, '0'), commit: { message: 'fix: bundle sentencepiece binaries in Windows builds (#69)' } },
  { sha: '68'.padEnd(40, '0'), commit: { message: 'Fix multilingual prose detection, Argos routes, and translation chunking (#68)' } },
  { sha: '65'.padEnd(40, '0'), commit: { message: 'release: v2.0.1 (#65)' } },
  { sha: '67'.padEnd(40, '0'), commit: { message: 'chore(release): prepare v2.0.2' } }
];
const publicNotes = makeReleaseNotes(commits, repo);
const versionNotes = makeReleaseNotes([commits[2]], repo);
const comparisonPath = '/compare/' + baseSha + '...' + targetSha + '?per_page=100&page=1';

function notesRequest(options = {}) {
  return test.mock.fn(async path => {
    const url = new URL('https://api.github.com' + path);
    const page = Number(url.searchParams.get('page'));
    const start = (page - 1) * 100;
    if (url.pathname.endsWith('/releases')) return (options.releases ?? [release('v2.0.0')]).slice(start, start + 100);
    if (url.pathname.endsWith('/tags')) return (options.tags ?? tags).slice(start, start + 100);
    assert.match(url.pathname, /\/compare\//);
    const selected = options.commits ?? commits;
    return options.comparison ?? { status: 'ahead', total_commits: selected.length, commits: selected.slice(start, start + 100) };
  });
}

test('LayoutLingua aggregates #62, #66, #69 and Other changes across deleted unpublished versions', async () => {
  const request = notesRequest();
  const body = await notesSincePublishedRelease(repo, targetTag, targetSha, rule, request);
  assert.equal(body, publicNotes);
  for (const number of [62, 66, 69, 68]) assert.equal(body.split('(#' + number + ')').length - 1, 1);
  assert.match(body, /### Other changes\n\n- Fix multilingual prose detection/);
  assert.doesNotMatch(body, /release:|prepare v2/);
  assert.equal(request.mock.calls.at(-1).arguments[0], '/repos/' + repo + comparisonPath);
});

test('published base wins over newer unpublished stable tags', async () => {
  const request = notesRequest({
    releases: [release('v2.0.0'), { ...release('v2.0.2'), draft: true }],
    tags: [...tags, tag('v2.0.1', '1'.repeat(40)), tag('v2.0.2', '2'.repeat(40))]
  });
  await notesSincePublishedRelease(repo, targetTag, targetSha, rule, request);
  assert.equal(request.mock.calls.at(-1).arguments[0], '/repos/' + repo + comparisonPath);
});

test('regenerating a published target excludes itself, future versions and prereleases', async () => {
  const request = notesRequest({ releases: [
    release(targetTag, '2026-11-23T06:23:55Z'), release('v2.0.0'),
    release('v2.0.4', '2026-11-24T00:00:00Z'),
    { ...release('v2.0.2', '2026-11-22T00:00:00Z'), prerelease: true },
    release('v2.0.3-beta', '2026-11-22T00:00:00Z')
  ] });
  assert.equal(await notesSincePublishedRelease(repo, targetTag, targetSha, rule, request), publicNotes);
  assert.equal(request.mock.calls.at(-1).arguments[0], '/repos/' + repo + comparisonPath);
});

test('the most recently published stable predecessor is selected by publication time', async () => {
  const request = notesRequest({
    releases: [release('v2.0.1', '2026-10-01T00:00:00Z'), release('v2.0.0')],
    tags: [...tags, tag('v2.0.1', '1'.repeat(40))]
  });
  await notesSincePublishedRelease(repo, targetTag, targetSha, rule, request);
  assert.equal(request.mock.calls.at(-1).arguments[0], '/repos/' + repo + comparisonPath);
});

test('no published release or a deleted published tag falls back to the preceding stable tag', async () => {
  for (const releases of [[], [release('v2.0.1')], [{ ...release('v2.0.1'), draft: true }]]) {
    const request = notesRequest({ releases, tags: [...tags, tag('v2.0.2', '2'.repeat(40)), tag('v2.0.3-beta', 'c'.repeat(40))] });
    await notesSincePublishedRelease(repo, targetTag, targetSha, rule, request);
    assert.match(request.mock.calls.at(-1).arguments[0], new RegExp('/compare/' + '2'.repeat(40) + '\\.\\.\\.' + targetSha));
  }
});

test('only target, future or prerelease tags fall back to policy baseline', async () => {
  const request = notesRequest({ releases: [release(targetTag)], tags: [
    tag(targetTag, targetSha), tag('v2.0.4', '4'.repeat(40)), tag('v2.0.2-beta', 'c'.repeat(40))
  ] });
  await notesSincePublishedRelease(repo, targetTag, targetSha, rule, request);
  assert.ok(request.mock.calls.at(-1).arguments[0].includes('/compare/' + rule.baselineSha + '...' + targetSha));
  await assert.rejects(notesSincePublishedRelease(repo, targetTag, targetSha, {}, notesRequest({ releases: [], tags: [] })), /No release notes baseline/);
});

test('release and tag collections are fully paginated before selecting a base', async () => {
  const request = notesRequest({
    releases: [...Array.from({ length: 100 }, () => ({ ...release(targetTag), draft: true })), release('v2.0.0')],
    tags: [...Array.from({ length: 100 }, (_, i) => tag('noise-' + i, 'n')), ...tags]
  });
  assert.equal(await notesSincePublishedRelease(repo, targetTag, targetSha, rule, request), publicNotes);
  assert.equal(request.mock.callCount(), 5);
});

test('comparisons beyond the default 250-commit window are completely paginated in order', async () => {
  const many = Array.from({ length: 301 }, (_, i) => ({ sha: i.toString(16).padStart(40, '0'), commit: { message: 'Update item ' + i } }));
  const request = notesRequest({ commits: many });
  assert.equal(await notesSincePublishedRelease(repo, targetTag, targetSha, rule, request), makeReleaseNotes(many, repo));
  assert.equal(request.mock.callCount(), 6);
  assert.ok(request.mock.calls.at(-1).arguments[0].endsWith('page=4'));
});

test('empty comparisons or only release noise produce no notes', async () => {
  for (const comparison of [
    { status: 'identical', total_commits: 0, commits: [] },
    { status: 'ahead', total_commits: 1, commits: [commits[4]] }
  ]) {
    assert.equal(await notesSincePublishedRelease(repo, targetTag, targetSha, rule, notesRequest({ comparison })), '');
  }
});

test('incomplete, inconsistent, duplicate and non-ancestor comparisons fail closed', async () => {
  for (const comparison of [
    { status: 'ahead', total_commits: 2, commits: [commits[0]] },
    { status: 'ahead', total_commits: 2, commits: [commits[0], commits[0]] },
    { status: 'ahead', total_commits: 0, commits: [commits[0]] },
    { status: 'ahead', commits: [] },
    { status: 'diverged', total_commits: 1, commits: [commits[0]] },
    { status: 'behind', total_commits: 0, commits: [] }
  ]) {
    await assert.rejects(notesSincePublishedRelease(repo, targetTag, targetSha, rule, notesRequest({ comparison })), /Incomplete release notes comparison|not an ancestor/);
  }
  const request = notesRequest({ commits: Array.from({ length: 101 }, (_, i) => ({ sha: String(i), message: 'Update ' + i })) });
  await assert.rejects(notesSincePublishedRelease(repo, targetTag, targetSha, rule, async path => {
    const result = await request(path);
    if (path.includes('/compare/') && path.endsWith('page=2')) result.total_commits = 102;
    return result;
  }), /Incomplete release notes comparison/);
});

test('permission, missing endpoint and network errors propagate instead of falling back', async () => {
  for (const resource of ['/releases?', '/tags?', '/compare/']) {
    for (const error of [Object.assign(new Error('Forbidden'), { status: 403 }), Object.assign(new Error('Not Found'), { status: 404 }), new Error('Network disconnected')]) {
      const request = notesRequest();
      await assert.rejects(notesSincePublishedRelease(repo, targetTag, targetSha, rule, path => {
        if (path.includes(resource)) throw error;
        return request(path);
      }), caught => caught === error);
    }
  }
  await assert.rejects(notesSincePublishedRelease(repo, targetTag, targetSha, rule, async () => ({})), /Invalid release notes releases response/);
});

const draft = { id: 3, tag_name: targetTag, name: 'LayoutLingua ' + targetTag, draft: true, prerelease: false, assets: [{ name: 'app.zip', state: 'uploaded' }] };
const orphan = { ...draft, tag_name: 'untagged-abcdef1234', target_commitish: targetSha };

function controllerApi(t, config = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    assert.ok(String(url).startsWith('https://api.github.com/repos/' + repo));
    const route = String(url).slice(('https://api.github.com/repos/' + repo).length);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ route, method, body });
    const json = (data, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) });
    if (route === '/releases?per_page=100&page=1') return json([release('v2.0.0'), ...(config.published ? [{ ...draft, draft: false }] : [])]);
    if (route === '/tags?per_page=100&page=1') return json(tags);
    if (route === comparisonPath) return json(config.incomplete ? { status: 'ahead', total_commits: 7, commits } : { status: 'ahead', total_commits: commits.length, commits });
    if (route === '/releases?per_page=100') return json([release('v2.0.0'), ...(config.missing ? [] : [config.orphan ? orphan : draft])]);
    if (route === '/releases/tags/' + targetTag) return config.missing || config.orphan ? json({ message: 'Not Found' }, 404) : json({ ...draft, draft: !config.published });
    if (route === '/git/ref/tags/' + targetTag) return json({ object: { type: 'commit', sha: targetSha } });
    if (route === '/contents/CHANGELOG.md?ref=' + targetSha) return json({ encoding: 'base64', content: Buffer.from(config.preparing ? '# Changelog\n\n## [2.0.2]\n\nEarlier notes\n' : '## [2.0.3]\n\n' + versionNotes).toString('base64') });
    if (route.startsWith('/pulls?')) return json([]);
    if (route.startsWith('/git/ref/heads/')) return json({ message: 'Not Found' }, 404);
    if (route === '/git/commits/' + targetSha) return json({ tree: { sha: 'tree' }, committer: { date: '2026-11-23T00:00:00Z' } });
    if (route === '/git/blobs' || route === '/git/trees' || route === '/git/commits' || route === '/git/refs') return json({ sha: 'new-object' });
    if (route === '/pulls' && method === 'POST') return json({ html_url: 'pr-url' });
    if (route === '/releases/3' && method === 'PATCH') return json({ ...draft, ...body });
    if (route === '/releases' && method === 'POST') return json({ ...draft, ...body });
    if (route.startsWith('/actions/runs?')) return json({ workflow_runs: [{ name: 'Desktop', status: 'completed', conclusion: config.failedBuild ? 'failure' : 'success' }] });
    assert.fail('Unexpected fetch: ' + method + ' ' + route);
  });
  return calls;
}

test('release preparation writes per-version CHANGELOG but an aggregate release PR body', async t => {
  const calls = controllerApi(t, { preparing: true });
  await prepareReleaseCommit(repo, 'main', targetSha, '2.0.3', versionNotes, rule, 'v2.0.2');
  const changelog = calls.find(call => call.route === '/git/blobs').body.content;
  assert.match(changelog, /## \[2\.0\.3\] - 2026-11-23/);
  assert.match(changelog, /#69/);
  assert.doesNotMatch(changelog, /#62|#66|#68|Other changes/);
  assert.ok(calls.find(call => call.route === '/pulls').body.body.startsWith(publicNotes + '\n\nMerge to approve'));
});

test('draft creation, update and exact orphan repair all write aggregate notes', async t => {
  for (const config of [{}, { missing: true }, { orphan: true }]) {
    const calls = controllerApi(t, config);
    await ensureDraftRelease(repo, 'LayoutLingua', targetTag, '2.0.3', targetSha, rule);
    const writes = calls.filter(call => ['PATCH', 'POST'].includes(call.method));
    assert.ok(writes.length);
    assert.equal(writes.some(call => call.method === 'POST'), Boolean(config.missing));
    for (const write of writes) assert.equal(write.body.body, publicNotes);
    t.mock.restoreAll();
  }
});

test('already-published target is not modified and does not become its own notes base', async t => {
  const calls = controllerApi(t, { published: true });
  await ensureDraftRelease(repo, 'LayoutLingua', targetTag, '2.0.3', targetSha, rule);
  assert.ok(calls.some(call => call.route === comparisonPath));
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('orphan reconciliation independently regenerates the aggregate draft body', async t => {
  const calls = controllerApi(t);
  await repairOrphanDraftReleases(repo, 'LayoutLingua', [orphan], rule);
  assert.equal(calls.find(call => call.method === 'PATCH').body.body, publicNotes);
});

test('publish-ready refreshes aggregate notes without bypassing the exact-tag build gate', async t => {
  for (const failedBuild of [false, true]) {
    const calls = controllerApi(t, { failedBuild });
    await publishReadyDrafts('LayoutLingua', rule);
    const writes = calls.filter(call => call.method === 'PATCH');
    assert.equal(writes[0].body.body, publicNotes);
    assert.equal(writes.some(call => call.body.draft === false), !failedBuild);
    assert.ok(calls.some(call => call.route === '/actions/runs?head_sha=' + targetSha + '&per_page=100'));
    t.mock.restoreAll();
  }
});

test('incomplete aggregate notes block PR, draft and orphan writes', async t => {
  for (const action of [
    () => prepareReleaseCommit(repo, 'main', targetSha, '2.0.3', versionNotes, rule, 'v2.0.2'),
    () => ensureDraftRelease(repo, 'LayoutLingua', targetTag, '2.0.3', targetSha, rule),
    () => repairOrphanDraftReleases(repo, 'LayoutLingua', [orphan], rule)
  ]) {
    const calls = controllerApi(t, { incomplete: true });
    await assert.rejects(action(), /Incomplete release notes comparison/);
    assert.ok(calls.every(call => call.method === 'GET'));
    t.mock.restoreAll();
  }
});
