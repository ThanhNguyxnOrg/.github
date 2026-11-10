import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bumpSemver, classifyConventionalCommit, highestReleaseLevel, insertChangelogSection, applyVersionFile, releaseNotesFromChangelog, pendingDraftReleases, missingRequiredAssets, planOrphanAssetRecovery, changedFilesForPolicy } from './release-controller.mjs';

const policy = JSON.parse(fs.readFileSync(new URL('../../release-policy.json', import.meta.url), 'utf8'));

test('Conventional Commit types map to the configured SemVer levels', () => {
  assert.equal(classifyConventionalCommit('feat(ui): add palette switch').level, 'minor');
  assert.equal(classifyConventionalCommit('fix: guard empty file').level, 'patch');
  assert.equal(classifyConventionalCommit('feat!: remove legacy config').level, 'major');
  assert.equal(classifyConventionalCommit('refactor: simplify module'), null);
  assert.equal(classifyConventionalCommit('chore: update docs'), null);
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
    'git-account-switcher/bin/git-account-switcher': 'SCRIPT_VERSION="1.0.0"\n',
    'git-account-switcher/bin/git-account-switcher.ps1': '$SCRIPT_VERSION = "1.0.0"\n'
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
