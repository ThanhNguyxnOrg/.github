import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { evaluateRequiredChecks, getRepositoryProfile } from './check-policy.mjs';
import { releaseBodyFromChangelog } from './release-changelog.mjs';
export { releaseNotesFromChangelog, releaseBodyFromChangelog } from './release-changelog.mjs';

const TOKEN = process.env.GH_TOKEN;
const ORG = process.env.ORG || 'ThanhNguyxnOrg';
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const API_VERSION = '2022-11-28';
const VERSION_EMAIL = '296222857+thanhnguyxnagent[bot]@users.noreply.github.com';
const VERSION_NAME = 'ThanhNguyxnAgent[bot]';
export const RELEASE_BRANCH = 'thanhnguyxnagent/release';
const config = JSON.parse(fs.readFileSync(new URL('../../release-policy.json', import.meta.url), 'utf8'));

class GitHubError extends Error {
  constructor(status, message, path) {
    super(message);
    this.status = status;
    this.path = path;
  }
}

async function api(path, options = {}) {
  if (!TOKEN) throw new Error('GH_TOKEN is required');
  const retryable = new Set([429, 500, 502, 503, 504]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(API + path, {
      method: options.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const raw = await response.text();
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch { data = raw; }
    }
    if (response.ok) return data;

    const message = (data && data.message) || response.statusText || 'GitHub API request failed';
    if (!retryable.has(response.status) || attempt === 2) {
      throw new GitHubError(response.status, message, path);
    }

    const retryAfter = Number(response.headers.get('retry-after') || 0);
    const delayMs = Math.min(10000, retryAfter > 0 ? retryAfter * 1000 : 1000 * (2 ** attempt));
    console.warn('[api-retry]', response.status, path, 'attempt', attempt + 1, 'waiting', delayMs + 'ms');
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  throw new Error('GitHub API retry loop ended unexpectedly for ' + path);
}

function parseSemver(value) {
  const match = String(value || '').replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] || '' };
}

function compareVersions(a, b) {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  if (!av || !bv) return 0;
  for (const key of ['major', 'minor', 'patch']) {
    if (av[key] !== bv[key]) return av[key] - bv[key];
  }
  if (!av.prerelease && bv.prerelease) return 1;
  if (av.prerelease && !bv.prerelease) return -1;
  return av.prerelease.localeCompare(bv.prerelease);
}

export function bumpSemver(current, level) {
  const parsed = parseSemver(current);
  if (!parsed) throw new Error('Unsupported current version: ' + current);
  if (level === 'major') return (parsed.major + 1) + '.0.0';
  if (level === 'minor') return parsed.major + '.' + (parsed.minor + 1) + '.0';
  if (level === 'patch') return parsed.major + '.' + parsed.minor + '.' + (parsed.patch + 1);
  throw new Error('Unsupported release level: ' + level);
}

export function classifyConventionalCommit(message) {
  const full = String(message || '').replace(/\r/g, '');
  const lines = full.split('\n');
  const subject = (lines.shift() || '').trim();
  const match = subject.match(/^([a-zA-Z][a-zA-Z0-9-]*)(?:\(([^)]+)\))?(!)?:\s+(.+)$/);
  if (!match) return null;
  const type = match[1].toLowerCase();
  const scope = (match[2] || '').trim().toLowerCase();
  const ignoredScopes = new Set([
    'release',
    'ci',
    'build',
    'docs',
    'meta',
    ...(config.conventionalCommitPolicy?.ignoredScopes || []),
  ].map(value => String(value).trim().toLowerCase()));
  if (scope && ignoredScopes.has(scope)) return null;
  const isBreaking = Boolean(match[3]) || /^\s*BREAKING CHANGE:\s*.+/im.test(lines.join('\n')) || /^\s*BREAKING-CHANGE:\s*.+/im.test(lines.join('\n'));
  let level = null;
  if (isBreaking) level = 'major';
  else if (type === 'feat') level = 'minor';
  else if (['fix', 'perf', 'revert'].includes(type)) level = 'patch';
  if (!level) return null;
  return { type, scope, subject: match[4].trim(), level, breaking: isBreaking };
}

export function highestReleaseLevel(commits) {
  const rank = { patch: 1, minor: 2, major: 3 };
  let best = null;
  for (const commit of commits) {
    const parsed = classifyConventionalCommit(commit.message || commit.commit?.message || '');
    if (parsed && (!best || rank[parsed.level] > rank[best])) best = parsed.level;
  }
  return best;
}

export function makeReleaseNotes(commits, fullName) {
  const groups = {
    'Breaking Changes': [],
    Features: [],
    'Bug Fixes and Performance': [],
    Reverts: []
  };
  for (const commit of commits) {
    const message = commit.message || commit.commit?.message || '';
    const parsed = classifyConventionalCommit(message);
    if (!parsed) continue;
    const sha = commit.sha || commit.id || '';
    const url = 'https://github.com/' + fullName + '/commit/' + sha;
    const line = '- ' + parsed.subject + ' ([' + sha.slice(0, 7) + '](' + url + '))';
    if (parsed.breaking) groups['Breaking Changes'].push(line);
    else if (parsed.type === 'feat') groups.Features.push(line);
    else if (parsed.type === 'revert') groups.Reverts.push(line);
    else groups['Bug Fixes and Performance'].push(line);
  }
  return Object.entries(groups)
    .filter(([, items]) => items.length)
    .map(([title, items]) => '### ' + title + '\n\n' + items.join('\n'))
    .join('\n\n');
}

