import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { bumpSemver, classifyConventionalCommit, highestReleaseLevel, insertChangelogSection, applyVersionFile, releaseNotesFromChangelog, releaseBodyFromChangelog, pendingDraftReleases, missingRequiredAssets, planOrphanAssetRecovery, changedFilesForPolicy, releaseMatchesTag, selectReleaseByTag, selectOrphanDraftForTag } from './release-controller.mjs';
import { createCommit, shouldReprepareRelease, releaseIntent, releasePrMarker, parseReleasePrMarker, keepReleaseCommit, releasePrDeclined, ensureReleasePr, cleanupReleaseBranch, dispatchMissingChecks, prepareReleaseChanges, makeReleaseNotes, RELEASE_BRANCH } from './release-controller.mjs';

test('missing HEAD checks dispatch their configured workflows once per workflow', async () => {
  const requiredChecks = [
    { name: 'python ubuntu', workflow: 'test.yml' },
    { name: 'python windows', workflow: 'test.yml' },
    { name: 'node', workflow: 'node.yml' },
    { name: 'unmapped' },
    { name: 'already green', workflow: 'other.yml' },
    'string check'
  ];
  const result = { state: 'missing', missing: ['python ubuntu', 'python windows', 'node', 'unmapped', 'string check'], failed: [], pending: [] };
  const request = test.mock.fn(async () => ({ workflow_runs: [] }));
  await dispatchMissingChecks('org/project', 'main', 'head', 'head', result, requiredChecks, request);
  assert.deepEqual(request.mock.calls.map(call => call.arguments), [
    ['/repos/org/project/actions/workflows/test.yml/runs?head_sha=head&event=workflow_dispatch&per_page=1'],
    ['/repos/org/project/actions/workflows/test.yml/dispatches', { method: 'POST', body: { ref: 'main' } }],
    ['/repos/org/project/actions/workflows/node.yml/runs?head_sha=head&event=workflow_dispatch&per_page=1'],
    ['/repos/org/project/actions/workflows/node.yml/dispatches', { method: 'POST', body: { ref: 'main' } }]
  ]);
});

test('an existing dispatch on HEAD prevents another dispatch regardless of run state', async () => {
  for (const status of ['queued', 'in_progress', 'completed']) {
    const request = test.mock.fn(async () => ({ workflow_runs: [{ html_url: 'run-url', status }] }));
    await dispatchMissingChecks('org/project', 'main', 'head', 'head',
      { state: 'missing', missing: ['node'] }, [{ name: 'node', workflow: 'node.yml' }], request);
    assert.equal(request.mock.callCount(), 1);
    assert.equal(request.mock.calls[0].arguments[0], '/repos/org/project/actions/workflows/node.yml/runs?head_sha=head&event=workflow_dispatch&per_page=1');
  }
});

test('missing checks without workflow metadata do not dispatch', async () => {
  const request = test.mock.fn();
  await dispatchMissingChecks('org/project', 'main', 'head', 'head',
    { state: 'missing', missing: ['unmapped', 'string check'] },
    [{ name: 'unmapped' }, 'string check', { name: 'other', workflow: 'other.yml' }], request);
  assert.equal(request.mock.callCount(), 0);
});

test('dispatch recovery never runs for failed, pending, successful or non-HEAD evaluations', async () => {
  const request = test.mock.fn();
  const checks = [{ name: 'node', workflow: 'node.yml' }];
  for (const state of ['failure', 'pending', 'success', 'unconfigured', 'not-applicable']) {
    await dispatchMissingChecks('org/project', 'main', 'head', 'head', { state, missing: ['node'] }, checks, request);
  }
  for (const extra of [{ failed: ['other'] }, { pending: ['other'] }, { missing: [] }]) {
    await dispatchMissingChecks('org/project', 'main', 'head', 'head', { state: 'missing', missing: ['node'], ...extra }, checks, request);
  }
  await dispatchMissingChecks('org/project', 'main', 'old-prepared', 'head',
    { state: 'missing', missing: ['node'] }, checks, request);
  assert.equal(request.mock.callCount(), 0);
});

test('dispatch lookup and write errors warn without throwing and continue other workflows', async () => {
  for (const status of [403, 404, 422]) {
    for (const failLookup of [true, false]) {
      const writes = [];
      const request = async (path, options) => {
        if (path.includes('/node.yml/') && (failLookup || options?.method === 'POST')) {
          throw Object.assign(new Error('dispatch denied'), { status });
        }
        if (options?.method === 'POST') writes.push(path);
        return { workflow_runs: [] };
      };
      const result = { state: 'missing', missing: ['node', 'python'] };
      await dispatchMissingChecks('org/project', 'main', 'head', 'head', result,
        [{ name: 'node', workflow: 'node.yml' }, { name: 'python', workflow: 'test.yml' }], request);
      assert.deepEqual(writes, ['/repos/org/project/actions/workflows/test.yml/dispatches']);
      assert.equal(result.state, 'missing');
    }
  }
});

test('unexpected dispatch service errors remain visible', async () => {
  await assert.rejects(dispatchMissingChecks('org/project', 'main', 'head', 'head',
    { state: 'missing', missing: ['node'] }, [{ name: 'node', workflow: 'node.yml' }],
    async () => { throw Object.assign(new Error('service unavailable'), { status: 500 }); }), /service unavailable/);
});

