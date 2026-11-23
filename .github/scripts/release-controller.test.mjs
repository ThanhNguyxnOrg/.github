import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bumpSemver, classifyConventionalCommit, highestReleaseLevel, insertChangelogSection, applyVersionFile, releaseNotesFromChangelog, releaseBodyFromChangelog, pendingDraftReleases, missingRequiredAssets, planOrphanAssetRecovery, changedFilesForPolicy, releaseMatchesTag, selectReleaseByTag, selectOrphanDraftForTag } from './release-controller.mjs';
import { createCommit, shouldReprepareRelease, releaseIntent, releasePrMarker, parseReleasePrMarker, keepReleaseCommit, releasePrDeclined, ensureReleasePr, cleanupReleaseBranch, RELEASE_BRANCH } from './release-controller.mjs';

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
  assert.equal(keepReleaseCommit(commit, 'head', 'release: v1.2.0'), true);
  assert.equal(keepReleaseCommit(commit, 'new-head', 'release: v1.2.0'), false);
  assert.equal(keepReleaseCommit(commit, 'head', 'release: v1.3.0'), false);
  for (const parents of [[], [{ sha: 'head' }, { sha: 'other' }]]) {
    assert.equal(keepReleaseCommit({ ...commit, parents }, 'head', 'release: v1.2.0'), false);
  }
  assert.equal(keepReleaseCommit(undefined, 'head', 'release: v1.2.0'), false);
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
  let branchCommit = { message: 'release: v1.2.0', parents: [{ sha: head }] };
  const build = test.mock.fn();
  const updates = [];
  const request = async (path, options) => {
    if (path.includes('state=open')) return [pr];
    if (path.includes('/git/ref/')) return { object: { sha: 'release-head' } };
    if (path.includes('/git/commits/')) return branchCommit;
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
