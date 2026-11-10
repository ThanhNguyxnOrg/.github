import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRequiredChecks, getRepositoryProfile, matchesPathPattern } from './check-policy.mjs';

test('repository profiles are centrally defined and unknown repositories fail closed', () => {
  assert.equal(getRepositoryProfile('WriteCanvas').defaultBranch, 'master');
  assert.equal(getRepositoryProfile('WriteCanvas').autoMergeDependabot, true);
  assert.equal(getRepositoryProfile('unregistered-repo'), null);
});

test('central profiles cover every active organization repository and fail closed by default', () => {
  const names = [
    'judgeloom-core', 'blendops', 'apidex-hub', 'lumeo', 'ForgeHelm',
    'cogmint', 'awesome-cert-sherpa', 'Snapbooth', 'Locsight', 'PurgeKit',
    'SkillGauge', 'LayoutLingua', 'lagvex', 'git-account-switcher', 'StepDSA',
    'ThanhNguyxnOrg.github.io', 'ClipForge', 'WriteCanvas', 'Techstack-Studio',
    'AFTERFRAME-THE-LAST-LOOP', 'chess-on-glass'
  ];
  for (const name of names) assert.ok(getRepositoryProfile(name), 'missing central CI profile: ' + name);
  for (const [name, profile] of Object.entries(Object.fromEntries(names.map(name => [name, getRepositoryProfile(name)])))) {
    assert.ok(profile.defaultBranch, name + ' must declare its default branch');
    if (profile.autoMergeDependabot === true) {
      assert.ok(profile.requiredChecks.length > 0, name + ' cannot auto-merge dependencies without required checks');
    }
  }
  assert.equal(getRepositoryProfile('ForgeHelm').autoMergeDependabot, false);
  assert.deepEqual(getRepositoryProfile('ForgeHelm').requiredChecks, ['verify / Verify (ForgeHelm)']);
  assert.equal(getRepositoryProfile('SkillGauge').pendingLabel, 'skill-verification-pending');
  assert.ok(getRepositoryProfile('SkillGauge').requiredChecks.includes('verify / Verify (SkillGauge)'));
});

test('every required check must be present and successful', () => {
  const checks = [
    { name: 'unit tests', status: 'completed', conclusion: 'success' },
    { name: 'typecheck', status: 'completed', conclusion: 'success' }
  ];
  assert.equal(evaluateRequiredChecks(checks, {}, ['unit tests', 'typecheck']).state, 'success');
  assert.deepEqual(evaluateRequiredChecks(checks, {}, ['unit tests', 'build']).missing, ['build']);
});

test('missing policy is unconfigured rather than implicitly green', () => {
  assert.equal(evaluateRequiredChecks([{ name: 'build', status: 'completed', conclusion: 'success' }], {}, []).state, 'unconfigured');
});

test('skipped or neutral required checks are not accepted', () => {
  assert.equal(evaluateRequiredChecks([{ name: 'build', status: 'completed', conclusion: 'skipped' }], {}, ['build']).state, 'failure');
  assert.equal(evaluateRequiredChecks([{ name: 'build', status: 'completed', conclusion: 'neutral' }], {}, ['build']).state, 'failure');
});

test('the newest check-run attempt controls a duplicated required check name', () => {
  const checks = [
    { id: 1, name: 'build', status: 'completed', conclusion: 'failure', created_at: '2026-11-09T10:00:00Z' },
    { id: 2, name: 'build', status: 'completed', conclusion: 'success', created_at: '2026-11-09T10:05:00Z' }
  ];
  assert.equal(evaluateRequiredChecks(checks, {}, ['build']).state, 'success');
});

test('pending required checks hold the gate', () => {
  assert.equal(evaluateRequiredChecks([{ name: 'build', status: 'in_progress' }], {}, ['build']).state, 'pending');
  assert.equal(evaluateRequiredChecks([{ name: 'build', status: 'completed', conclusion: 'success' }], { statuses: [{ context: 'ci', state: 'pending' }] }, [{ name: 'ci', kind: 'status' }]).state, 'pending');
});

test('optional checks do not override the explicit required-check policy', () => {
  const checks = [
    { name: 'build', status: 'completed', conclusion: 'success' },
    { name: 'optional-preview', status: 'completed', conclusion: 'failure' },
    { name: 'unrelated-deploy', status: 'queued' }
  ];
  assert.equal(evaluateRequiredChecks(checks, { statuses: [{ context: 'optional', state: 'error' }] }, ['build']).state, 'success');
});

test('legacy commit statuses require their exact configured context', () => {
  assert.equal(evaluateRequiredChecks([], { statuses: [{ context: 'ci', state: 'success' }] }, [{ name: 'ci', kind: 'status' }]).state, 'success');
  assert.equal(evaluateRequiredChecks([], { statuses: [{ context: 'ci', state: 'success' }] }, [{ name: 'other', kind: 'status' }]).state, 'missing');
});

test('path globs support repository-root and nested paths', () => {
  assert.equal(matchesPathPattern('README.md', '**/*.md'), true);
  assert.equal(matchesPathPattern('docs/guide/setup.md', '**/*.md'), true);
  assert.equal(matchesPathPattern('apis/provider.yaml', 'apis/**'), true);
  assert.equal(matchesPathPattern('src/provider.ts', 'apis/**'), false);
  assert.equal(matchesPathPattern('.github/workflows/link-checker.yml', '.github/workflows/link-checker.yml'), true);
});