test('only LayoutLingua release checks opt into dispatch recovery', () => {
  const ci = JSON.parse(fs.readFileSync(new URL('../../ci-policy.json', import.meta.url), 'utf8'));
  const mapped = Object.entries(ci.repositories).flatMap(([repo, profile]) =>
    profile.requiredChecks.filter(check => check.workflow).map(check => [repo, check.name, check.workflow]));
  assert.deepEqual(mapped, [
    ['LayoutLingua', 'test (ubuntu-latest) / Test (ubuntu-latest)', 'test.yml'],
    ['LayoutLingua', 'test (windows-latest) / Test (windows-latest)', 'test.yml'],
    ['LayoutLingua', 'test (macos-latest) / Test (macos-latest)', 'test.yml'],
    ['LayoutLingua', 'verify / Node (Ubuntu)', 'node.yml']
  ]);
});

test('release intent accepts original and squash subjects for both modes', () => {
  for (const [mode, subject] of [['tag', 'chore(release): prepare v1.2.0'], ['commit', 'release: v1.2.0']]) {
    for (const suffix of ['', ' (#12)']) {
      assert.equal(releaseIntent(subject + suffix + '\n\nDetails', mode), '1.2.0');
    }
    assert.equal(releaseIntent(subject + '-rc.1 (#3)', mode), '1.2.0-rc.1');
    assert.equal(releaseIntent(subject + ' other text', mode), null);
    assert.equal(releaseIntent('', mode), null);
    assert.equal(releaseIntent('fix: repair bug', mode), null);
  }
  assert.equal(releaseIntent('release: v1.2.0', 'tag'), null);
  assert.equal(releaseIntent('chore(release): prepare v1.2.0', 'commit'), null);
});

test('release PR markers round-trip and reject absent or malformed metadata', () => {
  const base = 'a'.repeat(40);
  const marker = releasePrMarker(base, '1.2.0-rc.1');
  assert.equal(marker, `<!-- thanhnguyxnagent-release base=${base} version=1.2.0-rc.1 -->`);
  assert.deepEqual(parseReleasePrMarker('Notes\n\n' + marker), { base, version: '1.2.0-rc.1' });
  for (const body of [undefined, '', marker.replace(base, 'invalid'), marker.replace('1.2.0-rc.1', 'invalid')]) {
    assert.equal(parseReleasePrMarker(body), null);
  }
});

test('release branch stays current only with one exact HEAD parent and matching subject', () => {
  const commit = { parents: [{ sha: 'head' }], message: 'release: v1.2.0\n\nDetails' };
  assert.equal(keepReleaseCommit(commit, 'head', 'release: v1.2.0', [], []), true);
  assert.equal(keepReleaseCommit(commit, 'new-head', 'release: v1.2.0'), false);
  assert.equal(keepReleaseCommit(commit, 'head', 'release: v1.3.0'), false);
  for (const parents of [[], [{ sha: 'head' }, { sha: 'other' }]]) {
    assert.equal(keepReleaseCommit({ ...commit, parents }, 'head', 'release: v1.2.0'), false);
  }
  assert.equal(keepReleaseCommit(undefined, 'head', 'release: v1.2.0'), false);
});

test('release commit content comparison requires the exact generated blobs and no other changed files', () => {
  const commit = { parents: [{ sha: 'head' }], message: 'release: v1.2.0' };
  const changes = [{ path: 'version.txt', content: 'hello\n' }];
  const files = [{ filename: 'version.txt', status: 'modified', sha: 'ce013625030ba8dba906f756967f9e9ca394464a' }];
  assert.equal(keepReleaseCommit(commit, 'head', commit.message, changes, files), true);
  assert.equal(keepReleaseCommit(commit, 'head', commit.message, [{ ...changes[0], content: 'different\n' }], files), false);
  assert.equal(keepReleaseCommit(commit, 'head', commit.message, [...changes, { path: 'new.txt', content: 'new' }], files), false);
  assert.equal(keepReleaseCommit(commit, 'head', commit.message, changes, [...files, { filename: 'unrelated.txt' }]), false);
  assert.equal(keepReleaseCommit(commit, 'head', commit.message, changes, [{ ...files[0], filename: 'other.txt' }]), false);
  for (const status of ['removed', 'renamed']) {
    assert.equal(keepReleaseCommit(commit, 'head', commit.message, changes, [{ ...files[0], status }]), false);
  }
  assert.equal(keepReleaseCommit(commit, 'head', commit.message, changes, undefined), false);
});

