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
  for (let page = 1; page <= 50; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const batch = await request(path + separator + 'per_page=100&page=' + page);
    if (!Array.isArray(batch)) throw new Error('Expected an array from ' + path);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error('Pagination limit reached while listing ' + path);
}

function names(labels) {
  return new Set((labels || []).map(label => (typeof label === 'string' ? label : label.name).toLowerCase()));
}

export function pullRequestCheckSha(pullRequest) {
  const sha = String(pullRequest?.merge_commit_sha || '').trim();
  return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
}

function isBot(login) {
  return typeof login === 'string' && login.toLowerCase().endsWith('[bot]');
}

export function classifyPullRequestLabels(pullRequest, changedFiles = []) {
  const title = String(pullRequest?.title || '');
  const body = String(pullRequest?.body || '').slice(0, 8000);
  const author = String(pullRequest?.user?.login || '').toLowerCase();
  const text = title + '\n' + body;
  const paths = changedFiles.map(path => String(path).toLowerCase());
  const labels = new Set();
  const dependencyBot = author === 'dependabot[bot]' || author === 'renovate[bot]';

  if (isBot(author)) labels.add('automated');
  if (dependencyBot || /\b(dependencies|dependency|bump|update package|update action)\b/i.test(title)) {
    labels.add('dependencies');
  }
  if (/\b(security|vulnerability|CVE-\d{4}-\d+|exploit|credential leak)\b/i.test(text)) {
    labels.add('security');
  }

  if (/^(?:fix|bugfix)(?:\([^)]*\))?:|\b(bug|regression|crash|exception|broken)\b/i.test(title)) {
    labels.add('bug');
  }
  if (/^(?:feat|feature)(?:\([^)]*\))?:|\b(enhancement|feature request|new feature)\b/i.test(title)) {
    labels.add('enhancement');
  }
  if (/^(?:docs?)(?:\([^)]*\))?:|\b(documentation|readme|typo)\b/i.test(title)) {
    labels.add('documentation');
  }
  if (/^(?:refactor|perf|chore|build|ci)(?:\([^)]*\))?:/i.test(title)) {
    labels.add('maintenance');
  }

  if (paths.some(path => path.startsWith('.github/workflows/') || path.startsWith('.github/actions/'))) {
    labels.add('workflow-update');
  }
  if (paths.some(path => /(^|\/)(docs?|documentation)(\/|$)|(^|\/)readme(?:\.|$)/.test(path))) {
    labels.add('documentation');
  }
  if (paths.some(path => /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^.]+$/.test(path))) {
    labels.add('tests');
  }
  if (paths.some(path => /(^|\/)(src-tauri|backend|server|api|services?|workers?|cmd|internal)(\/|$)/.test(path))) {
    labels.add('backend');
  }
  if (paths.some(path => /(^|\/)(frontend|web|ui|components?|pages?)(\/|$)|\.(tsx|jsx|vue|svelte|css|scss|html)$/.test(path))) {
    labels.add('frontend');
  }
  if (paths.some(path => /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock)$/i.test(path))) {
    labels.add('dependencies');
  }
  if (paths.some(path => /(^|\/)(CHANGELOG|RELEASE_NOTES)(\.|$)|(^|\/)release\//i.test(path))) {
    labels.add('release');
  }

  const hasType = ['bug', 'enhancement', 'documentation', 'security', 'dependencies', 'maintenance'].some(label => labels.has(label));
  if (!hasType) labels.add('triage-needed');
  return [...labels];
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

async function listCheckRuns(fullName, sha) {
  const result = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await request('/repos/' + fullName + '/commits/' + sha + '/check-runs?per_page=100&page=' + page);
    const batch = Array.isArray(response.check_runs) ? response.check_runs : [];
    result.push(...batch);
    if (batch.length < 100) return result;
  }
  throw new Error('Check-run pagination limit reached for ' + fullName + '@' + sha);
}

async function listCommitStatuses(fullName, sha) {
  const result = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await request('/repos/' + fullName + '/commits/' + sha + '/statuses?per_page=100&page=' + page);
    if (!Array.isArray(batch)) throw new Error('Expected commit statuses array for ' + fullName + '@' + sha);
    result.push(...batch);
    if (batch.length < 100) return result;
  }
  throw new Error('Commit-status pagination limit reached for ' + fullName + '@' + sha);
}

async function getCheckState(fullName, sha, repoName, changedFiles = undefined) {
  const [runs, statuses] = await Promise.all([listCheckRuns(fullName, sha), listCommitStatuses(fullName, sha)]);
  const profile = getRepositoryProfile(repoName);
  const result = evaluateRequiredChecks(runs, { statuses }, profile?.requiredChecks || [], changedFiles);
  if (result.state !== 'success') console.warn('[required-checks]', fullName, sha, JSON.stringify(result));
  return result.state;
}


