import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { evaluateRequiredChecks, getRepositoryProfile } from './check-policy.mjs';

const TOKEN = process.env.GH_TOKEN;
const ORG = process.env.ORG || 'ThanhNguyxnOrg';
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const API_VERSION = '2022-11-28';
const config = JSON.parse(fs.readFileSync(new URL('../../agent-policy.json', import.meta.url), 'utf8'));

class GitHubError extends Error {
  constructor(status, message, path) {
    super(message);
    this.status = status;
    this.path = path;
  }
}

async function request(path, options = {}) {
  if (!TOKEN) throw new Error('GH_TOKEN is required');
  const response = await fetch(API + path, {
    method: options.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); }
    catch { data = raw; }
  }
  if (!response.ok) {
    const message = (data && data.message) || response.statusText || 'GitHub API request failed';
    throw new GitHubError(response.status, message, path);
  }
  return data;
}

async function listAll(path) {
  const items = [];
  for (let page = 1; page <= 20; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const batch = await request(path + separator + 'per_page=100&page=' + page);
    if (!Array.isArray(batch)) throw new Error('Expected an array from ' + path);
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

function names(labels) {
  return new Set((labels || []).map(label => (typeof label === 'string' ? label : label.name).toLowerCase()));
}

export function hasExplicitAutoMergeLabel(labels, policy = {}) {
  const present = names(labels);
  const allowed = [...config.defaultAutoMergeLabels, ...(policy.autoMergeLabels || [])]
    .map(label => String(label).toLowerCase());
  return allowed.some(label => present.has(label));
}

function isBot(login) {
  return typeof login === 'string' && login.toLowerCase().endsWith('[bot]');
}

function pathMatches(path, pattern) {
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return path === prefix || path.startsWith(prefix + '/');
  }
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
  return path === pattern;
}

export function classifyVersionUpdate(title) {
  const match = String(title || '').match(/\bfrom\s+v?(\d+(?:\.\d+){0,2})\s+to\s+v?(\d+(?:\.\d+){0,2})/i);
  if (!match) return 'unknown';
  const oldParts = match[1].split('.').map(Number);
  const newParts = match[2].split('.').map(Number);
  while (oldParts.length < 3) oldParts.push(0);
  while (newParts.length < 3) newParts.push(0);
  if (newParts.every((part, index) => part === oldParts[index])) return 'unchanged';
  if (newParts[0] > oldParts[0]) return 'major';
  if (newParts[0] < oldParts[0]) return 'downgrade';
  if (newParts[1] > oldParts[1]) return 'minor';
  if (newParts[1] < oldParts[1]) return 'downgrade';
  return newParts[2] > oldParts[2] ? 'patch' : 'downgrade';
}

export function evaluateCheckRollup(checkRuns = [], statuses = {}, requiredChecks = []) {
  return evaluateRequiredChecks(checkRuns, statuses, requiredChecks).state;
}


function repositoryPolicy(repoName) {
  return config.repositories?.[repoName] || {};
}

const labelCache = new Map();

async function ensureLabel(fullName, labelName) {
  const definition = Object.entries(config.labels).find(([, value]) => value && value.description && value.color && value.name === labelName);
  const item = Object.entries(config.labels).find(([key]) => key.replace(/[A-Z]/g, match => '-' + match.toLowerCase()) === labelName);
  const labelConfig = definition ? definition[1] : (item ? item[1] : null);
  if (!labelConfig) {
    // Existing labels are still usable even when not centrally declared.
    return;
  }
  const cacheKey = fullName + ':' + labelName;
  if (labelCache.has(cacheKey)) return;
  const path = '/repos/' + fullName + '/labels/' + encodeURIComponent(labelName);
  try {
    await request(path);
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 404) throw error;
    try {
      await request('/repos/' + fullName + '/labels', {
        method: 'POST',
        body: { name: labelName, color: labelConfig.color, description: labelConfig.description }
      });
    } catch (createError) {
      if (!(createError instanceof GitHubError) || createError.status !== 422) throw createError;
    }
  }
  labelCache.set(cacheKey, true);
}

async function addLabels(fullName, number, labelNames) {
  const unique = [...new Set(labelNames.filter(Boolean))];
  if (!unique.length) return;
  for (const name of unique) await ensureLabel(fullName, name);
  await request('/repos/' + fullName + '/issues/' + number + '/labels', {
    method: 'POST',
    body: { labels: unique }
  });
}

function reviewersFor(login) {
  return config.reviewers.filter(name => name.toLowerCase() !== String(login || '').toLowerCase());
}