test('release PR keeps matching content and rebuilds for changed or newly configured version files', async () => {
  const head = 'a'.repeat(40);
  const subject = 'release: v2.0.1';
  let pr = { number: 65, html_url: 'pr-url', title: subject, body: '' };
  let changes = [
    { path: '_version.py', content: '__version__ = "2.0.1"\n' },
    { path: 'CHANGELOG.md', content: '# Changelog\n\n## [2.0.1] - 2026-01-01\n\nNotes\n' }
  ];
  const files = changes.map(change => ({
    filename: change.path, status: 'modified',
    sha: createHash('sha1').update('blob ' + Buffer.byteLength(change.content) + '\0' + change.content).digest('hex')
  }));
  const request = async (path, options) => {
    if (path.includes('state=open')) return [pr];
    if (path.includes('/git/ref/')) return { object: { sha: 'release-head' } };
    if (path.includes('/git/commits/')) return { sha: 'release-head', message: subject, parents: [{ sha: head }] };
    if (path.endsWith('/compare/' + head + '...release-head')) return { files };
    if (path.endsWith('/pulls/65')) { pr = { ...pr, ...options.body }; return pr; }
    assert.fail(path);
  };
  const build = test.mock.fn();
  const prepare = test.mock.fn(async () => changes);
  const ensure = () => ensureReleasePr('org/repo', 'main', head, '2.0.1', 'Notes', subject, build, request, prepare);
  await ensure();
  assert.equal(build.mock.callCount(), 0);
  assert.equal(prepare.mock.callCount(), 1);
  const originalChanges = changes;
  changes = changes.map(change => change.path === '_version.py' ? { ...change, content: "__version__ = '2.0.1'\n" } : change);
  await ensure();
  assert.equal(build.mock.callCount(), 1);
  assert.equal(build.mock.calls[0].arguments[0], changes);
  changes = [...originalChanges, { path: 'package.json', content: '{"version":"2.0.1"}\n' }];
  await ensure();
  assert.equal(build.mock.callCount(), 2);
  assert.equal(build.mock.calls[1].arguments[0], changes);
  assert.equal(prepare.mock.callCount(), 3);
});

test('release changes use the HEAD commit date so repeated runs across days are identical', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-02T00:00:00Z') });
  const sources = { 'package.json': '{"version":"2.0.0"}\n', 'CHANGELOG.md': '# Changelog\n' };
  const request = async path => {
    if (path.endsWith('/git/commits/head')) return { committer: { date: '2026-01-01T23:59:00Z' } };
    const file = Object.keys(sources).find(name => path.includes('/contents/' + name + '?ref=head'));
    if (!file) assert.fail(path);
    return { encoding: 'base64', content: Buffer.from(sources[file]).toString('base64') };
  };
  const rule = { versionFiles: [{ path: 'package.json', kind: 'json', jsonPaths: [['version']] }] };
  const first = await prepareReleaseChanges('org/repo', 'head', '2.0.1', 'Notes', rule, request);
  t.mock.timers.setTime(new Date('2026-02-03T00:00:00Z').getTime());
  assert.deepEqual(await prepareReleaseChanges('org/repo', 'head', '2.0.1', 'Notes', rule, request), first);
  assert.equal(first[0].content, '{\n  "version": "2.0.1"\n}\n');
  assert.match(first[1].content, /## \[2\.0\.1\] - 2026-01-01\n\nNotes/);
  const changedNotes = await prepareReleaseChanges('org/repo', 'head', '2.0.1', 'Updated notes', rule, request);
  assert.notEqual(changedNotes[1].content, first[1].content);
  sources['package.json'] = first[0].content;
  sources['CHANGELOG.md'] = first[1].content;
  assert.deepEqual(await prepareReleaseChanges('org/repo', 'head', '2.0.1', 'Notes', rule, request), []);
  await assert.rejects(prepareReleaseChanges('org/repo', 'head', '2.0.1', 'Notes', rule,
    async () => { throw new Error('lookup failed'); }), /lookup failed/);
});

test('declined release uses the most recently closed unmerged PR and its base marker', async () => {
  const head = 'a'.repeat(40);
  const closed = [
    { closed_at: '2026-01-03', merged_at: '2026-01-03', body: '' },
    { closed_at: '2026-01-01', body: '' },
    { closed_at: '2026-01-02', body: releasePrMarker(head, '1.2.0') }
  ];
  assert.equal(await releasePrDeclined('org/repo', 'main', head, async () => closed), true);
  assert.equal(await releasePrDeclined('org/repo', 'main', 'b'.repeat(40), async () => closed), false);
  assert.equal(await releasePrDeclined('org/repo', 'main', head, async () => []), false);
  await assert.rejects(releasePrDeclined('org/repo', 'main', head, async () => { throw new Error('lookup failed'); }), /lookup failed/);
});

test('release PR skips declined HEAD without building or writing and retries a newer HEAD', async () => {
  const head = 'a'.repeat(40);
  const writes = [];
  const build = test.mock.fn();
  const request = async (path, options) => {
    if (path.includes('state=open')) return [];
    if (path.includes('state=closed')) return [{ body: releasePrMarker(head, '1.2.0'), closed_at: '2026-01-01' }];
    if (path.includes('/git/ref/')) throw Object.assign(new Error('missing'), { status: 404 });
    if (options?.method === 'POST') { writes.push(options.body); return { html_url: 'pr-url' }; }
    assert.fail(path);
  };
  assert.equal(await ensureReleasePr('org/repo', 'main', head, '1.2.0', 'Notes', 'release: v1.2.0', build, request), undefined);
  assert.equal(build.mock.callCount(), 0);
  assert.deepEqual(writes, []);
  const newer = 'b'.repeat(40);
  await ensureReleasePr('org/repo', 'main', newer, '1.3.0', 'New notes', 'release: v1.3.0', build, request);
  assert.equal(build.mock.callCount(), 1);
  assert.deepEqual(writes[0], {
    head: RELEASE_BRANCH, base: 'main', title: 'release: v1.3.0',
    body: 'New notes\n\nMerge to approve this release (any merge method; squash keeps the title). Close to postpone until new commits land. ThanhNguyxnAgent keeps this PR updated with new commits.\n\n' + releasePrMarker(newer, '1.3.0')
  });
});

