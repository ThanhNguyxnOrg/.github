import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPullRequestLabels,
  analyzeDependencyUpdate,
  assessPullRequestRisk,
  classifyVersionUpdate,
  isTransientAutoMergeError,
  evaluateCheckRollup,
  isDependencyManifestPath,
  pullRequestCheckSha,
  resolvePullRequestEvent,
  matchesPullRequestEvent
} from './agent-controller.mjs';

test('dependency labels stay descriptive and do not themselves force review', () => {
  const labels = classifyPullRequestLabels(
    { title: 'Bump lodash from 4.17.20 to 4.17.21', user: { login: 'dependabot[bot]' } },
    ['package.json', 'package-lock.json']
  );
  assert.ok(labels.includes('automated'));
  assert.ok(labels.includes('dependencies'));
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

test('Dependabot compatibility-score URLs do not create false security risk', () => {
  const pr = {
    title: 'chore(deps): bump dotenv from 18.0.9 to 18.0.10',
    body: '[Dependabot compatibility score](https://docs.github.com/en/github/managing-security-vulnerabilities/about-security-updates)',
    user: { login: 'dependabot[bot]' }
  };
  const labels = classifyPullRequestLabels(pr, ['package.json', 'package-lock.json']);
  const risk = assessPullRequestRisk(pr, ['package.json', 'package-lock.json']);
  assert.ok(!labels.includes('security'));
  assert.equal(risk.requiresHumanReview, false);
  assert.equal(risk.dependency.versionRisk, 'patch');
  assert.deepEqual(risk.dependency.reasons, []);
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
  assert.equal(classifyVersionUpdate('chore(deps): update platformdirs requirement from >=4.3.0 to >=4.12.4'), 'minor');
  assert.equal(classifyVersionUpdate('chore(deps): update numpy requirement from >=2.0.0 to >=2.2.6'), 'minor');
  assert.equal(classifyVersionUpdate('chore(deps): update pymupdf requirement from >=1.25.0 to >=1.28.2'), 'minor');
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

test('GitHub transient unstable merge state waits instead of blocking Auto-merge', () => {
  assert.equal(isTransientAutoMergeError(new Error('Pull request is in unstable status')), true);
  assert.equal(isTransientAutoMergeError('Pull request Pull request is in unstable status'), true);
  assert.equal(isTransientAutoMergeError(new Error('Validation failed: required status check failed')), false);
  assert.equal(isTransientAutoMergeError(new Error('Auto-merge is disabled for this repository')), false);
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


test('PEP 440 lower-bound updates are eligible when they are same-major patch/minor manifest changes', () => {
  for (const update of [
    'chore(deps): update platformdirs requirement from >=4.3.0 to >=4.12.4',
    'chore(deps): update numpy requirement from >=2.0.0 to >=2.2.6',
    'chore(deps): update pymupdf requirement from >=1.25.0 to >=1.28.2'
  ]) {
    const result = analyzeDependencyUpdate(
      { title: update, body: update, user: { login: 'dependabot[bot]' } },
      ['pyproject.toml', 'requirements.txt']
    );
    assert.equal(result.eligible, true, update);
    assert.equal(result.versionRisk, 'minor', update);
  }
});

test('safe Dependabot patch and stable minor lockfile updates pass the low-risk gate', () => {
  const patch = analyzeDependencyUpdate(
    { title: 'Bump lodash from 4.17.20 to 4.17.21', body: 'Updates lodash from 4.17.20 to 4.17.21', user: { login: 'dependabot[bot]' } },
    ['package.json', 'package-lock.json']
  );
  const minor = analyzeDependencyUpdate(
    {
      title: 'build(deps): bump frontend group with 8 updates',
      body: '| Package | From | To |\n| --- | --- | --- |\n| [@lucide/svelte](https://github.com/lucide-icons/lucide) | \`1.66.0\` | \`1.70.0\` |\n| vite | \`8.3.5\` | \`8.3.6\` |\n\nUpdates @lucide/svelte from 1.66.0 to 1.70.0\n<details><summary>Release notes</summary>Renamed *-warning and *-alert to *-exclamation-point.</details>',
      user: { login: 'dependabot[bot]' }
    },
    ['package-lock.json']
  );
  assert.equal(patch.eligible, true);
  assert.equal(patch.versionRisk, 'patch');
  assert.equal(minor.eligible, true);
  assert.equal(minor.versionRisk, 'minor');
});

test('pre-1.0 minor, major, downgrade and unknown dependency updates require human review', () => {
  for (const update of [
    'Bump mft from 0.9.1 to 0.10.0',
    'Bump framework from 1.2.0 to 2.0.0',
    'Bump framework from 2.0.0 to 1.9.0',
    'Update dependencies'
  ]) {
    const result = analyzeDependencyUpdate(
      { title: update, body: update, user: { login: 'dependabot[bot]' } },
      ['Cargo.toml', 'Cargo.lock']
    );
    assert.equal(result.eligible, false, update);
  }
});

test('security, explicit breaking changes, workflow and source changes require review', () => {
  const security = analyzeDependencyUpdate(
    { title: 'Bump openssl to fix CVE-2026-12345', body: 'Security update for CVE-2026-12345', user: { login: 'dependabot[bot]' } },
    ['Cargo.toml', 'Cargo.lock']
  );
  const breaking = analyzeDependencyUpdate(
    { title: 'Bump mft from 1.2.0 to 1.3.0', body: '<strong>Breaking:</strong> API changed.', user: { login: 'dependabot[bot]' } },
    ['Cargo.toml', 'Cargo.lock']
  );
  const workflow = analyzeDependencyUpdate(
    { title: 'Bump actions/checkout from 4 to 5', body: 'Updates actions/checkout from 4 to 5', user: { login: 'dependabot[bot]' } },
    ['.github/workflows/ci.yml']
  );
  const source = analyzeDependencyUpdate(
    { title: 'Bump lodash from 4.17.20 to 4.17.21', body: 'Updates lodash from 4.17.20 to 4.17.21', user: { login: 'dependabot[bot]' } },
    ['package-lock.json', 'src/main.ts']
  );
  assert.equal(security.eligible, false);
  assert.equal(breaking.eligible, false);
  assert.equal(workflow.eligible, false);
  assert.equal(source.eligible, false);
});

test('risk assessment does not request human review for ordinary frontend work', () => {
  const risk = assessPullRequestRisk(
    { title: 'feat: add compact mode', user: { login: 'contributor' } },
    ['src/components/Panel.svelte']
  );
  assert.equal(risk.requiresHumanReview, false);
});

test('risk assessment routes security, workflow, breaking and sensitive-path changes to humans', () => {
  const security = assessPullRequestRisk(
    { title: 'fix: patch CVE-2026-12345', body: 'Vulnerability mitigation', user: { login: 'contributor' } },
    ['src/security.ts']
  );
  const workflow = assessPullRequestRisk(
    { title: 'chore: update workflow permissions', user: { login: 'contributor' } },
    ['.github/workflows/release.yml']
  );
  const sensitive = assessPullRequestRisk(
    { title: 'refactor: update application bootstrap', user: { login: 'contributor' } },
    ['main/index.ts'],
    { sensitivePaths: ['main/**'] }
  );
  assert.equal(security.requiresHumanReview, true);
  assert.equal(workflow.requiresHumanReview, true);
  assert.equal(sensitive.requiresHumanReview, true);
});

test('dependency manifest detection excludes runtime source and GitHub workflows', () => {
  assert.equal(isDependencyManifestPath('package-lock.json'), true);
  assert.equal(isDependencyManifestPath('src-tauri/Cargo.toml'), true);
  assert.equal(isDependencyManifestPath('.github/workflows/ci.yml'), false);
  assert.equal(isDependencyManifestPath('src/main.ts'), false);
});


test('event targets require a valid organization PR number and recorded head SHA', () => {
  assert.deepEqual(
    resolvePullRequestEvent('ThanhNguyxnOrg/blendops', '8', 'ThanhNguyxnOrg', 'a'.repeat(40), 'dependabot/deps-bump-zod'),
    {
      fullName: 'ThanhNguyxnOrg/blendops',
      number: 8,
      owner: 'ThanhNguyxnOrg',
      name: 'blendops',
      headSha: 'a'.repeat(40),
      headRepository: 'dependabot/deps-bump-zod'
    }
  );
  assert.throws(() => resolvePullRequestEvent('someone-else/repo', '8', 'ThanhNguyxnOrg', 'a'.repeat(40)), /outside the configured organization/);
  assert.throws(() => resolvePullRequestEvent('ThanhNguyxnOrg/repo/extra', '8', 'ThanhNguyxnOrg', 'a'.repeat(40)), /owner\/repository pair/);
  assert.throws(() => resolvePullRequestEvent('ThanhNguyxnOrg/repo', '0', 'ThanhNguyxnOrg', 'a'.repeat(40)), /positive integer/);
  assert.throws(() => resolvePullRequestEvent('ThanhNguyxnOrg/repo', '8.5', 'ThanhNguyxnOrg', 'a'.repeat(40)), /positive integer/);
  assert.throws(() => resolvePullRequestEvent('ThanhNguyxnOrg/repo', '8', 'ThanhNguyxnOrg'), /40-character hexadecimal head SHA/);
  assert.throws(() => resolvePullRequestEvent('ThanhNguyxnOrg/repo', '8', 'ThanhNguyxnOrg', 'not-a-sha'), /40-character hexadecimal head SHA/);
  assert.throws(() => resolvePullRequestEvent('ThanhNguyxnOrg/repo', '8', 'ThanhNguyxnOrg', 'a'.repeat(40), 'bad/name/with/slashes'), /must be an owner\/repository pair/);
});

test('event routing skips closed PRs and stale or mismatched head metadata', () => {
  const target = resolvePullRequestEvent(
    'ThanhNguyxnOrg/blendops',
    '8',
    'ThanhNguyxnOrg',
    'a'.repeat(40),
    'dependabot/deps-bump-zod'
  );
  const current = {
    state: 'open',
    head: { sha: 'a'.repeat(40), repo: { full_name: 'dependabot/deps-bump-zod' } }
  };
  assert.equal(matchesPullRequestEvent(current, target), true);
  assert.equal(matchesPullRequestEvent({ ...current, state: 'closed' }, target), false);
  assert.equal(matchesPullRequestEvent({ ...current, head: { ...current.head, sha: 'b'.repeat(40) } }, target), false);
  assert.equal(matchesPullRequestEvent({ ...current, head: { ...current.head, repo: { full_name: 'attacker/other-repo' } } }, target), false);
  assert.equal(matchesPullRequestEvent({ state: 'open', head: { sha: 'a'.repeat(40), repo: null } }, target), false);
});