async function assignHumans(fullName, item, isPullRequest) {
  const reviewers = reviewersFor(item.user?.login);
  const currentAssignees = new Set((item.assignees || []).map(user => user.login));
  const assignees = reviewers.filter(name => !currentAssignees.has(name));
  if (assignees.length) {
    try {
      await request('/repos/' + fullName + '/issues/' + item.number + '/assignees', {
        method: 'POST',
        body: { assignees }
      });
    } catch (error) {
      console.warn('[assign]', fullName + '#' + item.number, error.message);
    }
  }
  if (isPullRequest && reviewers.length) {
    const alreadyRequested = new Set((item.requested_reviewers || []).map(user => user.login));
    const missing = reviewers.filter(name => !alreadyRequested.has(name));
    if (missing.length) {
      try {
        await request('/repos/' + fullName + '/pulls/' + item.number + '/requested_reviewers', {
          method: 'POST',
          body: { reviewers: missing }
        });
      } catch (error) {
        console.warn('[review-request]', fullName + '#' + item.number, error.message);
      }
    }
  }
}

async function getChangedFiles(fullName, number) {
  return listAll('/repos/' + fullName + '/pulls/' + number + '/files').then(files => files.map(file => file.filename));
}

function hasSensitivePath(paths, patterns) {
  return paths.some(path => patterns.some(pattern => pathMatches(path, pattern)));
}

async function getCheckState(fullName, sha, repoName, changedFiles = undefined) {
  const [runs, statuses] = await Promise.all([
    request('/repos/' + fullName + '/commits/' + sha + '/check-runs?per_page=100'),
    request('/repos/' + fullName + '/commits/' + sha + '/status')
  ]);
  const profile = getRepositoryProfile(repoName);
  const result = evaluateRequiredChecks(runs.check_runs || [], statuses, profile?.requiredChecks || [], changedFiles);
  if (result.state !== 'success') console.warn('[required-checks]', fullName, sha, JSON.stringify(result));
  return result.state;
}


async function requestReview(fullName, pr, labels, reason) {
  const labelNames = ['needs-review', ...labels];
  await addLabels(fullName, pr.number, labelNames);
  await assignHumans(fullName, pr, true);
  console.log('[review]', fullName + '#' + pr.number + ': ' + reason);
}

async function mergePullRequest(fullName, pr) {
  const reviewPath = '/repos/' + fullName + '/pulls/' + pr.number + '/reviews';
  try {
    await request(reviewPath, {
      method: 'POST',
      body: {
        event: 'APPROVE',
        body: 'Approved by ThanhNguyxnAgent after the central safety policy and reported CI checks passed.'
      }
    });
  } catch (error) {
    // A previous approval or an approval restriction must not trigger a bypass.
    console.warn('[approval]', fullName + '#' + pr.number, error.message);
  }

  await addLabels(fullName, pr.number, ['agent-auto-merge']);
  try {
    const result = await request('/repos/' + fullName + '/pulls/' + pr.number + '/merge', {
      method: 'PUT',
      body: { sha: pr.head.sha, merge_method: 'squash' }
    });
    if (!result.merged) throw new Error(result.message || 'GitHub did not merge the pull request');
    console.log('[merged]', fullName + '#' + pr.number + ' at ' + pr.head.sha);
  } catch (error) {
    await addLabels(fullName, pr.number, ['needs-review']);
    await assignHumans(fullName, pr, true);
    console.warn('[merge-held]', fullName + '#' + pr.number, error.message);
  }
}