async function removeLabel(fullName, number, labelName) {
  try {
    await request('/repos/' + fullName + '/issues/' + number + '/labels/' + encodeURIComponent(labelName), {
      method: 'DELETE'
    });
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 404) throw error;
  }
}

async function syncCheckLabels(fullName, number, state) {
  const labels = ['ci-failed', 'ci-pending', 'ci-missing'];
  const current = state === 'failure' ? 'ci-failed'
    : (state === 'pending' ? 'ci-pending'
      : (state === 'success' ? null : 'ci-missing'));
  for (const label of labels) {
    if (label !== current) await removeLabel(fullName, number, label);
  }
  if (current) await addLabels(fullName, number, [current, 'needs-review']);
}

async function processPullRequest(repo, pr) {
  const fullName = repo.full_name;
  const repoName = repo.name;
  const policy = repositoryPolicy(repoName);
  if (pr.draft) return;

  let paths = [];
  let pathsAvailable = true;
  try {
    paths = await getChangedFiles(fullName, pr.number);
  } catch (error) {
    pathsAvailable = false;
    console.warn('[files]', fullName + '#' + pr.number, error.message);
  }

  const labels = new Set(classifyPullRequestLabels(pr, paths));
  const allowedBaseBranches = policy.allowedBaseBranches || [getRepositoryProfile(repoName)?.defaultBranch || repo.default_branch].filter(Boolean);
  if (!allowedBaseBranches.includes(pr.base.ref)) labels.add('triage-needed');
  if (!pathsAvailable) labels.add('triage-needed');
  if (hasSensitivePath(paths, policy.sensitivePaths || [])) labels.add('needs-review');

  // The Agent routes every non-draft PR to a human. It never merges PRs.
  labels.add('needs-review');
  await addLabels(fullName, pr.number, [...labels]);
  await assignHumans(fullName, pr, true);

  if (!allowedBaseBranches.includes(pr.base.ref)) {
    console.log('[review]', fullName + '#' + pr.number + ': target branch is outside the repository policy');
    return;
  }

  const existingLabels = names(pr.labels);
  if ([...config.blockingLabels].some(label => existingLabels.has(label))) {
    console.log('[review]', fullName + '#' + pr.number + ': an existing blocking label requires human review');
    return;
  }

  let fresh;
  try {
    fresh = await request('/repos/' + fullName + '/pulls/' + pr.number);
  } catch (error) {
    console.warn('[pull]', fullName + '#' + pr.number, error.message);
    return;
  }

  if (fresh.head?.sha !== pr.head.sha) {
    console.log('[defer]', fullName + '#' + pr.number + ': PR head changed during evaluation; retrying next poll');
    return;
  }

  if (fresh.mergeable === false || fresh.mergeable_state === 'dirty') {
    await addLabels(fullName, pr.number, ['merge-conflict', 'needs-review']);
    console.log('[review]', fullName + '#' + pr.number + ': merge conflict; human resolution required');
    return;
  }
  await removeLabel(fullName, pr.number, 'merge-conflict');

  const checkSha = pullRequestCheckSha(fresh);
  if (!checkSha) {
    console.log('[review]', fullName + '#' + pr.number + ': awaiting GitHub mergeability/check SHA; human review remains assigned');
    return;
  }

  const checkState = await getCheckState(fullName, checkSha, repoName, pathsAvailable ? paths : undefined);
  await syncCheckLabels(fullName, pr.number, checkState);
  console.log('[human-review-required]', fullName + '#' + pr.number + ': checks=' + checkState + '; no automatic merge is performed');
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

  const failures = [];
  for (const repo of active) {
    const fullName = repo.full_name;
    try {
      const [pulls, issues] = await Promise.all([
        listAll('/repos/' + fullName + '/pulls?state=open'),
        listAll('/repos/' + fullName + '/issues?state=open')
      ]);
      for (const pr of pulls) {
        try { await processPullRequest(repo, pr); }
        catch (error) {
          failures.push(fullName + '#' + pr.number + ' PR: ' + error.message);
          console.warn('[pr-error]', fullName + '#' + pr.number, error.message);
        }
      }
      for (const issue of issues) {
        if (issue.pull_request) continue;
        try { await processIssue(repo, issue); }
        catch (error) {
          failures.push(fullName + '#' + issue.number + ' issue: ' + error.message);
          console.warn('[issue-error]', fullName + '#' + issue.number, error.message);
        }
      }
    } catch (error) {
      failures.push(fullName + ': ' + error.message);
      console.warn('[repo-error]', fullName, error.message);
    }
  }
  if (failures.length) throw new Error('Agent reconciliation incomplete (' + failures.length + ' failures): ' + failures.slice(0,20).join('; '));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => {
    console.error('[agent-fatal]', error);
    process.exitCode = 1;
  });
}
