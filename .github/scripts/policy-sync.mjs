import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Keeps the central policy files covering newly discovered organization
// repositories so a repo is never left fail-closed forever just because it was
// created after the last manual policy edit. New entries are always
// fail-closed: an empty requiredChecks list means "no check can auto-merge"
// until a human maps the real CI gate, and an excluded release reason means
// "no automatic releases" until a release profile is written.

export const AUTO_EXCLUDE_REASON =
  'Newly discovered repository; release classification not mapped yet — excluded until explicitly onboarded.';

const INVENTORY_FILE = 'organization-repositories.json';
const CI_POLICY_FILE = 'ci-policy.json';
const RELEASE_POLICY_FILE = 'release-policy.json';
const CONTROL_REPOSITORY = '.github';

function isAutoCiEntry(entry) {
  // Only entries with exactly the auto-added shape (defaultBranch + empty
  // requiredChecks) may be removed automatically; anything a human tuned
  // (paths, extra keys, real check names) is left for review.
  return Boolean(
    entry &&
    typeof entry === 'object' &&
    Object.keys(entry).sort().join(',') === 'defaultBranch,requiredChecks' &&
    typeof entry.defaultBranch === 'string' &&
    Array.isArray(entry.requiredChecks) &&
    entry.requiredChecks.length === 0
  );
}

export function planPolicySync({ discovered, ciPolicy, releasePolicy }) {
  const discoveredNames = discovered.map(repo => repo.name);
  const inventory = [...new Set([CONTROL_REPOSITORY, ...discoveredNames])].sort((a, b) =>
    a.localeCompare(b)
  );
  const changes = [];
  const warnings = [];

  const ciRepos = ciPolicy.repositories || (ciPolicy.repositories = {});
  for (const repo of discovered) {
    if (!Object.hasOwn(ciRepos, repo.name)) {
      ciRepos[repo.name] = { defaultBranch: repo.default_branch, requiredChecks: [] };
      changes.push(`ci-policy: added ${repo.name} (fail-closed default)`);
    }
  }
  for (const name of Object.keys(ciRepos)) {
    if (!discoveredNames.includes(name)) {
      if (isAutoCiEntry(ciRepos[name])) {
        delete ciRepos[name];
        changes.push(`ci-policy: removed stale auto-added entry for ${name}`);
      } else {
        warnings.push(`ci-policy: ${name} is not an active repository but has a custom profile; left for manual review`);
      }
    }
  }

  const relRepos = releasePolicy.repositories || {};
  const relExcluded = releasePolicy.excluded || (releasePolicy.excluded = {});
  for (const name of inventory) {
    if (!Object.hasOwn(relRepos, name) && !Object.hasOwn(relExcluded, name)) {
      relExcluded[name] = AUTO_EXCLUDE_REASON;
      changes.push(`release-policy: excluded ${name} (classification not mapped)`);
    }
  }
  // A stale classification breaks the release-policy invariant
  // (classified set must equal the inventory), so stale entries are removed
  // from both maps. Custom entries are recoverable from git history and are
  // flagged loudly so a temporarily archived repository is not lost silently.
  for (const name of Object.keys(relExcluded)) {
    if (!inventory.includes(name)) {
      const auto = relExcluded[name] === AUTO_EXCLUDE_REASON;
      delete relExcluded[name];
      changes.push(`release-policy: removed stale ${auto ? 'auto-' : ''}excluded entry for ${name}`);
      if (!auto) {
        warnings.push(`release-policy: removed the custom exclusion of ${name} because it is not an active repository; restore it from git history if the repository returns`);
      }
    }
  }
  for (const name of Object.keys(relRepos)) {
    if (!inventory.includes(name)) {
      delete relRepos[name];
      changes.push(`release-policy: removed the release profile of ${name}`);
      warnings.push(`release-policy: removed the tuned release profile of ${name} because it is not an active repository; restore it from git history if the repository returns`);
    }
  }

  return { inventory, changes, warnings };
}

function writeJson(path, value) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (fs.existsSync(path) && fs.readFileSync(path, 'utf8') === text) return false;
  fs.writeFileSync(path, text);
  return true;
}

export function runPolicySync({
  repositoryMetadata = process.env.REPOSITORY_METADATA,
  pushToken = process.env.GH_TOKEN,
  log = console
} = {}) {
  const discovered = JSON.parse(repositoryMetadata || '[]');
  if (!Array.isArray(discovered) || discovered.length === 0) {
    log.log('[policy-sync] no discovered repositories; nothing to do');
    return { changed: false };
  }

  const ciPolicy = JSON.parse(fs.readFileSync(CI_POLICY_FILE, 'utf8'));
  const releasePolicy = JSON.parse(fs.readFileSync(RELEASE_POLICY_FILE, 'utf8'));
  const { inventory, changes, warnings } = planPolicySync({ discovered, ciPolicy, releasePolicy });

  for (const warning of warnings) log.warn('[policy-sync] ' + warning);
  for (const change of changes) log.log('[policy-sync] ' + change);

  const filesChanged = [
    writeJson(CI_POLICY_FILE, ciPolicy),
    writeJson(RELEASE_POLICY_FILE, releasePolicy),
    writeJson(INVENTORY_FILE, inventory)
  ].some(Boolean);

  if (!filesChanged) {
    log.log('[policy-sync] policies already cover every discovered repository');
    return { changed: false, warnings };
  }

  if (!pushToken) {
    throw new Error('GH_TOKEN is required to publish policy changes');
  }

  execSync(`git add ${CI_POLICY_FILE} ${RELEASE_POLICY_FILE} ${INVENTORY_FILE}`);
  if (execSync('git diff --cached --name-only').toString().trim() === '') {
    log.log('[policy-sync] working tree reports changes but index is empty; nothing to commit');
    return { changed: false, warnings };
  }
  execSync('git commit -m "chore: sync central policies for discovered repositories [skip ci]"');
  const auth = Buffer.from('x-access-token:' + pushToken).toString('base64');
  execSync(`git -c http.extraheader="AUTHORIZATION: basic ${auth}" push origin HEAD:main`);
  log.log(`[policy-sync] pushed ${changes.length} change(s) to main`);
  return { changed: true, changes, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runPolicySync();
  } catch (error) {
    console.error('[policy-sync-fatal]', error);
    process.exitCode = 1;
  }
}
