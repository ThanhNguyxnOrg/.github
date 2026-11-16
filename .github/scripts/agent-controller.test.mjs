import test from 'node:test';
import assert from 'node:assert/strict';
import { getRepositoryProfile } from './check-policy.mjs';
import {
  classifyPullRequestLabels,
  analyzeDependencyUpdate,
  assessPullRequestRisk,
  assessReviewFeedback,
  classifyVersionUpdate,
  requiredCheckReviewReason,
  isAutoMergeCheckReady,
  domainVerificationState,
  isPolicyAutoMergeCandidate,
  reconcilePolicyTriageReason,
  expandChangedFilePaths,
  getBlockingPullRequestLabels,
  shouldDisableAutoMergeForDeferredState,
  shouldDisableAutoMergeForKnownReviewHold,
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

test('explicit breaking changes in human PR titles or bodies require the breaking label', () => {
  const base = { user: { login: 'contributor' } };
  assert.ok(classifyPullRequestLabels({
    ...base,
    title: 'feat: change skill inputs',
    body: 'BREAKING CHANGE: rename required inputs'
  }, ['skills/new-skill.md']).includes('breaking'));
  assert.ok(classifyPullRequestLabels({
    ...base,
    title: 'feat!: change skill inputs',
    body: 'This updates the contribution format.'
  }, ['skills/new-skill.md']).includes('breaking'));
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

test('Dependabot release-note history does not create false security or breaking holds', () => {
  const pr = {
    title: 'chore(deps): bump source-map-js from 1.2.1 to 1.2.2',
    body: [
      'Bumps source-map-js from 1.2.1 to 1.2.2.',
      '<details>',
      '<summary>Release notes</summary>',
      'This historical release text mentions security fixes, vulnerabilities, CVE-2026-93749, and breaking changes.',
      '</details>'
    ].join('\n'),
    user: { login: 'dependabot[bot]' }
  };
  const files = ['package.json', 'package-lock.json'];
  const labels = classifyPullRequestLabels(pr, files);
  const risk = assessPullRequestRisk(pr, files);
  const dependency = analyzeDependencyUpdate(pr, files);

  assert.ok(!labels.includes('security'));
  assert.ok(!labels.includes('breaking'));
  assert.equal(risk.requiresHumanReview, false);
  assert.equal(dependency.eligible, true);
  assert.deepEqual(dependency.reasons, []);
});

test('explicit security and breaking signals in the Dependabot summary still require review', () => {
  const security = {
    title: 'Bump openssl to fix CVE-2026-12345',
    body: 'Security update for CVE-2026-12345.<details><summary>Release notes</summary>History.</details>',
    user: { login: 'dependabot[bot]' }
  };
  const breaking = {
    title: 'Bump framework from 1.2.0 to 1.3.0',
    body: 'Breaking: this update changes the public API.<details><summary>Release notes</summary>History.</details>',
    user: { login: 'dependabot[bot]' }
  };

  assert.ok(classifyPullRequestLabels(security, ['package.json']).includes('security'));
  assert.ok(classifyPullRequestLabels(breaking, ['package.json']).includes('breaking'));
  assert.ok(assessPullRequestRisk(security, ['package.json']).requiresHumanReview);
  assert.ok(assessPullRequestRisk(breaking, ['package.json']).requiresHumanReview);
});

test('unresolved review threads and changes-requested reviews keep PRs in human review', () => {
  const unresolved = assessReviewFeedback(
    [{ state: 'COMMENTED' }],
    [{ isResolved: false }, { isResolved: true }]
  );
  const changesRequested = assessReviewFeedback(
    [{ user: { login: 'reviewer' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-11-14T10:00:00Z' }],
    [{ isResolved: true }]
  );
  const supersededRequest = assessReviewFeedback(
    [
      { user: { login: 'reviewer' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-11-14T10:00:00Z' },
      { user: { login: 'reviewer' }, state: 'APPROVED', submitted_at: '2026-11-14T11:00:00Z' }
    ],
    [{ isResolved: true }]
  );
  const clean = assessReviewFeedback(
    [{ state: 'APPROVED' }],
    [{ isResolved: true }]
  );

  assert.equal(unresolved.requiresHumanReview, true);
  assert.ok(unresolved.reasons.includes('unresolved-review-threads'));
  assert.equal(unresolved.unresolvedThreads, 1);
  assert.equal(changesRequested.requiresHumanReview, true);
  assert.ok(changesRequested.reasons.includes('changes-requested'));
  assert.equal(supersededRequest.requiresHumanReview, false);
  assert.equal(clean.requiresHumanReview, false);
  assert.deepEqual(clean.reasons, []);
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
  assert.equal(
    classifyVersionUpdate('chore(deps-dev): update ruff requirement from <1.0,>=0.17.4 to >=0.17.5,<1.0 in /requirements'),
    'patch'
  );
  assert.equal(
    classifyVersionUpdate('Bump package requirement from >=1.2.0,<2.0.0 to >=1.2.1,<3.0.0'),
    'unknown',
    'changing more than one constraint bound must not be treated as a patch'
  );
  assert.equal(
    classifyVersionUpdate('Bump package requirement from >=1.2.0,<2.0.0 to >=1.2.1,<2.0.0'),
    'patch',
    'a single lower-bound update with an unchanged upper bound can be classified'
  );
  assert.equal(
    classifyVersionUpdate('deps(cargo): bump toml from 1.2.0+spec-1.1.0 to 1.2.1+spec-1.1.0 in /src-tauri'),
    'patch'
  );
  assert.equal(
    classifyVersionUpdate('Bump Python package from 1.2.0+local.1 to 1.2.1+local.1'),
    'unknown',
    'PEP 440 local versions must not be treated as Cargo build metadata'
  );
  assert.equal(
    classifyVersionUpdate('Bump Python package from 1!9.0 to 1.1.0'),
    'unknown',
    'PEP 440 epoch prefixes must not be partially parsed as ordinary releases'
  );
  assert.equal(
    classifyVersionUpdate('Bump foo from 1.2.* to 1.3.*'),
    'unknown',
    'npm X-ranges must not be normalized into ordinary version numbers'
  );
  assert.equal(
    classifyVersionUpdate('Bump foo from 1.2.* to 1.3.*.'),
    'unknown',
    'trailing prose punctuation must not hide a wildcard range'
  );
  assert.equal(
    classifyVersionUpdate('Bump foo requirement from 1.2.*,>=*1.2.3* to 1.3.*,>=*1.2.4*'),
    'unknown',
    'a wildcard in one comparator must not pair with Markdown emphasis in another'
  );
  assert.equal(
    classifyVersionUpdate('Bump foo from *1.2.3* to *1.2.4*'),
    'patch',
    'paired Markdown emphasis around concrete versions remains supported'
  );
  assert.equal(
    classifyVersionUpdate('Bump foo from *1.2.3* to *1.2.4*.'),
    'patch',
    'trailing sentence punctuation after Markdown emphasis remains supported'
  );
  const unsafeWildcardRange = analyzeDependencyUpdate(
    {
      title: 'chore(deps): bump foo from 1.2.* to 1.3.*',
      body: 'Bumps foo from 1.2.* to 1.3.*',
      user: { login: 'dependabot[bot]' }
    },
    ['package.json']
  );
  assert.equal(unsafeWildcardRange.eligible, false);
  assert.equal(unsafeWildcardRange.versionRisk, 'unknown');
  assert.equal(
    classifyVersionUpdate('Updates foo from 1.2.3 to 1.2.4\n\n| bar | 1.2.* | 2.0.* |'),
    'unknown',
    'wildcard-only headerless table rows must not be ignored behind a safe prose patch'
  );
  const unsafeMixedWildcardGroup = analyzeDependencyUpdate(
    {
      title: 'chore(deps): bump grouped dependencies with 2 updates',
      body: 'Updates foo from 1.2.3 to 1.2.4\n\n| bar | 1.2.* | 2.0.* |',
      user: { login: 'dependabot[bot]' }
    },
    ['package.json']
  );
  assert.equal(unsafeMixedWildcardGroup.eligible, false);
  assert.equal(unsafeMixedWildcardGroup.versionRisk, 'unknown');
  assert.equal(
    classifyVersionUpdate('Updates foo from 1.2.3 to 1.2.4\n\n| bar | 1.x | 2.x |'),
    'unknown',
    'npm x-ranges in a headerless table must not be ignored behind a safe prose patch'
  );
  assert.equal(
    classifyVersionUpdate('Updates foo from 1.2.3 to 1.2.4\n\n| bar | _1.2.*_ | _2.0.*_ |'),
    'unknown',
    'Markdown-emphasized npm wildcard endpoints must remain fail-closed'
  );
  assert.equal(
    classifyVersionUpdate('Updates foo from 1.2.3 to 1.2.4\n\n| bar | =1.x | =2.x |'),
    'unknown',
    'equality-prefixed npm X-ranges in grouped tables must fail closed'
  );
  const unsafeXRangeGroup = analyzeDependencyUpdate(
    {
      title: 'chore(deps): bump grouped dependencies with 2 updates',
      body: 'Updates foo from 1.2.3 to 1.2.4\n\n| bar | 1.x | 2.x |',
      user: { login: 'dependabot[bot]' }
    },
    ['package.json']
  );
  assert.equal(unsafeXRangeGroup.eligible, false);
  assert.equal(unsafeXRangeGroup.versionRisk, 'unknown');
  assert.equal(
    classifyVersionUpdate('Updates foo from 1.2.3 to 1.2.4\n\n| bar | >=1.0,==1.2.* | >=1.0,==2.0.* |'),
    'unknown',
    'wildcard components inside compound constraints must prevent table skipping'
  );
  assert.equal(
    classifyVersionUpdate('Updates foo from 1.2.3 to 1.2.4\n\n| bar | >=1.0,==_1.2.*_ | >=1.0,==_2.0.*_ |'),
    'unknown',
    'emphasized wildcard components inside compound constraints must fail closed'
  );
  assert.equal(
    classifyVersionUpdate('Updates foo from 1.2.3 to 1.2.4\n\n| bar | >=1.0,==**1.2.*** | >=1.0,==**2.0.*** |'),
    'unknown',
    'asterisk-emphasized wildcard components inside compound constraints must fail closed'
  );
  const unsafeCompoundWildcardGroup = analyzeDependencyUpdate(
    {
      title: 'chore(deps): bump grouped dependencies with 2 updates',
      body: 'Updates foo from 1.2.3 to 1.2.4\n\n| bar | >=1.0,==1.2.* | >=1.0,==2.0.* |',
      user: { login: 'dependabot[bot]' }
    },
    ['requirements.txt']
  );
  assert.equal(unsafeCompoundWildcardGroup.eligible, false);
  assert.equal(unsafeCompoundWildcardGroup.versionRisk, 'unknown');
  assert.equal(
    classifyVersionUpdate('Updates foo from 1.2.3 to 1.2.4\n\n| bar | 1.x.x | 2.x.x |'),
    'unknown',
    'multiple npm x-range components must not be ignored beside a safe prose patch'
  );
  assert.equal(
    classifyVersionUpdate('Updates foo from 1.2.3 to 1.2.4\n\n| bar | 1.*.* | 2.*.* |'),
    'unknown',
    'multiple npm wildcard components must remain fail-closed'
  );
  assert.equal(
    classifyVersionUpdate('Updates foo from 1.2.3 to 1.2.4\n\n| bar | *1.x.x* | *2.x.x* |'),
    'unknown',
    'single-asterisk Markdown emphasis around repeated x-ranges must remain fail-closed'
  );
  const unsafeMultiWildcardGroup = analyzeDependencyUpdate(
    {
      title: 'chore(deps): bump grouped dependencies with 2 updates',
      body: 'Updates foo from 1.2.3 to 1.2.4\n\n| bar | 1.x.x | 2.x.x |',
      user: { login: 'dependabot[bot]' }
    },
    ['package.json']
  );
  assert.equal(unsafeMultiWildcardGroup.eligible, false);
  assert.equal(unsafeMultiWildcardGroup.versionRisk, 'unknown');
  assert.equal(
    classifyVersionUpdate('Bump foo requirement from ^1.0.0 >=1.2.0 to ^2.0.0 >=1.2.1'),
    'unknown',
    'unsupported npm range operators must not be discarded during extraction'
  );
  assert.equal(
    classifyVersionUpdate('Updates foo from 1.2.3 to 1.2.4\nUpdates bar from 1.0.0 to 2.0.0 || 3.0.0'),
    'unknown',
    'npm range alternatives in prose must not be removed as Markdown table syntax'
  );
  const unsafeNpmRange = analyzeDependencyUpdate(
    {
      title: 'chore(deps): update foo requirement',
      body: 'Updates foo requirement from ^1.0.0 >=1.2.0 to ^2.0.0 >=1.2.1',
      user: { login: 'dependabot[bot]' }
    },
    ['package.json']
  );
  assert.equal(unsafeNpmRange.eligible, false);
  assert.equal(unsafeNpmRange.versionRisk, 'unknown');
  assert.equal(
    classifyVersionUpdate('| foo | 1.2.3 | 1.2.4 |\n| bar | unknown | latest |'),
    'unknown',
    'unparseable rows in a grouped version table must not be dropped'
  );
  assert.equal(
    classifyVersionUpdate('| foo | unknown | latest |\n| bar | 1.2.3 | 1.2.4 |'),
    'unknown',
    'an unparseable first row in a headerless grouped version table must fail closed'
  );
  const unsafeHeaderlessGroup = analyzeDependencyUpdate(
    {
      title: 'build(deps): bump grouped group with 2 updates',
      body: '| foo | unknown | latest |\n| bar | 1.2.3 | 1.2.4 |',
      user: { login: 'dependabot[bot]' }
    },
    ['package-lock.json']
  );
  assert.equal(unsafeHeaderlessGroup.eligible, false);
  assert.equal(unsafeHeaderlessGroup.versionRisk, 'unknown');
  assert.equal(
    classifyVersionUpdate('Bump package from 1.2.3-rc.1 to 1.2.3'),
    'unknown',
    'prerelease transitions must fail closed until their ecosystem-specific ordering is parsed'
  );
  assert.equal(classifyVersionUpdate('Bump golang.org/x/crypto from 0.58.0 to 0.59.0'), 'major');
  assert.equal(
    classifyVersionUpdate('Bump foo from 1.2.3 to 1.2.4\nBump bar from 2.0.0 to latest'),
    'unknown',
    'unparseable members of a grouped update must fail closed'
  );
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
  assert.equal(isTransientAutoMergeError(new Error('Merge already in progress')), true);
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

test('required check failures, missing gates and non-applicable profiles route to human review', () => {
  assert.equal(requiredCheckReviewReason('failure'), 'required-checks-failure');
  assert.equal(requiredCheckReviewReason('missing'), 'required-checks-missing');
  assert.equal(requiredCheckReviewReason('unconfigured'), 'required-checks-unconfigured');
  assert.equal(requiredCheckReviewReason('not-applicable'), 'required-checks-not-applicable');
  assert.equal(requiredCheckReviewReason('pending'), null);
  assert.equal(requiredCheckReviewReason('success'), null);
});

test('Auto-merge is not admitted until every required check is successful', () => {
  assert.equal(isAutoMergeCheckReady('pending'), false);
  assert.equal(isAutoMergeCheckReady('failure'), false);
  assert.equal(isAutoMergeCheckReady('missing'), false);
  assert.equal(isAutoMergeCheckReady('unconfigured'), false);
  assert.equal(isAutoMergeCheckReady('success'), true);
});

test('SkillGauge requires a path-scoped commit status on the exact changed head', () => {
  const profile = getRepositoryProfile('SkillGauge');
  assert.ok(profile.requiredChecks.some(check =>
    typeof check === 'object' &&
    check.name === 'skillgauge/verification' &&
    check.kind === 'status' &&
    check.paths.includes('skills/**/*.md')
  ));
});

test('domain verification defers before handoff, preserves review holds, and recognizes completed handoff', () => {
  const profile = {
    pendingLabel: 'skill-verification-pending',
    reviewHoldLabel: 'skill-verification-review',
    autoMerge: {
      label: 'automerge',
      branchPrefix: 'contrib-',
      sameRepository: true,
      paths: ['skills/**/*.md'],
      deferUntilHandoff: true
    }
  };
  const repository = 'ThanhNguyxnOrg/SkillGauge';
  const scopedPr = {
    labels: [],
    head: { ref: 'contrib-add-skill', repo: { full_name: repository } },
    base: { repo: { full_name: repository } }
  };
  assert.equal(domainVerificationState({ labels: [{ name: 'skill-verification-pending' }] }, profile), 'pending');
  assert.equal(domainVerificationState({ labels: [{ name: 'skill-verification-review' }] }, profile), 'review');
  assert.equal(domainVerificationState(scopedPr, profile, ['skills/new-skill.md']), 'pending');
  assert.equal(domainVerificationState({ ...scopedPr, labels: [{ name: 'automerge' }] }, profile, ['skills/new-skill.md']), 'ready');
  assert.equal(domainVerificationState(scopedPr, profile, ['README.md']), 'ready');
});

test('renamed files are checked using both their previous and current paths', () => {
  const changedPaths = expandChangedFilePaths([
    { filename: 'skills/new/readme.md', previous_filename: 'README.md', status: 'renamed' },
    { filename: 'skills/new/meta.json', status: 'added' }
  ]);
  assert.deepEqual(changedPaths, ['skills/new/readme.md', 'README.md', 'skills/new/meta.json']);

  const profile = {
    autoMerge: {
      label: 'automerge',
      branchPrefix: 'contrib-',
      sameRepository: true,
      paths: ['skills/**/*.md']
    }
  };
  const repository = 'ThanhNguyxnOrg/SkillGauge';
  const pr = {
    user: { login: 'contributor' },
    labels: [{ name: 'automerge' }],
    head: { ref: 'contrib-add-skill', repo: { full_name: repository } },
    base: { repo: { full_name: repository } }
  };
  assert.equal(isPolicyAutoMergeCandidate(pr, changedPaths, profile), false);
});

test('known review holds cancel an already queued native Auto-merge while mergeability is unknown', () => {
  const queued = { node_id: 'PR_kwDOExample', auto_merge: { enabled_at: '2026-11-16T00:00:00Z' } };
  const notQueued = { node_id: 'PR_kwDOExample', auto_merge: null };
  assert.equal(shouldDisableAutoMergeForKnownReviewHold(queued, ['domain-verification-review']), true);
  assert.equal(shouldDisableAutoMergeForKnownReviewHold(queued, ['security']), true);
  assert.equal(shouldDisableAutoMergeForKnownReviewHold(queued, []), false);
  assert.equal(shouldDisableAutoMergeForKnownReviewHold(notQueued, ['security']), false);
});

test('deferred verification or a changed head cancels an already queued native Auto-merge', () => {
  const queued = { node_id: 'PR_kwDOExample', auto_merge: { enabled_at: '2026-11-16T00:00:00Z' } };
  const notQueued = { node_id: 'PR_kwDOExample', auto_merge: null };
  assert.equal(shouldDisableAutoMergeForDeferredState(queued, { verificationPending: true }), true);
  assert.equal(shouldDisableAutoMergeForDeferredState(queued, { headChanged: true }), true);
  assert.equal(shouldDisableAutoMergeForDeferredState(queued, { baseChanged: true }), true);
  assert.equal(shouldDisableAutoMergeForDeferredState(queued), false);
  assert.equal(shouldDisableAutoMergeForDeferredState(notQueued, { verificationPending: true }), false);
});

test('manual maintainer blocking labels veto policy-authorized auto-merge candidates', () => {
  const pr = { labels: [{ name: 'automerge' }, { name: 'security' }, { name: 'breaking' }] };
  assert.deepEqual(getBlockingPullRequestLabels(pr, ['needs-review', 'security', 'breaking']), ['security', 'breaking']);
  assert.deepEqual(getBlockingPullRequestLabels({ labels: [{ name: 'automerge' }] }, ['needs-review', 'security']), []);
  assert.deepEqual(getBlockingPullRequestLabels({ labels: [{ name: 'needs-review' }] }, ['needs-review']), []);
});

test('freshly added policy opt-in clears the earlier triage-needed reason', () => {
  const profile = { autoMerge: { allowTriageBypass: true } };
  assert.deepEqual(reconcilePolicyTriageReason(['triage-needed'], true, profile), []);
  assert.deepEqual(reconcilePolicyTriageReason(['triage-needed'], false, profile), ['triage-needed']);
  assert.deepEqual(reconcilePolicyTriageReason(['triage-needed'], true, { autoMerge: { allowTriageBypass: false } }), ['triage-needed']);
});

test('repository-authorized auto-merge requires the explicit label, allowed branch, same-repo head and only allowed paths', () => {
  const profile = {
    autoMerge: {
      label: 'automerge',
      branchPrefix: 'contrib-',
      sameRepository: true,
      paths: ['skills/**/*.md'],
      allowTriageBypass: true
    }
  };
  const repository = 'ThanhNguyxnOrg/SkillGauge';
  const pr = {
    user: { login: 'contributor' },
    labels: [{ name: 'automerge' }],
    head: { ref: 'contrib-add-skill', repo: { full_name: repository } },
    base: { repo: { full_name: repository } }
  };

  assert.equal(isPolicyAutoMergeCandidate(pr, ['skills/new-skill.md'], profile), true);
  assert.equal(isPolicyAutoMergeCandidate({ ...pr, labels: [] }, ['skills/new-skill.md'], profile), false);
  assert.equal(isPolicyAutoMergeCandidate({ ...pr, head: { ...pr.head, ref: 'feature/add-skill' } }, ['skills/new-skill.md'], profile), false);
  assert.equal(isPolicyAutoMergeCandidate({ ...pr, head: { ...pr.head, repo: { full_name: 'contributor/SkillGauge' } } }, ['skills/new-skill.md'], profile), false);
  assert.equal(isPolicyAutoMergeCandidate(pr, ['skills/new-skill.md', 'README.md'], profile), false);
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
  assert.equal(isDependencyManifestPath('requirements/development.txt'), true);
  assert.equal(isDependencyManifestPath('requirements/dev/constraints.txt'), true);
  assert.equal(isDependencyManifestPath('docs/development.txt'), false);
  assert.equal(isDependencyManifestPath('.github/workflows/ci.yml'), false);
  assert.equal(isDependencyManifestPath('src/main.ts'), false);
});

test('Dependabot updates to nested requirements manifests can pass the manifest-path gate', () => {
  const result = analyzeDependencyUpdate(
    {
      title: 'chore(deps-dev): update ruff requirement from <1.0,>=0.17.4 to >=0.17.5,<1.0',
      body: 'Updates ruff to 0.17.5',
      user: { login: 'dependabot[bot]' }
    },
    ['requirements/development.txt']
  );
  assert.equal(result.eligible, true);
  assert.equal(result.versionRisk, 'patch');
  assert.deepEqual(result.reasons, []);
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
