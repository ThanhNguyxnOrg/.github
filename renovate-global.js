// Central Renovate configuration for ThanhNguyxnOrg.
// This file is loaded by the one Renovate runner in this repository.
// Local renovate.json files are intentionally ignored; do not add copies per repo.

module.exports = {
  platform: 'github',
  autodiscover: true,
  autodiscoverFilter: ['ThanhNguyxnOrg/*'],

  // Organization policy is managed here, not by per-repository onboarding PRs.
  onboarding: false,
  requireConfig: 'ignored',

  dependencyDashboard: true,
  dependencyDashboardTitle: 'ThanhNguyxnOrg Dependency Dashboard',
  branchPrefix: 'renovate/',
  labels: ['dependencies', 'renovate'],
  commitMessagePrefix: 'chore(deps):',
  rangeStrategy: 'auto',
  rebaseWhen: 'conflicted',

  // ThanhNguyxnAgent owns the merge decision. Renovate only discovers and
  // proposes updates; it must never merge independently.
  automerge: false,
  prHourlyLimit: 2,
  prConcurrentLimit: 8,

  packageRules: [
    {
      description: 'Mark patch updates for the central Agent merge policy.',
      matchUpdateTypes: ['patch'],
      addLabels: ['patch-update'],
    },
    {
      description: 'Mark minor updates for the central Agent merge policy.',
      matchUpdateTypes: ['minor'],
      addLabels: ['minor-update'],
    },
    {
      description: 'Major updates always require human review.',
      matchUpdateTypes: ['major'],
      addLabels: ['major-update', 'needs-review'],
      automerge: false,
    },
    {
      description: 'GitHub Actions changes are evaluated separately by the Agent; only pure action-ref bumps can be auto-merged.',
      matchManagers: ['github-actions'],
      addLabels: ['workflow-update'],
      automerge: false,
    },

    // Keep non-major PR volume manageable without mixing unrelated ecosystems.
    {
      matchManagers: ['npm'],
      matchUpdateTypes: ['patch', 'minor'],
      groupName: 'npm non-major updates',
    },
    {
      matchManagers: ['pip_requirements'],
      matchUpdateTypes: ['patch', 'minor'],
      groupName: 'Python non-major updates',
    },
    {
      matchManagers: ['cargo'],
      matchUpdateTypes: ['patch', 'minor'],
      groupName: 'Rust non-major updates',
    },
    {
      matchManagers: ['gomod'],
      matchUpdateTypes: ['patch', 'minor'],
      groupName: 'Go non-major updates',
    },
    {
      matchManagers: ['dockerfile'],
      matchUpdateTypes: ['patch', 'minor'],
      groupName: 'Docker non-major updates',
    },
    {
      matchManagers: ['github-actions'],
      matchUpdateTypes: ['patch', 'minor'],
      groupName: 'GitHub Actions non-major updates',
    },

    // Preserve existing repository-specific safety exclusions from Dependabot.
    {
      matchRepositories: ['ThanhNguyxnOrg/cogmint'],
      matchPackageNames: ['typescript'],
      matchUpdateTypes: ['major'],
      enabled: false,
    },
    {
      matchRepositories: ['ThanhNguyxnOrg/PurgeKit'],
      matchPackageNames: ['typescript', '@sveltejs/kit', '@sveltejs/adapter-static'],
      matchUpdateTypes: ['major'],
      enabled: false,
    },
    {
      matchRepositories: ['ThanhNguyxnOrg/WriteCanvas'],
      matchPackageNames: ['electron', 'electron-builder'],
      matchUpdateTypes: ['major'],
      enabled: false,
    },

    // Preserve the existing seven-day release cooldowns.
    {
      matchRepositories: ['ThanhNguyxnOrg/lumeo', 'ThanhNguyxnOrg/ClipForge'],
      minimumReleaseAge: '7 days',
    },
  ],
};