test('release PR updates metadata only when changed and keeps an unchanged commit', async () => {
  const head = 'a'.repeat(40);
  let pr = { number: 7, title: 'old title', body: '', html_url: 'pr-url' };
  let branchCommit = { sha: 'release-head', message: 'release: v1.2.0', parents: [{ sha: head }] };
  const build = test.mock.fn();
  const updates = [];
  const request = async (path, options) => {
    if (path.includes('state=open')) return [pr];
    if (path.includes('/git/ref/')) return { object: { sha: 'release-head' } };
    if (path.includes('/git/commits/')) return branchCommit;
    if (path.endsWith('/compare/' + head + '...release-head')) return { files: [] };
    if (path.endsWith('/pulls/7')) {
      assert.equal(options.method, 'PATCH');
      updates.push(options.body); pr = { ...pr, ...options.body }; return pr;
    }
    assert.fail(path);
  };
  for (let i = 0; i < 2; i += 1) await ensureReleasePr('org/repo', 'main', head, '1.2.0', 'Notes', 'release: v1.2.0', build, request);
  assert.equal(build.mock.callCount(), 0);
  assert.equal(updates.length, 1);
  assert.deepEqual(Object.keys(updates[0]), ['title', 'body']);
  branchCommit = { ...branchCommit, parents: [{ sha: 'old-head' }] };
  await ensureReleasePr('org/repo', 'main', head, '1.2.0', 'Notes', 'release: v1.2.0', build, request);
  assert.equal(build.mock.callCount(), 1);
  assert.equal(updates.length, 1);
});

test('release branch lookup errors fail closed', async () => {
  const build = test.mock.fn();
  await assert.rejects(ensureReleasePr('org/repo', 'main', 'head', '1.2.0', '', 'release: v1.2.0', build, async path => {
    if (path.includes('state=open')) return [{ number: 7 }];
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }), /forbidden/);
  assert.equal(build.mock.callCount(), 0);
});

test('release commit creates a missing branch or force-updates the release branch only', async () => {
  for (const missing of [false, true]) {
    const calls = [];
    const request = async (path, options) => {
      calls.push({ path, options });
      if (path.endsWith('/commits/head')) return { tree: { sha: 'tree' } };
      if (path.endsWith('/git/blobs')) return { sha: 'blob' };
      if (path.endsWith('/git/trees')) return { sha: 'new-tree' };
      if (path.endsWith('/git/commits')) return { sha: 'commit' };
      if (path.includes('/git/ref/heads/') && missing) throw Object.assign(new Error('missing'), { status: 404 });
      return {};
    };
    await createCommit('org/repo', RELEASE_BRANCH, 'head', [{ path: 'CHANGELOG.md', content: 'Notes' }], 'release: v1.2.0', request, { force: true, create: true });
    const patch = calls.find(call => call.options?.method === 'PATCH');
    assert.equal(Boolean(patch), !missing);
    if (!missing) {
      assert.equal(patch.path, '/repos/org/repo/git/refs/heads/' + RELEASE_BRANCH);
      assert.deepEqual(patch.options.body, { sha: 'commit', force: true });
    }
    const create = calls.find(call => call.path.endsWith('/git/refs'));
    assert.equal(Boolean(create), missing);
    if (missing) assert.deepEqual(create.options.body, { ref: 'refs/heads/' + RELEASE_BRANCH, sha: 'commit' });
    const commit = calls.find(call => call.path.endsWith('/git/commits')).options.body;
    assert.deepEqual(commit.parents, ['head']);
    assert.equal(commit.tree, 'new-tree');
  }
  await assert.rejects(createCommit('org/repo', RELEASE_BRANCH, 'head', [], 'release: v1.2.0', async path => {
    if (path.endsWith('/commits/head')) return { tree: { sha: 'tree' } };
    if (path.endsWith('/git/commits')) return { sha: 'commit' };
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }, { force: true, create: true }), /forbidden/);
});

test('merged release cleanup preserves any open PR and tolerates absent refs', async () => {
  for (const status of [null, 404, 422, 403]) {
    const request = test.mock.fn(async (path, options) => {
      if (!options) { assert.ok(!path.includes('&base=')); return []; }
      assert.equal(options.method, 'DELETE');
      if (status) throw Object.assign(new Error('delete failed'), { status });
    });
    if (status === 403) await assert.rejects(cleanupReleaseBranch('org/repo', 'main', request), /delete failed/);
    else await cleanupReleaseBranch('org/repo', 'main', request);
    assert.equal(request.mock.callCount(), 2);
  }
  const request = test.mock.fn(async () => [{ number: 1 }]);
  await cleanupReleaseBranch('org/repo', 'main', request);
  assert.equal(request.mock.callCount(), 1);
});