test('path-scoped required checks run only when their files are changed', () => {
  const checks = [
    { name: 'check-links', status: 'completed', conclusion: 'success' },
    { name: 'regression-tests', status: 'completed', conclusion: 'success' },
    { name: 'markdown-lint', status: 'completed', conclusion: 'success' }
  ];
  const required = [
    { name: 'check-links', paths: ['apis/**', 'scripts/**'] },
    { name: 'regression-tests', paths: ['scripts/**'] },
    { name: 'markdown-lint', paths: ['**/*.md'] }
  ];

  assert.deepEqual(evaluateRequiredChecks(checks, {}, required, ['scripts/check.py']).required, ['check-links', 'regression-tests']);
  assert.deepEqual(evaluateRequiredChecks(checks, {}, required, ['README.md']).required, ['markdown-lint']);
  assert.equal(evaluateRequiredChecks(checks, {}, required, ['scripts/check.py']).state, 'success');
  assert.equal(evaluateRequiredChecks(checks, {}, required, ['README.md']).state, 'success');
});

test('a missing path-scoped required check still blocks the gate', () => {
  const required = [
    { name: 'check-links', paths: ['apis/**'] },
    { name: 'regression-tests', paths: ['scripts/**'] }
  ];
  const result = evaluateRequiredChecks([], {}, required, ['scripts/check.py']);
  assert.equal(result.state, 'missing');
  assert.deepEqual(result.missing, ['check-links', 'regression-tests'].filter(name => name === 'regression-tests'));
});

test('path-scoped policy cannot be evaluated without changed-file context', () => {
  const result = evaluateRequiredChecks([], {}, [{ name: 'docs', paths: ['**/*.md'] }]);
  assert.equal(result.state, 'unconfigured');
  assert.deepEqual(result.missing, ['docs (changed-file context unavailable)']);
});

test('a profile with no applicable required checks fails closed', () => {
  const result = evaluateRequiredChecks([], {}, [{ name: 'docs', paths: ['**/*.md'] }], ['src/main.ts']);
  assert.equal(result.state, 'missing');
  assert.deepEqual(result.missing, ['No required checks apply to the changed files']);
});


test('CI profiles match the real project gates and quarantine known failing or optional checks', () => {
  assert.deepEqual(getRepositoryProfile('judgeloom-core').requiredChecks, ['Lint • Typecheck • Test (Python 3.12)', 'go-test / Go worker test • vet']);
  assert.deepEqual(getRepositoryProfile('cogmint').requiredChecks, ['verify / Typecheck']);
  assert.deepEqual(getRepositoryProfile('lumeo').requiredChecks, ['verify / lint-and-syntax']);
  assert.deepEqual(getRepositoryProfile('Techstack-Studio').requiredChecks, ['verify / Verify']);
  assert.deepEqual(getRepositoryProfile('StepDSA').requiredChecks, ['test / test']);
  assert.deepEqual(getRepositoryProfile('awesome-cert-sherpa').requiredChecks, ['build / Build & Validate']);
  assert.deepEqual(getRepositoryProfile('AFTERFRAME-THE-LAST-LOOP').requiredChecks, ['verify / Verify (Bun)']);
  assert.deepEqual(getRepositoryProfile('Snapbooth').requiredChecks, ['verify / Smoke & E2E']);
  assert.equal(
    getRepositoryProfile('Locsight').requiredChecks.includes('verify / Registry & Release Script'),
    true,
  );
  assert.deepEqual(
    getRepositoryProfile('LayoutLingua').requiredChecks.map(check => typeof check === 'string' ? check : check.name),
    [
      'test (ubuntu-latest) / Test (ubuntu-latest)',
      'test (windows-latest) / Test (windows-latest)',
      'test (macos-latest) / Test (macos-latest)',
    ],
  );
  assert.deepEqual(getRepositoryProfile('apidex-hub').requiredChecks.find(check => typeof check === 'object' && check.name.startsWith('regression-tests')).name, 'regression-tests / Python Regression Tests');
  assert.equal(getRepositoryProfile('cogmint').autoMergeDependabot, false);
  assert.deepEqual(getRepositoryProfile('PurgeKit').requiredChecks, [
    'frontend / Frontend (Svelte & TypeScript)',
    'rust / Rust Compiler Check',
  ]);
  assert.equal(getRepositoryProfile('PurgeKit').autoMergeDependabot, false);
  assert.deepEqual(getRepositoryProfile('blendops').requiredChecks, ['verify / Verify (BlendOps)']);
  assert.deepEqual(getRepositoryProfile('lagvex').requiredChecks, [
    'verify / Verify (Lagvex Go)',
    '🔨 Cross-Compile Check (linux, amd64, bin/lagvex-client-linux-amd64)',
    '🔨 Cross-Compile Check (windows, amd64, bin/lagvex-client.exe)',
    '🔨 Cross-Compile Check (darwin, arm64, bin/lagvex-client-darwin-arm64)',
    '🔨 Cross-Compile Check (linux, amd64, bin/lagvex-relay, ./cmd/lagvex-relay)',
    '🔨 Cross-Compile Check (darwin, amd64, bin/lagvex-client-darwin-amd64)',
  ]);
  assert.deepEqual(getRepositoryProfile('ClipForge').requiredChecks, [
    'build-test-ubuntu / 🐧 g++ C++ backend (ubuntu)',
    '🪟 MSVC + NASM (windows)',
    '🔖 Version consistency',
  ]);
  assert.equal(getRepositoryProfile('ClipForge').requiredChecks.includes('🖥️ Qt 6 Quick (windows)'), false);
});
