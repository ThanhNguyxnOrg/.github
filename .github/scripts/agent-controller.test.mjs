import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPullRequestLabels,
  analyzeDependencyUpdate,
  assessPullRequestRisk,
  classifyVersionUpdate,
  evaluateCheckRollup,
  pullRequestCheckSha
} from './agent-controller.mjs';

test('dependency labels remain semantic; the Agent separately decides whether to auto-merge', () => {
  const labels = classifyPullRequestLabels(
    { title: 'Bump lodash from 4.17.20 to 4.17.21', user: { login: 'dependabot[bot]' } },
    ['package.json', 'package-lock.json']
  );
  assert.ok(labels.includes('automated'));
  assert.ok(labels.includes('dependencies'));
  assert.ok(labels.includes('maintenance'));
  assert.ok(!labels.includes('needs-review'));
});

test('major and downgrade dependency updates receive the major-update label', () => {
  const major = classifyPullRequestLabels(
    { title: 'Bump package from 1.4.0 to 2.0.0', user: { login: 'dependabot[bot]' } },
    ['package.json']
  );
  const downgrade = classifyPullRequestLabels(
    { title: 'Bump package from 2.0.0 to 1.9.0', user: { login: 'renovate[bot]' } },
    ['package.json']
  );
  assert.ok(major.includes('major-update'));
  assert.ok(downgrade.includes('major-update'));
});

test('PR title and changed files produce useful type and area labels', () => {
  const labels = classifyPullRequestLabels(
    { title: 'feat(editor): add keyboard shortcuts', user: { login: 'contributor' } },
    ['src/components/Editor.tsx', 'tests/editor.test.ts']
  );
  assert.ok(labels.includes('enhancement'));
  assert.ok(labels.includes('frontend'));
  assert.ok(labels.includes('tests'));
  assert.ok(!labels.includes('triage-needed'));
});

test('security and workflow changes are explicitly classified', () => {
  const labels = classifyPullRequestLabels(
    { title: 'fix: patch CVE-2026-12345', body: 'Resolves a dependency vulnerability.', user: { login: 'contributor' } },
    ['.github/workflows/ci.yml']
  );
  assert.ok(labels.includes('security'));
  assert.ok(labels.includes('workflow-update'));
  assert.ok(labels.includes('bug'));
});

test('unclassified PRs receive the triage-needed label', () => {
  const labels = classifyPullRequestLabels(
    { title: 'Update project files', user: { login: 'contributor' } },
    ['misc/data.bin']
  );
  assert.ok(labels.includes('triage-needed'));
});

test('dependency update classification remains SemVer-aware across grouped summaries', () => {
  assert.equal(classifyVersionUpdate('Bump foo from 1.2.3 to 1.2.4'), 'patch');
  assert.equal(classifyVersionUpdate('Bump foo from 1.2.3 to 1.4.0'), 'minor');
  assert.equal(classifyVersionUpdate('Bump foo from 1.2.3 to 2.0.0'), 'major');
  assert.equal(classifyVersionUpdate('Bump actions/checkout from 4 to 5'), 'major');
  assert.equal(classifyVersionUpdate('Updates foo from 1.2.3 to 1.2.4\nUpdates bar from 0.9.1 to 0.10.0'), 'major');
  assert.equal(classifyVersionUpdate('| Package | From | To |\n| [foo](https://example.com) | \x601.0.0\x60 | \x602.0.0\x60 |'), 'major');
  assert.equal(classifyVersionUpdate('| Package | From | To |\n| foo | \x602.0.0\x60 | \x601.9.0\x60 |'), 'downgrade');
  assert.equal(classifyVersionUpdate('Update dependencies'), 'unknown');
});
test('grouped Dependabot summaries classify documented breaking changes', () => {
  const labels = classifyPullRequestLabels(
    {
      title: 'build(deps): bump the rust-dependencies group in /src-tauri with 3 updates',
      body: 'Updates uuid from 1.29.0 to 1.29.1\nUpdates mft from 0.9.1 to 0.10.0\n<li><strong>Breaking:</strong> mft no longer depends on winstructs.</li>',
      user: { login: 'dependabot[bot]' }
    },
    ['src-tauri/Cargo.lock', 'src-tauri/Cargo.toml']
  );
  assert.ok(labels.includes('automated'));
  assert.ok(labels.includes('dependencies'));
  assert.ok(labels.includes('backend'));
  assert.ok(labels.includes('maintenance'));
  assert.ok(labels.includes('breaking'));
  assert.ok(!labels.includes('triage-needed'));
});

test('check rollup requires evidence and rejects failed or incomplete checks', () => {
  assert.equal(evaluateCheckRollup([], {}, ['tests']), 'missing');
  assert.equal(evaluateCheckRollup([{ name: 'tests', status: 'in_progress' }], {}, ['tests']), 'pending');
  assert.equal(evaluateCheckRollup([{ name: 'tests', status: 'completed', conclusion: 'failure' }], {}, ['tests']), 'failure');
  assert.equal(evaluateCheckRollup([{ name: 'tests', status: 'completed', conclusion: 'success' }], {}, ['tests']), 'success');
  assert.equal(evaluateCheckRollup([], {}, []), 'unconfigured');
});

test('PR checks prefer the head SHA and fall back to the synthetic merge SHA', () => {
  const headSha = 'b'.repeat(40);
  const mergeSha = 'a'.repeat(40);
  assert.equal(pullRequestCheckSha({ head: { sha: headSha }, merge_commit_sha: mergeSha }), headSha);
  assert.equal(pullRequestCheckSha({ head: { sha: 'invalid' }, merge_commit_sha: mergeSha }), mergeSha);
  assert.equal(pullRequestCheckSha({ merge_commit_sha: null }), null);
  assert.equal(pullRequestCheckSha({ merge_commit_sha: 'invalid' }), null);
});