test('re-prepares a release with missing or failed checks only at a newer verified HEAD', async () => {
  for (const preparedState of ['missing', 'failure']) {
    assert.equal(await shouldReprepareRelease(preparedState, 'old', 'new', async () => 'success'), true);
    assert.equal(await shouldReprepareRelease(preparedState, 'old', 'new', async () => 'missing'), false);
    assert.equal(await shouldReprepareRelease(preparedState, 'old', 'new', async () => 'pending'), false);
  }

  const unexpectedCheck = async () => assert.fail('should wait without evaluating HEAD');
  assert.equal(await shouldReprepareRelease('missing', 'same', 'same', unexpectedCheck), false);
  assert.equal(await shouldReprepareRelease('pending', 'old', 'new', unexpectedCheck), false);
  assert.equal(await shouldReprepareRelease('unconfigured', 'old', 'new', unexpectedCheck), false);
});

const policy = JSON.parse(fs.readFileSync(new URL('../../release-policy.json', import.meta.url), 'utf8'));

test('release commit reuses the parent tree when the prepared files are already current', async () => {
  const request = test.mock.fn(async path => {
    if (path.endsWith('/commits/current')) return { tree: { sha: 'existing-tree' } };
    if (path.endsWith('/git/commits')) return { sha: 'new-commit' };
    if (path.endsWith('/git/refs/heads/main')) return {};
    assert.fail(`Unexpected request ${path}`);
  });

  const message = 'chore(release): prepare v0.2.0';
  assert.equal(await createCommit('org/project', 'main', 'current', [], message, request), 'new-commit');
  assert.equal(request.mock.callCount(), 3);
  const [, commit, advanceRef] = request.mock.calls;
  assert.equal(commit.arguments[1].body.tree, 'existing-tree');
  assert.deepEqual(commit.arguments[1].body.parents, ['current']);
  assert.equal(commit.arguments[1].body.message, message);
  assert.deepEqual(advanceRef.arguments[1], { method: 'PATCH', body: { sha: 'new-commit', force: false } });
});

test('Conventional Commit types map to the configured SemVer levels', () => {
  assert.equal(classifyConventionalCommit('feat(ui): add palette switch').level, 'minor');
  assert.equal(classifyConventionalCommit('fix: guard empty file').level, 'patch');
  assert.equal(classifyConventionalCommit('feat!: remove legacy config').level, 'major');
  assert.equal(classifyConventionalCommit('refactor: simplify module'), null);
  assert.equal(classifyConventionalCommit('chore: update docs'), null);
  assert.equal(classifyConventionalCommit('fix(release): repair publisher'), null);
  assert.equal(classifyConventionalCommit('feat(ci): adopt shared workflow'), null);
  assert.equal(classifyConventionalCommit('fix(build): update compiler contract'), null);
  assert.equal(classifyConventionalCommit('fix(docs): correct install guide'), null);
  assert.equal(classifyConventionalCommit('feat(meta): update repository metadata'), null);
  assert.equal(classifyConventionalCommit('feat: change auth\n\nBREAKING CHANGE: old tokens are rejected').level, 'major');
});


test('release notes preserve conventional sections and append other changes in input order', () => {
  const messages = [
    'Fix multilingual prose detection, Argos routes, and translation chunking (#68)',
    'feat(ui): add palette (#69)',
    'fix: repair import (#70)',
    'chore: refresh dependencies (#71)',
    'revert: undo regression',
    'feat!: remove legacy API'
  ];
  const commits = messages.map((message, index) => ({ sha: String(index).repeat(40), commit: { message } }));
  const entry = (subject, index) => '- ' + subject + ' ([' + String(index).repeat(7) +
    '](https://github.com/org/project/commit/' + String(index).repeat(40) + '))';
  const notes = makeReleaseNotes(commits, 'org/project');
  assert.equal(notes, [
    '### Breaking Changes\n\n' + entry('remove legacy API', 5),
    '### Features\n\n' + entry('add palette (#69)', 1),
    '### Bug Fixes and Performance\n\n' + entry('repair import (#70)', 2),
    '### Reverts\n\n' + entry('undo regression', 4),
    '### Other changes\n\n' + entry(messages[0], 0) + '\n' + entry(messages[3], 3)
  ].join('\n\n'));
  const changelog = insertChangelogSection('', '1.2.0', '2026-11-23', notes);
  assert.equal(releaseNotesFromChangelog(changelog, '1.2.0'), notes);
  assert.match(releaseBodyFromChangelog(changelog, '1.2.0'), /Fix multilingual prose detection/);
});

test('other changes exclude release intents and merge noise and omit empty sections', () => {
  const messages = [
    '', '  ', 'release: v1.2.0', 'release: 1.2.0-rc.1 (#12)',
    'chore(release): prepare v1.2.0 (#13)\n\nRelease notes',
    "Merge branch 'main'", 'Merge pull request #14 from org/topic',
    "Merge remote-tracking branch 'origin/main'"
  ];
  const commits = messages.map(message => ({ message, sha: 'abcdef123456' }));
  assert.equal(makeReleaseNotes(commits, 'org/project'), '');
  assert.equal(makeReleaseNotes([], 'org/project'), '');
  const fix = { message: 'fix: repair runtime', sha: '123456789abc' };
  assert.equal(makeReleaseNotes([...commits, fix], 'org/project'),
    '### Bug Fixes and Performance\n\n- repair runtime ([1234567](https://github.com/org/project/commit/123456789abc))');
});

