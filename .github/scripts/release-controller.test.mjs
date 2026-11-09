import test from 'node:test';
import assert from 'node:assert/strict';
import { bumpSemver, classifyConventionalCommit, highestReleaseLevel, insertChangelogSection } from './release-controller.mjs';

test('Conventional Commit types map to the configured SemVer levels', () => {
  assert.equal(classifyConventionalCommit('feat(ui): add palette switch').level, 'minor');
  assert.equal(classifyConventionalCommit('fix: guard empty file').level, 'patch');
  assert.equal(classifyConventionalCommit('feat!: remove legacy config').level, 'major');
  assert.equal(classifyConventionalCommit('refactor: simplify module'), null);
  assert.equal(classifyConventionalCommit('chore: update docs'), null);
  assert.equal(classifyConventionalCommit('feat: change auth\n\nBREAKING CHANGE: old tokens are rejected').level, 'major');
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
