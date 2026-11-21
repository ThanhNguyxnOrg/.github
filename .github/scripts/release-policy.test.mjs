import test from 'node:test';
import assert from 'node:assert/strict';
import policy from '../../release-policy.json' with { type: 'json' };
import organizationRepositories from '../../organization-repositories.json' with { type: 'json' };

test('every organization repository has exactly one release classification', () => {
  const active = Object.keys(policy.repositories || {});
  const excluded = Object.keys(policy.excluded || {});
  const classified = [...active, ...excluded];
  assert.equal(new Set(classified).size, classified.length, 'release classification contains duplicate repository keys');
  assert.deepEqual(classified.sort(), [...organizationRepositories].sort());
});

test('automatic release profiles declare complete branch and version metadata', () => {
  for (const [name, rule] of Object.entries(policy.repositories || {})) {
    assert.ok(rule.branch, name + ' must declare its release branch');
    assert.ok(['tag', 'commit'].includes(rule.mode), name + ' must declare a supported release mode');
    assert.ok(rule.initialVersion, name + ' must declare an initial version');
    assert.ok(rule.changelogPath, name + ' must declare a changelog path');
    if (rule.releaseWorkflowName) {
      assert.ok(Array.isArray(rule.requiredAssets) && rule.requiredAssets.length > 0,
        name + ' must declare required release assets when it has a build workflow');
    }
  }
});

test('BlendOps uses the central tag-only release contract from its verified v1.0.0 baseline', () => {
  const rule = policy.repositories.blendops;
  assert.ok(rule, 'BlendOps must be enabled in the automatic release policy');
  assert.equal(policy.excluded?.blendops, undefined);
  assert.equal(rule.branch, 'main');
  assert.equal(rule.mode, 'tag');
  assert.match(rule.baselineSha, /^[0-9a-f]{40}$/);
  assert.equal(rule.initialVersion, '1.0.0');
  assert.equal(rule.changelogPath, 'CHANGELOG.md');
  assert.equal(rule.requireSuccessfulChecks, true);
  assert.deepEqual(rule.versionFiles, [
    {
      path: 'package.json',
      kind: 'json',
      jsonPaths: [['version']]
    },
    {
      path: 'package-lock.json',
      kind: 'json',
      jsonPaths: [['version'], ['packages', '', 'version']]
    },
    {
      path: 'scripts/install-skills.mjs',
      kind: 'regex',
      pattern: "(INSTALLER_VERSION\\s*=\\s*')[^']+(')",
      replacement: '$1{{version}}$2'
    }
  ]);
  assert.equal(rule.releaseWorkflowName, undefined, 'source-only BlendOps releases do not need a binary build workflow');
  assert.equal(rule.requiredAssets, undefined, 'source-only BlendOps releases must not claim distributable assets');
});

test('excluded repositories explain why automatic releases are disabled', () => {
  for (const [name, reason] of Object.entries(policy.excluded || {})) {
    assert.ok(typeof reason === 'string' && reason.trim().length > 10, name + ' needs a useful exclusion reason');
  }
});