test('other changes do not affect release eligibility or bump level', () => {
  const commits = ['Improve documentation (#72)', 'chore: refresh dependencies',
    'fix(docs): clarify setup', 'refactor: simplify parser', 'fix(release): repair publishing']
    .map(message => ({ message, sha: 'abcdef123456' }));
  assert.equal(highestReleaseLevel(commits), null);
  const notes = makeReleaseNotes(commits, 'org/project');
  assert.match(notes, /^### Other changes\n/);
  for (const commit of commits) assert.ok(notes.includes(commit.message));
  assert.equal(highestReleaseLevel([...commits, { message: 'fix: repair runtime' }]), 'patch');
  assert.equal(highestReleaseLevel([...commits, { message: 'feat: add runtime' }]), 'minor');
});

test('release notes are extracted from the exact generated changelog section', () => {
  const changelog = [
    '# Changelog',
    '',
    '## [1.2.0] - 2026-11-09',
    '',
    '### Features',
    '',
    '- Add a new view.',
    '',
    '## [1.1.0] - 2026-10-01',
    '',
    'Old release.',
    ''
  ].join('\n');
  const notes = releaseNotesFromChangelog(changelog, '1.2.0');
  assert.match(notes, /### Features/);
  assert.match(notes, /Add a new view/);
  assert.doesNotMatch(notes, /Old release/);
});

test('release publication requires the exact version changelog section', () => {
  const changelog = ['# Changelog', '', '## [1.4.0] - 2026-11-14', '', '### Features', '', '- Add platform-aware packaging.', ''].join('\n');
  assert.match(releaseBodyFromChangelog(changelog, '1.4.0'), /Add platform-aware packaging/);
  assert.throws(
    () => releaseBodyFromChangelog(changelog, '1.3.9'),
    /has no release section for version 1.3.9/
  );
});

test('SemVer bump is deterministic', () => {
  assert.equal(bumpSemver('1.2.3', 'patch'), '1.2.4');
  assert.equal(bumpSemver('1.2.3', 'minor'), '1.3.0');
  assert.equal(bumpSemver('1.2.3', 'major'), '2.0.0');
});

test('highest release level selects the strongest commit', () => {
  assert.equal(highestReleaseLevel([{ message: 'fix: repair parser' }, { message: 'feat: add export' }]), 'minor');
  assert.equal(highestReleaseLevel([{ message: 'feat: add export' }, { message: 'fix!: break old parser' }]), 'major');
});

test('changelog section is inserted before previous releases without deleting content', () => {
  const original = '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\nOld release.\n';
  const updated = insertChangelogSection(original, '1.1.0', '2026-11-09', '### Features\n\n- Add export.');
  assert.match(updated, /## \[1.1.0\] - 2026-11-09/);
  assert.match(updated, /## \[1.0.0\] - 2026-01-01/);
  assert.match(updated, /Old release\./);
  assert.match(updated, /## \[Unreleased\]/);
});

test('every centrally managed version-file pattern compiles and updates its version', () => {
  const fixtures = {
    'ClipForge/CMakeLists.txt': 'project(ClipForge VERSION 0.2.0 LANGUAGES CXX)\n',
    'LayoutLingua/pyproject.toml': 'version = "2.0.0"\n',
    'LayoutLingua/layoutlingua/_version.py': '__version__ = "2.0.0"\n',
    'LayoutLingua/README.md': '# 🚀 LayoutLingua v2.0.0 🌟\n\n<img src="https://img.shields.io/badge/Version-2.0.0-0D9488?style=for-the-badge" alt="Version 2.0.0" />\n',
    'LayoutLingua/src/components/CreditsModal.tsx': "const APP_VERSION = '2.0.0'\n",
    'LayoutLingua/docs/API_REFERENCE.md': '{ "status": "ok", "version": "2.1.0", "engine": "PyMuPDF" }\n',
    'PurgeKit/src-tauri/Cargo.toml': 'version = "1.3.0"\n',
    'Locsight/src-tauri/Cargo.toml': 'version = "2.2.0"\n',
    'cogmint/src-tauri/Cargo.toml': 'version = "2.0.0"\n',
    'git-account-switcher/bin/git-account-switcher': 'SCRIPT_VERSION="1.0.0"\n',
    'git-account-switcher/bin/git-account-switcher.ps1': '$SCRIPT_VERSION = "1.0.0"\n',
    'blendops/scripts/install-skills.mjs': "export const INSTALLER_VERSION = '1.0.0';\n"
  };
  for (const [repo, rule] of Object.entries(policy.repositories)) {
    for (const file of rule.versionFiles || []) {
      if (file.kind !== 'regex') continue;
      const key = repo + '/' + file.path;
      const fixture = fixtures[key];
      assert.ok(fixture, 'fixture must exist for ' + key);
      assert.doesNotThrow(() => new RegExp(file.pattern, 'm'), key + ' regex must compile');
      const updated = applyVersionFile(file, fixture, '9.8.7');
      assert.match(updated, /9\.8\.7/, key + ' must contain the new version');
      assert.doesNotMatch(updated, /(?:0\.2\.0|2\.0\.0|1\.3\.0|1\.0\.0)/, key + ' must not retain the old version');
    }
  }
});

test('JSON version paths preserve the project manifest while updating configured values', () => {
  const purge = policy.repositories.PurgeKit.versionFiles;
  const fixture = { package: '{"version":"1.3.0","name":"purgekit"}\n', tauri: '{"version":"1.3.0","productName":"PurgeKit"}\n' };
  const packageFile = applyVersionFile(purge[0], fixture.package, '1.4.0');
  const tauriFile = applyVersionFile(purge[1], fixture.tauri, '1.4.0');
  assert.equal(JSON.parse(packageFile).version, '1.4.0');
  assert.equal(JSON.parse(packageFile).name, 'purgekit');
  assert.equal(JSON.parse(tauriFile).version, '1.4.0');
  assert.equal(JSON.parse(tauriFile).productName, 'PurgeKit');
});

test('LayoutLingua release policy keeps package, lock, README, credits and API versions aligned', () => {
  const files = policy.repositories.LayoutLingua.versionFiles;
  assert.equal(new Set(files.map(file => file.path)).size, files.length);
  const fixtures = {
    'pyproject.toml': 'version = "2.0.0"\n',
    'layoutlingua/_version.py': '__version__ = "2.0.0"\n',
    'package.json': '{"name":"layoutlingua","version":"2.0.0","dependencies":{"example":"2.0.0"}}',
    'package-lock.json': '{"version":"2.0.0","packages":{"":{"name":"layoutlingua","version":"2.0.0"},"node_modules/example":{"version":"2.0.0"}}}',
    'README.md': '# 🚀 LayoutLingua v2.0.0 🌟\n\n<img src="https://img.shields.io/badge/Version-2.0.0-0D9488?style=for-the-badge" alt="Version 2.0.0" />\n\nNode.js >= 22.0.0\n',
    'src/components/CreditsModal.tsx': "const APP_VERSION = '2.0.0'\n",
    'docs/API_REFERENCE.md': '{ "status": "ok", "version": "2.1.0", "engine": "PyMuPDF" }\n'
  };
  for (const version of ['2.0.1', '2.1.0-rc.1', '2.1.0']) {
    for (const file of files) fixtures[file.path] = applyVersionFile(file, fixtures[file.path], version);
    const pkg = JSON.parse(fixtures['package.json']);
    const lock = JSON.parse(fixtures['package-lock.json']);
    assert.equal(pkg.version, version);
    assert.equal(pkg.dependencies.example, '2.0.0');
    assert.equal(lock.version, version);
    assert.equal(lock.packages[''].version, version);
    assert.equal(lock.packages['node_modules/example'].version, '2.0.0');
    assert.ok(fixtures['README.md'].includes('# 🚀 LayoutLingua v' + version + ' 🌟'));
    assert.ok(fixtures['README.md'].includes('badge/Version-' + version + '-0D9488?style=for-the-badge'));
    assert.ok(fixtures['README.md'].includes('alt="Version ' + version + '"'));
    assert.ok(fixtures['README.md'].includes('Node.js >= 22.0.0'));
    assert.equal(fixtures['src/components/CreditsModal.tsx'], "const APP_VERSION = '" + version + "'\n");
    assert.equal(JSON.parse(fixtures['docs/API_REFERENCE.md']).version, version);
  }
  for (const file of files.filter(file => file.kind === 'regex')) {
    assert.throws(() => applyVersionFile(file, '', '2.0.1'), /Version pattern did not match/);
  }
});

test('only the newest unpublished draft per version is eligible for publication', () => {
  const olderDraft = { id: 1, tag_name: 'v1.1.1', draft: true, created_at: '2026-11-09T10:00:00Z' };
  const newerDraft = { id: 2, tag_name: 'v1.1.1', draft: true, created_at: '2026-11-10T10:00:00Z' };
  const published = { id: 3, tag_name: 'v1.1.1', draft: false };
  assert.deepEqual(pendingDraftReleases([olderDraft]), [olderDraft]);
  assert.deepEqual(pendingDraftReleases([olderDraft, newerDraft]), [newerDraft]);
  assert.deepEqual(pendingDraftReleases([olderDraft, published]), []);
  assert.deepEqual(pendingDraftReleases([{ id: 4, tag_name: 'untagged-abc', draft: true }]), []);
});

test('required release assets are verified by name and version placeholders', () => {
  const tag = 'v1.2.3';
  const manifest = ['app-{tag}.zip', 'checksums.txt', 'App-{version}.dmg'];
  const assets = [
    { name: 'app-v1.2.3.zip', state: 'uploaded' },
    { name: 'checksums.txt', state: 'uploaded' },
    { name: 'App-1.2.3.dmg', state: 'uploaded' }
  ];
  assert.deepEqual(missingRequiredAssets(assets, manifest, tag), []);
  assert.deepEqual(missingRequiredAssets(assets.slice(0, 2), manifest, tag), ['App-1.2.3.dmg']);
  assert.deepEqual(missingRequiredAssets([{ name: 'app-v1.2.3.zip', state: 'new' }], ['app-{tag}.zip'], tag), ['app-v1.2.3.zip']);
});


test('orphan release recovery copies only manifest assets and deletes only after digest-verified mirroring', () => {
  const source = [
    { id: 1, name: 'app-v1.2.3.zip', state: 'uploaded', size: 10, digest: 'sha256:app' },
    { id: 2, name: 'checksums.txt', state: 'uploaded', size: 20, digest: 'sha256:sum' }
  ];
  const required = ['app-{tag}.zip', 'checksums.txt'];
  const plan = planOrphanAssetRecovery(source, [], required, 'v1.2.3');
  assert.deepEqual(plan.copy.map(asset => asset.name), ['app-v1.2.3.zip', 'checksums.txt']);
  assert.deepEqual(plan.missing, []);
  assert.equal(plan.safeToDelete, false);

  const mirrored = planOrphanAssetRecovery(source, source.map(asset => ({ ...asset })), required, 'v1.2.3');
  assert.equal(mirrored.safeToDelete, true);
});

test('orphan release recovery refuses mismatched or unexpected assets', () => {
  const source = [
    { name: 'app-v1.2.3.zip', state: 'uploaded', size: 10, digest: 'sha256:source' },
    { name: 'unlisted-debug.zip', state: 'uploaded', size: 4, digest: 'sha256:debug' }
  ];
  const conflictingDestination = [
    { name: 'app-v1.2.3.zip', state: 'uploaded', size: 10, digest: 'sha256:other' }
  ];
  const conflict = planOrphanAssetRecovery(source, conflictingDestination, ['app-{tag}.zip'], 'v1.2.3');
  assert.deepEqual(conflict.conflicts, ['app-v1.2.3.zip']);
  assert.equal(conflict.safeToDelete, false);

  const extra = planOrphanAssetRecovery(source, [source[0]], ['app-{tag}.zip'], 'v1.2.3');
  assert.equal(extra.safeToDelete, false);
});

test('orphan release recovery fails closed when no asset manifest exists', () => {
  const plan = planOrphanAssetRecovery(
    [{ name: 'app.zip', state: 'uploaded', size: 10, digest: 'sha256:app' }],
    [],
    [],
    'v1.2.3'
  );
  assert.equal(plan.safeToDelete, false);
});

test('release check policy receives changed-file context when paths are configured', () => {
  const checks = [{name:'Test (ubuntu-latest)',paths:['layoutlingua/**']}];
  assert.deepEqual(changedFilesForPolicy({files:[{filename:'layoutlingua/_version.py'},{filename:'CHANGELOG.md'}]},checks),['layoutlingua/_version.py','CHANGELOG.md']);
  assert.equal(changedFilesForPolicy({files:[]},['Lint']),undefined);
  assert.equal(changedFilesForPolicy({files:Array.from({length:300},()=>({filename:'layoutlingua/x.py'}))},checks),undefined);
});

test('release matching trusts tag_name and actual tag identity, not a stale untagged html_url slug', () => {
  assert.equal(releaseMatchesTag({tag_name:'v1.1.2',html_url:'https://github.com/owner/repo/releases/tag/untagged-abc'},'v1.1.2'),true);
  assert.equal(releaseMatchesTag({tag_name:'v1.1.1',html_url:'https://github.com/owner/repo/releases/tag/v1.1.2'},'v1.1.2'),false);
});

test('release collection fallback reuses the exact draft when tag lookup returns 404', () => {
  const exactDraft = {
    id: 440246458,
    tag_name: 'v1.1.1',
    html_url: 'https://github.com/owner/repo/releases/tag/untagged-e3ee0aa97d6964c6b5df',
    draft: true,
    created_at: '2026-11-10T10:56:03Z'
  };
  assert.equal(selectReleaseByTag([exactDraft, { id: 9, tag_name: 'v1.1.10', draft: true }], 'v1.1.1').id, 440246458);
  assert.equal(selectReleaseByTag([{ id: 10, tag_name: 'v1.1.1', draft: false }, exactDraft], 'v1.1.1').id, 10);
  assert.equal(selectReleaseByTag([{ id: 11, tag_name: 'v1.1.10', draft: true }], 'v1.1.1'), null);
});

test('legacy untagged drafts are reused only when name and target SHA identify the exact release', () => {
  const targetSha = 'a'.repeat(40);
  const releases = [
    { id: 1, tag_name: 'untagged-e3ee0aa97d6964c6b5df', name: 'WriteCanvas v1.1.1', target_commitish: targetSha, draft: true },
    { id: 2, tag_name: 'untagged-bbbb1111222233334444', name: 'WriteCanvas v1.1.1', target_commitish: 'b'.repeat(40), draft: true },
    { id: 3, tag_name: 'untagged-cccc1111222233334444', name: 'WriteCanvas v1.1.1', target_commitish: targetSha, draft: false },
    { id: 4, tag_name: 'untagged-dddd1111222233334444', name: 'Other release', target_commitish: targetSha, draft: true }
  ];
  assert.equal(selectOrphanDraftForTag(releases, 'v1.1.1', targetSha, 'WriteCanvas v1.1.1').id, 1);
  assert.equal(selectOrphanDraftForTag(releases, 'v1.1.1', 'not-a-sha', 'WriteCanvas v1.1.1'), null);
  assert.equal(selectOrphanDraftForTag(releases, 'v1.1.1', targetSha, 'Wrong name'), null);
});