export function insertChangelogSection(existing, version, date, notes) {
  const source = String(existing || '').replace(/\r/g, '');
  const escapedVersion = String(version).replace(/\./g, '\\.');
  const headingPattern = new RegExp('^##\\s+\\[?' + escapedVersion + '\\]?(?:\\s|$)', 'm');
  if (headingPattern.test(source)) throw new Error('CHANGELOG already contains version ' + version);
  const block = '## [' + version + '] - ' + date + '\n\n' + notes.trim() + '\n\n';
  const headings = [...source.matchAll(/^##\s+/gm)];
  const unreleased = headings.find(item => /^##\s+\[?Unreleased\]?/i.test(item[0]));
  let insertAt;
  if (unreleased) {
    const next = headings.find(item => item.index > unreleased.index);
    insertAt = next ? next.index : source.length;
  } else {
    const firstVersion = headings.find(item => /^\s*##\s+\[?v?\d+\.\d+\.\d+/i.test(item[0]));
    insertAt = firstVersion ? firstVersion.index : source.length;
  }
  if (!source.trim()) return '# Changelog\n\n' + block;
  return source.slice(0, insertAt).replace(/\s*$/, '\n\n') + block + source.slice(insertAt);
}

export function releaseIntent(message, mode) {
  const subject = String(message || '').split('\n')[0].trim().replace(/ \(#\d+\)$/, '');
  const pattern = mode === 'commit'
    ? /^release:\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/i
    : /^chore\(release\):\s*prepare\s+v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/i;
  const match = subject.match(pattern);
  return match ? match[1] : null;
}

function highestVersionTag(refs) {
  const tags = refs.map(item => item.ref.replace(/^refs\/tags\//, ''))
    .filter(tag => parseSemver(tag) && !parseSemver(tag).prerelease);
  tags.sort(compareVersions);
  return tags.length ? tags[tags.length - 1] : null;
}

export function changedFilesForPolicy(comparison, requiredChecks = []) {
  const pathScoped = requiredChecks.some(entry => typeof entry !== 'string' && (
    (Array.isArray(entry.paths) && entry.paths.length) ||
    (Array.isArray(entry.excludePaths) && entry.excludePaths.length)
  ));
  if (!pathScoped) return undefined;
  if (!Array.isArray(comparison?.files) || comparison.files.length >= 300) return undefined;
  return comparison.files.map(file => String(file.filename || '')).filter(Boolean);
}

export async function dispatchMissingChecks(fullName, branch, sha, headSha, result, requiredChecks, request = api) {
  if (sha !== headSha || result.state !== 'missing' || result.failed?.length || result.pending?.length) return;
  const missing = new Set(result.missing || []);
  const workflows = new Set(requiredChecks
    .filter(entry => typeof entry === 'object' && entry && missing.has(entry.name) && entry.workflow)
    .map(entry => entry.workflow));
  for (const workflow of workflows) {
    const path = '/repos/' + fullName + '/actions/workflows/' + encodeURIComponent(workflow);
    try {
      const runs = await request(path + '/runs?head_sha=' + encodeURIComponent(sha) + '&event=workflow_dispatch&per_page=1');
      const existing = runs.workflow_runs?.[0];
      if (existing) {
        console.log('[release-check-dispatch-exists]', fullName, workflow, sha, existing.html_url, existing.status);
        continue;
      }
      await request(path + '/dispatches', { method: 'POST', body: { ref: branch } });
      console.log('[release-check-dispatched]', fullName, workflow, sha);
    } catch (error) {
      if (![403, 404, 422].includes(error.status)) throw error;
      console.warn('[release-check-dispatch-error]', fullName, workflow, sha, 'status=' + error.status, error.message);
    }
  }
}

async function checkState(fullName, sha, repoName, changedFiles, headSha, branch) {
  const [checks, statuses] = await Promise.all([
    api('/repos/' + fullName + '/commits/' + sha + '/check-runs?per_page=100'),
    api('/repos/' + fullName + '/commits/' + sha + '/status')
  ]);
  const profile = getRepositoryProfile(repoName);
  const result = evaluateRequiredChecks(checks.check_runs || [], statuses, profile?.requiredChecks || [], changedFiles);
  if (result.state !== 'success') console.warn('[release-required-checks]', fullName, sha, JSON.stringify(result));
  await dispatchMissingChecks(fullName, branch, sha, headSha, result, profile?.requiredChecks || []);
  return result;
}


async function getFile(fullName, path, ref) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const result = await api('/repos/' + fullName + '/contents/' + encoded + '?ref=' + encodeURIComponent(ref));
  if (result.encoding !== 'base64') throw new Error('Unsupported encoding for ' + fullName + '/' + path);
  return Buffer.from(result.content.replace(/\n/g, ''), 'base64').toString('utf8');
}

export function applyVersionFile(file, source, version) {
  if (file.kind === 'json') {
    const parsed = JSON.parse(source);
    for (const path of file.jsonPaths || []) {
      let cursor = parsed;
      for (let index = 0; index < path.length - 1; index += 1) {
        if (!cursor || !Object.prototype.hasOwnProperty.call(cursor, path[index])) {
          throw new Error('JSON version path missing in ' + file.path + ': ' + path.join('.'));
        }
        cursor = cursor[path[index]];
      }
      const key = path[path.length - 1];
      if (!cursor || !Object.prototype.hasOwnProperty.call(cursor, key)) {
        throw new Error('JSON version key missing in ' + file.path + ': ' + path.join('.'));
      }
      cursor[key] = version;
    }
    return JSON.stringify(parsed, null, 2) + '\n';
  }
  if (file.kind === 'regex') {
    const expression = new RegExp(file.pattern, 'm');
    if (!expression.test(source)) throw new Error('Version pattern did not match ' + file.path);
    const replacement = String(file.replacement).replace(/\{\{version\}\}/g, version);
    return source.replace(expression, replacement);
  }
  throw new Error('Unsupported version-file kind for ' + file.path);
}

function conventionalCommitLink(fullName, commit) {
  const sha = commit.sha;
  const parsed = classifyConventionalCommit(commit.commit?.message || '');
  if (!parsed) return null;
  const subject = parsed.subject.replace(/\s+/g, ' ').trim();
  return '- ' + subject + ' ([' + sha.slice(0, 7) + '](https://github.com/' + fullName + '/commit/' + sha + '))';
}

function makeTagName(version) {
  return 'v' + version;
}

export function pendingDraftReleases(releases) {
  const items = Array.isArray(releases) ? releases : [];
  const publishedTags = new Set(items.filter(item => !item.draft).map(item => item.tag_name));
  const newestByTag = new Map();
  for (const item of items) {
    const tag = String(item.tag_name || '');
    if (!item.draft || !parseSemver(tag) || publishedTags.has(tag)) continue;
    const previous = newestByTag.get(tag);
    if (!previous || String(item.created_at || '') > String(previous.created_at || '')) newestByTag.set(tag, item);
  }
  return [...newestByTag.values()].sort((a, b) => String(a.tag_name).localeCompare(String(b.tag_name)));
}

export function missingRequiredAssets(assets, patterns, tag) {
  const uploadedNames = new Set((Array.isArray(assets) ? assets : [])
    .filter(asset => asset.state === 'uploaded')
    .map(asset => String(asset.name || '')));
  const version = String(tag || '').replace(/^v/, '');
  return (Array.isArray(patterns) ? patterns : [])
    .map(pattern => String(pattern).replaceAll('{tag}', tag).replaceAll('{version}', version))
    .filter(expected => !uploadedNames.has(expected));
}


export function planOrphanAssetRecovery(sourceAssets, destinationAssets, requiredPatterns, tag) {
  const version = String(tag || '').replace(/^v/, '');
  const required = (Array.isArray(requiredPatterns) ? requiredPatterns : [])
    .map(pattern => String(pattern).replaceAll('{tag}', tag).replaceAll('{version}', version));
  if (!required.length) {
    return { required, copy: [], missing: [], conflicts: [], safeToDelete: false };
  }

  const uploaded = assets => (Array.isArray(assets) ? assets : [])
    .filter(asset => asset && asset.state === 'uploaded' && asset.name);
  const source = new Map(uploaded(sourceAssets).map(asset => [String(asset.name), asset]));
  const destination = new Map(uploaded(destinationAssets).map(asset => [String(asset.name), asset]));
  const copy = [];
  const missing = [];
  const conflicts = [];

  for (const name of required) {
    const existing = destination.get(name);
    const candidate = source.get(name);
    if (existing) {
      if (candidate && (
        Number(candidate.size) !== Number(existing.size) ||
        !candidate.digest ||
        !existing.digest ||
        candidate.digest !== existing.digest
      )) conflicts.push(name);
      continue;
    }
    if (candidate) copy.push(candidate);
    else missing.push(name);
  }

  const sourceItems = Array.isArray(sourceAssets) ? sourceAssets : [];
  const safeToDelete = !missing.length && !conflicts.length &&
    sourceItems.length > 0 &&
    sourceItems.every(asset => {
      if (!asset || asset.state !== 'uploaded' || !required.includes(String(asset.name || ''))) return false;
      const copyInDestination = destination.get(String(asset.name));
      return Boolean(
        copyInDestination &&
        Number(asset.size) === Number(copyInDestination.size) &&
        asset.digest &&
        copyInDestination.digest &&
        asset.digest === copyInDestination.digest
      );
    });

  return { required, copy, missing, conflicts, safeToDelete };
}

async function downloadReleaseAsset(fullName, asset) {
  const response = await fetch(API + '/repos/' + fullName + '/releases/assets/' + asset.id, {
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/octet-stream',
      'X-GitHub-Api-Version': API_VERSION
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new GitHubError(response.status, detail || 'Release asset download failed', '/repos/' + fullName + '/releases/assets/' + asset.id);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== Number(asset.size)) {
    throw new Error('Downloaded asset size mismatch for ' + asset.name + ': expected ' + asset.size + ', received ' + bytes.length);
  }
  const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  if (asset.digest && digest !== asset.digest) {
    throw new Error('Downloaded asset SHA-256 mismatch for ' + asset.name);
  }
  return { bytes, digest };
}

async function uploadReleaseAsset(fullName, destinationRelease, sourceAsset, bytes, digest) {
  const uploadBase = String(destinationRelease.upload_url || '').replace(/\{\?.*$/, '');
  if (!uploadBase) throw new Error('Release upload URL is missing for ' + fullName + ' #' + destinationRelease.id);
  const uploadUrl = uploadBase + '?name=' + encodeURIComponent(sourceAsset.name);
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'Content-Type': sourceAsset.content_type || 'application/octet-stream',
      'X-GitHub-Api-Version': API_VERSION
    },
    body: bytes
  });
  const raw = await response.text();
  let result = null;
  if (raw) {
    try { result = JSON.parse(raw); } catch { result = raw; }
  }
  if (!response.ok) {
    const message = (result && result.message) || response.statusText || 'Release asset upload failed';
    throw new GitHubError(response.status, message, uploadUrl);
  }
  if (!result || result.state !== 'uploaded' || Number(result.size) !== bytes.length || result.digest !== digest) {
    throw new Error('Uploaded asset verification failed for ' + sourceAsset.name);
  }
  console.log('[release-asset-copied]', fullName, sourceAsset.name, bytes.length, digest);
  return result;
}

async function recoverOrphanReleaseAssets(fullName, orphanDraft, publishedRelease, rule) {
  const tag = String(orphanDraft.tag_name || '');
  if (!rule.releaseWorkflowName || !Array.isArray(rule.requiredAssets) || !rule.requiredAssets.length) {
    console.warn('[release-recovery-held]', fullName, tag, 'missing build workflow or required asset manifest; preserving draft', orphanDraft.id);
    return false;
  }

  const headSha = await getTagCommitSha(fullName, tag);
  const runs = await api('/repos/' + fullName + '/actions/runs?head_sha=' + encodeURIComponent(headSha) + '&per_page=100');
  const matching = (runs.workflow_runs || [])
    .filter(run => run.name === rule.releaseWorkflowName)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const latest = matching[0];
  if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success') {
    console.warn('[release-recovery-held]', fullName, tag, 'matching build workflow is not successful for tag commit', headSha);
    return false;
  }

  let destination = await api('/repos/' + fullName + '/releases/' + publishedRelease.id);
  let plan = planOrphanAssetRecovery(orphanDraft.assets || [], destination.assets || [], rule.requiredAssets, tag);
  if (plan.conflicts.length) {
    console.error('[release-recovery-conflict]', fullName, tag, 'same-name assets differ; preserving orphan draft:', plan.conflicts.join(', '));
    return false;
  }
  if (plan.missing.length) {
    console.error('[release-recovery-incomplete]', fullName, tag, 'required assets are missing from both releases; preserving orphan draft:', plan.missing.join(', '));
    return false;
  }

  for (const asset of plan.copy) {
    const downloaded = await downloadReleaseAsset(fullName, asset);
    await uploadReleaseAsset(fullName, destination, asset, downloaded.bytes, downloaded.digest);
    destination = await api('/repos/' + fullName + '/releases/' + publishedRelease.id);
  }

  destination = await api('/repos/' + fullName + '/releases/' + publishedRelease.id);
  plan = planOrphanAssetRecovery(orphanDraft.assets || [], destination.assets || [], rule.requiredAssets, tag);
  const missingAfterCopy = missingRequiredAssets(destination.assets || [], rule.requiredAssets, tag);
  if (missingAfterCopy.length || !plan.safeToDelete) {
    console.error('[release-recovery-held]', fullName, tag, 'assets copied but the orphan cannot yet be safely deleted; missing:', missingAfterCopy.join(', ') || 'none', 'source assets fully mirrored:', plan.safeToDelete);
    return false;
  }

  await api('/repos/' + fullName + '/releases/' + orphanDraft.id, { method: 'DELETE' });
  console.log('[release-orphan-cleaned]', fullName, tag, 'all required assets verified on public release; removed draft', orphanDraft.id);
  return true;
}

export function releaseMatchesTag(release, tag) {
  return String(release?.tag_name || '') === String(tag || '');
}

export function selectReleaseByTag(releases, tag) {
  const matches = (Array.isArray(releases) ? releases : [])
    .filter(release => release && releaseMatchesTag(release, tag))
    .sort((a, b) => {
      if (Boolean(a.draft) !== Boolean(b.draft)) return Number(Boolean(a.draft)) - Number(Boolean(b.draft));
      const aDate = String(a.updated_at || a.created_at || '');
      const bDate = String(b.updated_at || b.created_at || '');
      return bDate.localeCompare(aDate);
    });
  return matches[0] || null;
}

export function selectOrphanDraftForTag(releases, tag, targetSha, expectedName) {
  const expectedTag = String(tag || '');
  const expectedCommit = String(targetSha || '').toLowerCase();
  const name = String(expectedName || '');
  if (!expectedTag || !/^[0-9a-f]{40}$/.test(expectedCommit) || !name) return null;

  const matches = (Array.isArray(releases) ? releases : [])
    .filter(release =>
      release &&
      release.draft === true &&
      /^untagged-[0-9a-f]{8,}$/i.test(String(release.tag_name || '')) &&
      String(release.name || '') === name &&
      String(release.target_commitish || '').toLowerCase() === expectedCommit
    )
    .sort((a, b) => {
      const aDate = String(a.updated_at || a.created_at || '');
      const bDate = String(b.updated_at || b.created_at || '');
      return bDate.localeCompare(aDate);
    });
  return matches[0] || null;
}


async function getTagCommitSha(fullName, tag) {
  const ref = await api('/repos/' + fullName + '/git/ref/tags/' + encodeURIComponent(tag));
  if (ref.object.type === 'commit') return ref.object.sha;
  if (ref.object.type === 'tag') {
    const annotated = await api('/repos/' + fullName + '/git/tags/' + ref.object.sha);
    return annotated.object.sha;
  }
  throw new Error('Unsupported tag object type for ' + fullName + ':' + tag);
}

async function ensureTagRef(fullName, tag, targetSha) {
  const expectedSha = String(targetSha || '');
  if (!/^[0-9a-f]{40}$/i.test(expectedSha)) {
    return getTagCommitSha(fullName, tag);
  }

  try {
    const currentSha = await getTagCommitSha(fullName, tag);
    if (currentSha !== expectedSha) {
      throw new Error('Release tag ' + tag + ' already points to ' + currentSha + ', expected ' + expectedSha);
    }
    return currentSha;
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 404) throw error;
  }

  try {
    await api('/repos/' + fullName + '/git/refs', {
      method: 'POST',
      body: { ref: 'refs/tags/' + tag, sha: expectedSha }
    });
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 422) throw error;
    const currentSha = await getTagCommitSha(fullName, tag);
    if (currentSha !== expectedSha) {
      throw new Error('Release tag ' + tag + ' was concurrently created at ' + currentSha + ', expected ' + expectedSha);
    }
  }

  console.log('[tag-created]', fullName, tag, expectedSha);
  return expectedSha;
}

async function ensureDraftRelease(fullName, repoName, tag, version, targetSha, rule) {
  const changelog = await getFile(fullName, rule.changelogPath || 'CHANGELOG.md', targetSha);
  const body = releaseBodyFromChangelog(changelog, version);

  const prerelease = Boolean(parseSemver(version)?.prerelease);
  const name = repoName + ' ' + tag;
  // Create and verify the real Git tag before asking the Releases API to create
  // a draft. Draft tag lookup can still return 404 while the collection already
  // contains the exact draft, so the collection is the authoritative fallback.
  const tagSha = await ensureTagRef(fullName, tag, targetSha);
  let release;
  try {
    release = await api('/repos/' + fullName + '/releases/tags/' + encodeURIComponent(tag));
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 404) throw error;

    const releases = await api('/repos/' + fullName + '/releases?per_page=100');
    release = selectReleaseByTag(releases, tag);
    if (release) {
      console.log('[release-lookup-fallback]', fullName, tag, 'resolved exact tag from release collection', release.id);
    }

    if (!release) {
      const orphan = selectOrphanDraftForTag(releases, tag, tagSha, name);
      if (orphan) {
        release = await api('/repos/' + fullName + '/releases/' + orphan.id, {
          method: 'PATCH',
          body: { tag_name: tag, target_commitish: tagSha, name, body, draft: true, prerelease }
        });
        if (!releaseMatchesTag(release, tag)) {
          throw new Error('Unable to attach matching legacy draft ' + orphan.id + ' to tag ' + tag);
        }
        console.log('[release-orphan-repaired]', fullName, tag, 'reused exact target draft', release.id);
      }
    }

    if (!release) {
      release = await api('/repos/' + fullName + '/releases', {
        method: 'POST',
        body: {
          tag_name: tag,
          target_commitish: tagSha,
          name,
          body,
          draft: true,
          prerelease,
          generate_release_notes: false
        }
      });
      if (!releaseMatchesTag(release, tag)) {
        throw new Error('GitHub created an unexpected release record for ' + fullName + ' ' + tag + ': tag_name=' + release.tag_name);
      }
      console.log('[release-draft-created]', fullName, tag, release.html_url);
      return release;
    }
  }

  if (!releaseMatchesTag(release, tag)) {
    throw new Error('GitHub returned a release record for the wrong tag: expected ' + tag + ', received ' + release.tag_name);
  }
  if (!release.draft) {
    console.log('[release-already-published]', fullName, tag, release.html_url);
    return release;
  }

  release = await api('/repos/' + fullName + '/releases/' + release.id, {
    method: 'PATCH',
    body: { tag_name: tag, target_commitish: tagSha, name, body, draft: true, prerelease }
  });
  if (!releaseMatchesTag(release, tag) || release.draft !== true || release.body !== body || release.name !== name) {
    throw new Error('GitHub draft update failed tag, name, body, or draft verification for ' + fullName + ' ' + tag);
  }
  console.log('[release-draft-updated]', fullName, tag, release.html_url);
  return release;
}

async function repairOrphanDraftReleases(fullName, repoName, releases, rule) {
  const prefix = repoName + ' ';
  for (const candidate of releases) {
    if (!candidate?.draft || !/^untagged-[0-9a-f]{8,}$/i.test(String(candidate.tag_name || ''))) continue;
    const name = String(candidate.name || '');
    if (!name.startsWith(prefix)) continue;
    const version = name.slice(prefix.length).replace(/^v/, '');
    if (!parseSemver(version)) continue;

    const tag = makeTagName(version);
    let tagSha;
    try {
      tagSha = await getTagCommitSha(fullName, tag);
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) continue;
      throw error;
    }

    const expectedName = repoName + ' ' + tag;
    const exactOrphan = selectOrphanDraftForTag(releases, tag, tagSha, expectedName);
    if (!exactOrphan || exactOrphan.id !== candidate.id) continue;

    const changelog = await getFile(fullName, rule.changelogPath || 'CHANGELOG.md', tagSha);
    const body = releaseBodyFromChangelog(changelog, version);
    const prerelease = Boolean(parseSemver(version)?.prerelease);
    const repaired = await api('/repos/' + fullName + '/releases/' + candidate.id, {
      method: 'PATCH',
      body: { tag_name: tag, target_commitish: tagSha, name: expectedName, body, draft: true, prerelease }
    });
    if (!releaseMatchesTag(repaired, tag) || repaired.draft !== true || repaired.target_commitish !== tagSha) {
      throw new Error('Orphan release repair failed exact tag, target SHA, or draft verification for ' + fullName + ' ' + tag);
    }
    console.log('[release-orphan-repaired]', fullName, tag, 'matched exact name and target SHA', candidate.id);

    if (!rule.releaseWorkflowName) {
      const published = await api('/repos/' + fullName + '/releases/' + candidate.id, {
        method: 'PATCH',
        body: { draft: false }
      });
      if (!releaseMatchesTag(published, tag) || published.draft !== false) {
        throw new Error('Orphan source-only release could not be published for ' + fullName + ' ' + tag);
      }
      console.log('[release-published]', fullName, tag, 'repaired source-only orphan draft');
    }
  }
}

async function publishReadyDrafts(repoName, rule) {
  const fullName = ORG + '/' + repoName;
  const initialReleases = await api('/repos/' + fullName + '/releases?per_page=100');
  await repairOrphanDraftReleases(fullName, repoName, initialReleases, rule);
  const releases = await api('/repos/' + fullName + '/releases?per_page=100');
  const pendingDrafts = pendingDraftReleases(releases);
  const pendingIds = new Set(pendingDrafts.map(release => release.id));
  for (const release of releases) {
    const tag = String(release.tag_name || '');
    if (!release.draft || !/^v\d+\.\d+\.\d+/.test(tag)) continue;
    if (!pendingIds.has(release.id)) {
      const published = releases.find(item => !item.draft && item.tag_name === tag);
      if (release.assets?.length && published) {
        await recoverOrphanReleaseAssets(fullName, release, published, rule);
      } else {
        console.warn('[release-duplicate-draft]', fullName, tag, '— an existing published release or newer draft already owns this tag; skipping orphan draft', release.id);
      }
      continue;
    }
    const headSha = await getTagCommitSha(fullName, tag);
    const version = tag.replace(/^v/, '');
    const canonicalDraft = await ensureDraftRelease(fullName, repoName, tag, version, headSha, rule);
    if (!rule.releaseWorkflowName) {
      await api('/repos/' + fullName + '/releases/' + release.id, {
        method: 'PATCH',
        body: { draft: false }
      });
      console.log('[release-published]', fullName, tag, 'no build workflow required');
      continue;
    }

    const runs = await api('/repos/' + fullName + '/actions/runs?head_sha=' + encodeURIComponent(headSha) + '&per_page=100');
    const matching = (runs.workflow_runs || [])
      .filter(run => run.name === rule.releaseWorkflowName)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (!matching.length) {
      console.log('[release-await-build]', fullName, tag, 'workflow has not started:', rule.releaseWorkflowName);
      continue;
    }

    const latest = matching[0];
    if (latest.status !== 'completed') {
      console.log('[release-await-build]', fullName, tag, 'workflow status:', latest.status);
      continue;
    }
    if (latest.conclusion !== 'success') {
      console.warn('[release-build-failed]', fullName, tag, 'workflow conclusion:', latest.conclusion, '— draft kept unpublished');
      continue;
    }

    if (!Array.isArray(rule.requiredAssets) || !rule.requiredAssets.length) {
      console.error('[release-assets-unconfigured]', fullName, tag, '— build workflow is configured but requiredAssets is empty; draft kept unpublished');
      continue;
    }
    const missingAssets = missingRequiredAssets(canonicalDraft.assets || [], rule.requiredAssets, tag);
    if (missingAssets.length) {
      console.error('[release-assets-missing]', fullName, tag, '— draft kept unpublished; missing:', missingAssets.join(', '));
      continue;
    }

    await api('/repos/' + fullName + '/releases/' + release.id, {
      method: 'PATCH',
      body: { draft: false }
    });
    console.log('[release-published]', fullName, tag, 'after successful build workflow');
  }
}

export async function createCommit(fullName, branch, headSha, changes, message, request = api, options = {}) {
  const parent = await request('/repos/' + fullName + '/git/commits/' + headSha);
  let treeSha = parent.tree.sha;
  // Re-declaring an unchanged release only needs a new commit.
  if (changes.length) {
    const treeEntries = [];
    for (const change of changes) {
      const blob = await request('/repos/' + fullName + '/git/blobs', {
        method: 'POST',
        body: { content: change.content, encoding: 'utf-8' }
      });
      treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const tree = await request('/repos/' + fullName + '/git/trees', {
      method: 'POST',
      body: { base_tree: treeSha, tree: treeEntries }
    });
    treeSha = tree.sha;
  }
  const timestamp = new Date().toISOString();
  const commit = await request('/repos/' + fullName + '/git/commits', {
    method: 'POST',
    body: {
      message,
      tree: treeSha,
      parents: [headSha],
      author: { name: VERSION_NAME, email: VERSION_EMAIL, date: timestamp },
      committer: { name: VERSION_NAME, email: VERSION_EMAIL, date: timestamp }
    }
  });
  let createRef = false;
  if (options.create) {
    try {
      await request('/repos/' + fullName + '/git/ref/heads/' + branch);
    } catch (error) {
      if (error.status !== 404) throw error;
      createRef = true;
    }
  }
  if (createRef) {
    await request('/repos/' + fullName + '/git/refs', {
      method: 'POST', body: { ref: 'refs/heads/' + branch, sha: commit.sha }
    });
  } else {
    await request('/repos/' + fullName + '/git/refs/heads/' + branch, {
      method: 'PATCH',
      body: { sha: commit.sha, force: options.force === true }
    });
  }
  return commit.sha;
}

export function releasePrMarker(base, version) {
  return '<!-- thanhnguyxnagent-release base=' + base + ' version=' + version + ' -->';
}

export function parseReleasePrMarker(body) {
  const match = String(body || '').match(/<!-- thanhnguyxnagent-release base=([0-9a-f]{40}) version=(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?) -->/);
  return match ? { base: match[1], version: match[2] } : null;
}

export function keepReleaseCommit(commit, headSha, subject) {
  return commit?.parents?.length === 1 && commit.parents[0].sha === headSha &&
    String(commit.message || '').split('\n')[0] === subject;
}

function releasePrQuery(fullName, branch, state) {
  return '/repos/' + fullName + '/pulls?state=' + state +
    '&head=' + encodeURIComponent(fullName.split('/')[0] + ':' + RELEASE_BRANCH) +
    (branch ? '&base=' + encodeURIComponent(branch) : '') + '&sort=updated&direction=desc&per_page=100';
}

export async function releasePrDeclined(fullName, branch, headSha, request = api) {
  const closed = [];
  for (let page = 1; ; page += 1) {
    const batch = await request(releasePrQuery(fullName, branch, 'closed') + '&page=' + page);
    closed.push(...batch);
    if (batch.length < 100) break;
  }
  const latest = closed.filter(pr => !pr.merged_at)
    .sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)))[0];
  return Boolean(latest && parseReleasePrMarker(latest.body)?.base === headSha);
}