async function processPullRequest(repo, pr) {
  const fullName = repo.full_name;
  const repoName = repo.name;
  const policy = repositoryPolicy(repoName);
  const checkProfile = getRepositoryProfile(repoName);
  const labels = names(pr.labels);
  const author = pr.user?.login || '';
  const dependabot = author === 'dependabot[bot]' || author === 'renovate[bot]';
  const explicitAutoMerge = hasExplicitAutoMergeLabel(pr.labels, policy);

  if (pr.draft) return;
  if (checkProfile?.pendingLabel && labels.has(String(checkProfile.pendingLabel).toLowerCase())) {
    console.log('[defer]', fullName + '#' + pr.number + ': waiting for the project-specific validation adapter (' + checkProfile.pendingLabel + ')');
    return;
  }
  const allowedBaseBranches = policy.allowedBaseBranches || [checkProfile?.defaultBranch || repo.default_branch].filter(Boolean);
  if (!allowedBaseBranches.includes(pr.base.ref)) {
    await requestReview(fullName, pr, ['triage-needed'], 'target branch is outside the repository policy');
    return;
  }

  if ([...config.blockingLabels].some(label => labels.has(label))) {
    await assignHumans(fullName, pr, true);
    return;
  }

  let candidate = false;
  if (dependabot) {
    if (checkProfile?.autoMergeDependabot !== true) {
      await requestReview(fullName, pr, ['needs-review'], 'automatic dependency merging is not enabled in this repository central profile');
      return;
    }
    const updateType = classifyVersionUpdate(pr.title);
    if (updateType === 'major' || updateType === 'downgrade' || updateType === 'unknown' || updateType === 'unchanged') {
      await requestReview(fullName, pr, ['major-update'], 'dependency version could not be classified as a safe patch/minor update');
      return;
    }
    if (/security|vulnerability|CVE/i.test(pr.title) || labels.has('security')) {
      await requestReview(fullName, pr, ['security'], 'security dependency updates require human review');
      return;
    }
    candidate = updateType === 'patch' || updateType === 'minor';
  } else if (explicitAutoMerge) {
    candidate = true;
  }

  if (!candidate) {
    await addLabels(fullName, pr.number, ['triage-needed']);
    if (isBot(author)) await addLabels(fullName, pr.number, ['needs-review']);
    await assignHumans(fullName, pr, true);
    return;
  }

  let paths;
  try {
    paths = await getChangedFiles(fullName, pr.number);
  } catch (error) {
    await requestReview(fullName, pr, ['needs-review'], 'could not inspect the full changed-file list');
    console.warn('[files]', fullName + '#' + pr.number, error.message);
    return;
  }

  const workflowTouched = paths.some(path => path.startsWith('.github/workflows/') || path === '.github/dependabot.yml');
  if (workflowTouched) {
    await requestReview(fullName, pr, ['workflow-update'], 'workflow or repository automation changes require human review');
    return;
  }

  if (hasSensitivePath(paths, policy.sensitivePaths || [])) {
    await requestReview(fullName, pr, ['needs-review'], 'pull request touches a protected project path');
    return;
  }

  let fresh;
  try {
    fresh = await request('/repos/' + fullName + '/pulls/' + pr.number);
  } catch (error) {
    console.warn('[pull]', fullName + '#' + pr.number, error.message);
    return;
  }
  if (fresh.mergeable === false || fresh.mergeable_state === 'dirty') {
    await requestReview(fullName, pr, ['merge-conflict'], 'pull request has merge conflicts');
    return;
  }
  if (fresh.mergeable === null || fresh.mergeable_state === 'unknown') {
    console.log('[defer]', fullName + '#' + pr.number + ': GitHub has not computed mergeability yet');
    return;
  }

  let checkState = 'missing';
  try {
    checkState = await getCheckState(fullName, pr.head.sha, repoName, paths);
  } catch (error) {
    console.warn('[checks]', fullName + '#' + pr.number, error.message);
  }

  if (checkState !== 'success') {
    const label = checkState === 'failure' ? 'ci-failed' : (checkState === 'pending' ? 'ci-pending' : 'ci-missing');
    await requestReview(fullName, pr, [label], 'Required CI gate is ' + checkState + '; every centrally configured check must exist and succeed');
    return;
  }

  await mergePullRequest(fullName, pr);
}

function inferIssueCategory(issue) {
  const title = String(issue.title || '');
  const body = String(issue.body || '').slice(0, 6000);
  const combined = title + '\n' + body;
  if (/\b(security|vulnerability|CVE-\d{4}-\d+|exposure|credential leak)\b/i.test(combined)) return 'security';
  if (/\b(bug|unexpected|crash|exception|does not work|not working|broken)\b/i.test(title)) return 'bug';
  if (/\b(feature request|enhancement|please add|would be useful|new feature)\b/i.test(title)) return 'enhancement';
  if (/\b(documentation|docs|typo|readme)\b/i.test(title)) return 'documentation';
  if (/\b(question|how do i|how can i|why does)\b/i.test(title)) return 'question';
  return 'triage-needed';
}

async function processIssue(repo, issue) {
  const fullName = repo.full_name;
  const labels = names(issue.labels);
  if (isBot(issue.user?.login)) return;
  const ignored = (repositoryPolicy(repo.name).ignoredIssueLabels || config.ignoredIssueLabels);
  if (ignored.some(label => labels.has(label))) return;

  const category = inferIssueCategory(issue);
  const toAdd = [category];
  if (category === 'security') toAdd.push('needs-review');
  await addLabels(fullName, issue.number, toAdd);
  await assignHumans(fullName, issue, false);
  console.log('[issue]', fullName + '#' + issue.number + ': ' + category);
}

async function run() {
  const repos = await listAll('/orgs/' + ORG + '/repos?type=all');
  const active = repos.filter(repo => !repo.archived && !repo.fork && !config.ignoredRepositories.includes(repo.name));
  console.log('[agent] scanning ' + active.length + ' repositories with ' + config.pollIntervalMinutes + '-minute polling');

  for (const repo of active) {
    const fullName = repo.full_name;
    try {
      const [pulls, issues] = await Promise.all([
        listAll('/repos/' + fullName + '/pulls?state=open'),
        listAll('/repos/' + fullName + '/issues?state=open')
      ]);

      for (const pr of pulls) {
        try { await processPullRequest(repo, pr); }
        catch (error) { console.warn('[pr-error]', fullName + '#' + pr.number, error.message); }
      }

      for (const issue of issues) {
        if (issue.pull_request) continue;
        try { await processIssue(repo, issue); }
        catch (error) { console.warn('[issue-error]', fullName + '#' + issue.number, error.message); }
      }
    } catch (error) {
      console.warn('[repo-error]', fullName, error.message);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => {
    console.error('[agent-fatal]', error);
    process.exitCode = 1;
  });
}