test('breaking changes later in long Dependabot release-note bodies are not truncated', () => {
  const longBody = 'Release notes\\n'.repeat(700) + '<li><strong>Breaking:</strong> API types changed.</li>';
  const labels = classifyPullRequestLabels(
    { title: 'build(deps): bump grouped dependencies', body: longBody, user: { login: 'dependabot[bot]' } },
    ['Cargo.lock']
  );
  assert.ok(labels.includes('breaking'));
});


test('low-risk Dependabot patch updates are eligible with manifest and lockfile changes only', () => {
  const result = analyzeDependencyUpdate(
    {
      title: 'Bump lodash from 4.17.20 to 4.17.21',
      body: 'Updates lodash from 4.17.20 to 4.17.21',
      user: { login: 'dependabot[bot]' }
    },
    ['package.json', 'package-lock.json']
  );
  assert.equal(result.eligible, true);
  assert.equal(result.versionRisk, 'patch');
  assert.deepEqual(result.reasons, []);
});

test('stable SemVer minor updates can be automated when release notes show no API risk', () => {
  const result = analyzeDependencyUpdate(
    {
      title: 'build(deps): bump frontend dependencies',
      body: '| Package | From | To |\n| --- | --- | --- |\n| [foo](https://example.com) | \`1.2.3\` | \`1.3.0\` |',
      user: { login: 'dependabot[bot]' }
    },
    ['package.json', 'package-lock.json']
  );
  assert.equal(result.eligible, true);
  assert.equal(result.versionRisk, 'minor');
});

test('pre-1.0 minor updates are treated as potentially breaking', () => {
  const result = analyzeDependencyUpdate(
    {
      title: 'Bump mft from 0.9.1 to 0.10.0',
      body: 'Updates mft from 0.9.1 to 0.10.0',
      user: { login: 'dependabot[bot]' }
    },
    ['Cargo.toml', 'Cargo.lock']
  );
  assert.equal(result.eligible, false);
  assert.equal(result.versionRisk, 'major');
});

test('breaking release notes and public API renames require human review', () => {
  const breaking = analyzeDependencyUpdate(
    {
      title: 'Bump mft from 0.9.1 to 0.10.0',
      body: '<li><strong>Breaking:</strong> MftRecord changed.</li>',
      user: { login: 'dependabot[bot]' }
    },
    ['Cargo.toml', 'Cargo.lock']
  );
  const renamed = analyzeDependencyUpdate(
    {
      title: 'build(deps): bump frontend group',
      body: 'Updates @lucide/svelte from 1.66.0 to 1.70.0\n<details><summary>Release notes</summary>Renamed *-warning and *-alert to *-exclamation-point.</details>',
      user: { login: 'dependabot[bot]' }
    },
    ['package-lock.json']
  );
  assert.equal(breaking.eligible, false);
  assert.ok(breaking.reasons.includes('breaking-release-notes'));
  assert.equal(renamed.eligible, false);
  assert.ok(renamed.reasons.includes('breaking-release-notes'));
});

test('Dependabot changes to workflows or application source are never auto-merged', () => {
  const workflow = analyzeDependencyUpdate(
    { title: 'Bump actions/checkout from 4 to 5', body: 'Updates actions/checkout from 4 to 5', user: { login: 'dependabot[bot]' } },
    ['.github/workflows/ci.yml']
  );
  const source = analyzeDependencyUpdate(
    { title: 'Bump lodash from 4.17.20 to 4.17.21', body: 'Updates lodash from 4.17.20 to 4.17.21', user: { login: 'dependabot[bot]' } },
    ['package-lock.json', 'src/main.ts']
  );
  assert.equal(workflow.eligible, false);
  assert.equal(source.eligible, false);
  assert.ok(workflow.reasons.includes('non-dependency-files'));
  assert.ok(source.reasons.includes('non-dependency-files'));
});

test('unknown-version and security updates fail closed', () => {
  const unknown = analyzeDependencyUpdate(
    { title: 'Update dependencies', body: 'Dependency update', user: { login: 'dependabot[bot]' } },
    ['Cargo.lock']
  );
  const security = analyzeDependencyUpdate(
    { title: 'Bump openssl to fix CVE-2026-12345', body: 'Security update for CVE-2026-12345', user: { login: 'dependabot[bot]' } },
    ['Cargo.toml', 'Cargo.lock']
  );
  assert.equal(unknown.eligible, false);
  assert.ok(unknown.reasons.includes('version-risk-unknown'));
  assert.equal(security.eligible, false);
  assert.ok(security.reasons.includes('security-update'));
});

test('risk assessment escalates workflow and configured sensitive paths, not routine feature work', () => {
  const ordinary = assessPullRequestRisk(
    { title: 'feat: add compact mode', user: { login: 'contributor' } },
    ['src/components/Panel.svelte']
  );
  const risky = assessPullRequestRisk(
    { title: 'chore: update workflow permissions', user: { login: 'contributor' } },
    ['.github/workflows/release.yml']
  );
  const sensitive = assessPullRequestRisk(
    { title: 'refactor: update app startup', user: { login: 'contributor' } },
    ['main/index.ts'],
    { sensitivePaths: ['main/**'] }
  );
  assert.equal(ordinary.requiresHumanReview, false);
  assert.equal(risky.requiresHumanReview, true);
  assert.ok(risky.reasons.includes('workflow-update'));
  assert.equal(sensitive.requiresHumanReview, true);
  assert.ok(sensitive.reasons.includes('sensitive-path'));
});
