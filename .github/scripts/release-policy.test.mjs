import test from 'node:test';
import assert from 'node:assert/strict';
import policy from '../../release-policy.json' with { type: 'json' };

const organizationRepositories = [
  '.github',
  'AFTERFRAME-THE-LAST-LOOP',
  'apidex-hub',
  'awesome-cert-sherpa',
  'blendops',
  'chess-on-glass',
  'ClipForge',
  'cogmint',
  'ForgeHelm',
  'git-account-switcher',
  'judgeloom-core',
  'lagvex',
  'LayoutLingua',
  'lumeo',
  'Locsight',
  'PurgeKit',
  'SkillGauge',
  'Snapbooth',
  'StepDSA',
  'Techstack-Studio',
  'ThanhNguyxnOrg.github.io',
  'WriteCanvas'
];

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

test('excluded repositories explain why automatic releases are disabled', () => {
  for (const [name, reason] of Object.entries(policy.excluded || {})) {
    assert.ok(typeof reason === 'string' && reason.trim().length > 10, name + ' needs a useful exclusion reason');
  }
});