export async function ensureReleasePr(fullName, branch, headSha, version, notes, subject, buildCommit, request = api) {
  const open = await request(releasePrQuery(fullName, branch, 'open'));
  const existing = open[0];
  if (!existing && await releasePrDeclined(fullName, branch, headSha, request)) {
    console.log('[release-pr-declined]', fullName, 'HEAD ' + headSha);
    return;
  }

  let current;
  try {
    const ref = await request('/repos/' + fullName + '/git/ref/heads/' + RELEASE_BRANCH);
    current = await request('/repos/' + fullName + '/git/commits/' + ref.object.sha);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const kept = keepReleaseCommit(current, headSha, subject);
  if (!kept) await buildCommit();
  const body = notes.trim() + '\n\n' +
    'Merge to approve this release (any merge method; squash keeps the title). Close to postpone until new commits land. ThanhNguyxnAgent keeps this PR updated with new commits.' +
    '\n\n' + releasePrMarker(headSha, version);
  let pr = existing;
  let action = kept ? 'current' : 'updated';
  if (!existing) {
    pr = await request('/repos/' + fullName + '/pulls', {
      method: 'POST', body: { head: RELEASE_BRANCH, base: branch, title: subject, body }
    });
    action = 'opened';
  } else if (existing.title !== subject || existing.body !== body) {
    pr = await request('/repos/' + fullName + '/pulls/' + existing.number, {
      method: 'PATCH', body: { title: subject, body }
    });
    action = 'updated';
  }
  console.log('[release-pr-' + action + ']', fullName, pr.html_url);
  return pr;
}

export async function cleanupReleaseBranch(fullName, branch, request = api) {
  const open = await request(releasePrQuery(fullName, null, 'open'));
  if (open.length) return;
  try {
    await request('/repos/' + fullName + '/git/refs/heads/' + RELEASE_BRANCH, { method: 'DELETE' });
  } catch (error) {
    if (![404, 422].includes(error.status)) throw error;
  }
}

async function prepareReleaseCommit(fullName, branch, headSha, nextVersion, notes, rule, baseLabel) {
  const commitMessage = rule.mode === 'commit'
    ? 'release: v' + nextVersion
    : 'chore(release): prepare v' + nextVersion;
  return ensureReleasePr(fullName, branch, headSha, nextVersion, notes, commitMessage, async () => {
    const changes = [];
    for (const file of rule.versionFiles || []) {
      const source = await getFile(fullName, file.path, headSha);
      const updated = applyVersionFile(file, source, nextVersion);
      if (updated !== source) changes.push({ path: file.path, content: updated });
    }

    const changelogPath = rule.changelogPath || 'CHANGELOG.md';
    let changelog;
    try {
      changelog = await getFile(fullName, changelogPath, headSha);
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 404) throw error;
      changelog = '# Changelog\n\n';
    }
    let updatedChangelog = changelog;
    try {
      updatedChangelog = insertChangelogSection(changelog, nextVersion, new Date().toISOString().slice(0, 10), notes);
    } catch (error) {
      // A previous prepare attempt may already have written this version's
      // section; keep it instead of failing a re-declared release.
      if (!(error instanceof Error) || !/already contains version/.test(error.message)) throw error;
    }
    if (updatedChangelog !== changelog) changes.push({ path: changelogPath, content: updatedChangelog });

    const body = 'Prepared automatically from Conventional Commits since ' + baseLabel + '.\n\n' +
      'Co-authored-by: ' + VERSION_NAME + ' <' + VERSION_EMAIL + '>\n' +
      'Signed-off-by: ' + VERSION_NAME + ' <' + VERSION_EMAIL + '>';
    return createCommit(fullName, RELEASE_BRANCH, headSha, changes, commitMessage + '\n\n' + body, api, { force: true, create: true });
  });
}


export async function shouldReprepareRelease(preparedState, preparedSha, headSha, checkHead) {
  return ['failure', 'missing'].includes(preparedState) && preparedSha !== headSha &&
    (await checkHead()) === 'success';
}

async function reconcileRepository(repoName, rule) {
  const fullName = ORG + '/' + repoName;
  const repo = await api('/repos/' + fullName);
  const branch = rule.branch || repo.default_branch;
  const headRef = await api('/repos/' + fullName + '/git/ref/heads/' + branch);
  const headSha = headRef.object.sha;
  const refs = await api('/repos/' + fullName + '/git/matching-refs/tags/v');
  const latestTag = highestVersionTag(refs);
  let base = latestTag || rule.baselineSha;

  if (latestTag && rule.baselineSha) {
    const baselineRelation = await api('/repos/' + fullName + '/compare/' + latestTag + '...' + rule.baselineSha);
    if (baselineRelation.status === 'ahead' || baselineRelation.status === 'identical') base = rule.baselineSha;
    else if (baselineRelation.status === 'behind') base = latestTag;
    else if (baselineRelation.status === 'diverged') {
      console.warn('[release-hold]', fullName, 'baseline and release history diverged; manual reconciliation required');
      return;
    }
  }

  const comparison = await api('/repos/' + fullName + '/compare/' + base + '...' + headSha);
  if (comparison.total_commits > 250 || comparison.commits.length < comparison.total_commits) {
    console.warn('[release-hold]', fullName, 'comparison exceeds the complete commit window; refusing an incomplete release');
    return;
  }

  const commits = comparison.commits || [];
  if (!commits.length) return;
  const changedFiles = changedFilesForPolicy(comparison, getRepositoryProfile(repoName)?.requiredChecks || []);

  const pending = [...commits].reverse().find(commit => releaseIntent(commit.commit?.message, rule.mode));
  if (pending) {
    await cleanupReleaseBranch(fullName, branch);
    const version = releaseIntent(pending.commit.message, rule.mode);
    const tag = makeTagName(version);
    const { state } = await checkState(fullName, pending.sha, repoName, changedFiles, headSha, branch);
    if (state !== 'success') {
      // Failed or missing checks on an old prepared commit can stall releases
      // after CI changes. A fresh prepared commit must still pass its own checks.
      const reprepare = await shouldReprepareRelease(
        state, pending.sha, headSha, async () => (await checkState(fullName, headSha, repoName, changedFiles, headSha, branch)).state
      );
      if (!reprepare) {
        console.log('[release-wait]', fullName, tag, '— CI state is ' + state);
        return;
      }
      // Recompute the version for the newer HEAD: commits that landed after
      // the failed prepare may require a higher bump, and reusing the old
      // version would ship them under the wrong SemVer level.
      let targetVersion = version;
      const reprepareLevel = highestReleaseLevel(commits
        .filter(commit => classifyConventionalCommit(commit.commit?.message))
        .map(commit => ({ message: commit.commit.message })));
      if (reprepareLevel) {
        const currentVersion = latestTag ? latestTag.replace(/^v/, '') : rule.initialVersion;
        const candidate = bumpSemver(currentVersion, reprepareLevel);
        if (compareVersions(candidate, targetVersion) > 0) targetVersion = candidate;
      }
      const targetTag = makeTagName(targetVersion);
      if (refs.some(item => item.ref === 'refs/tags/' + targetTag)) {
        console.warn('[release-hold]', fullName, targetTag, 'already exists but was not selected as the latest tag');
        return;
      }
      const notes = 'Re-declared at ' + headSha.slice(0, 12) + ' after prepared commit ' +
        pending.sha.slice(0, 12) + ' had required checks in state ' + state + '.';
      await prepareReleaseCommit(fullName, branch, headSha, targetVersion, notes, rule, pending.sha);
      return;
    }
    const preparedRelease = await ensureDraftRelease(fullName, repoName, tag, version, pending.sha, rule);
    if (!rule.releaseWorkflowName) {
      // Source-only releases have no build matrix or asset manifest to wait for.
      // Publish the exact verified draft returned by ensureDraftRelease rather than
      // relying on a second list query that can observe stale release collection data.
      const published = await api('/repos/' + fullName + '/releases/' + preparedRelease.id, {
        method: 'PATCH',
        body: { draft: false }
      });
      if (!releaseMatchesTag(published, tag) || published.draft !== false) {
        throw new Error('Source-only release publication could not be verified for ' + fullName + ' ' + tag);
      }
      console.log('[release-published]', fullName, tag, 'source-only release; required CI passed');
    }
    return;
  }

  const conventional = commits.filter(commit => classifyConventionalCommit(commit.commit?.message));
  const level = highestReleaseLevel(conventional.map(commit => ({ message: commit.commit.message })));
  if (!level) return;

  const currentVersion = latestTag ? latestTag.replace(/^v/, '') : rule.initialVersion;
  const nextVersion = bumpSemver(currentVersion, level);
  const tag = makeTagName(nextVersion);
  if (refs.some(item => item.ref === 'refs/tags/' + tag)) {
    console.warn('[release-hold]', fullName, tag, 'already exists but was not selected as the latest tag');
    return;
  }

  const checkResult = rule.requireSuccessfulChecks
    ? await checkState(fullName, headSha, repoName, changedFiles, headSha, branch)
    : { state: 'success' };
  if (checkResult.state !== 'success') {
    console.log('[release-wait]', fullName, 'HEAD ' + headSha + ' — CI state is ' + checkResult.state);
    return;
  }

  const notes = makeReleaseNotes(conventional, fullName);
  await prepareReleaseCommit(fullName, branch, headSha, nextVersion, notes, rule, latestTag || rule.baselineSha);
}

async function run() {
  const entries = Object.entries(config.repositories || {});
  const failures = [];
  console.log('[release] evaluating ' + entries.length + ' configured repositories');
  for (const [repoName, rule] of entries) {
    try {
      await reconcileRepository(repoName, rule);
      await publishReadyDrafts(repoName, rule);
    } catch (error) {
      failures.push(repoName + ': ' + error.message);
      console.error('[release-error]', repoName, 'status=' + (error.status || 'unknown'), 'path=' + (error.path || 'unknown'), error.message);
    }
  }
  if (failures.length) {
    throw new Error('Release reconciliation was incomplete: ' + failures.join('; '));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => {
    console.error('[release-fatal]', error);
    process.exitCode = 1;
  });
}
