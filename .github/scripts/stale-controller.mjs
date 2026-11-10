import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const TOKEN = process.env.GH_TOKEN;
const ORG = process.env.ORG || 'ThanhNguyxnOrg';
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const API_VERSION = '2022-11-28';
const config = JSON.parse(fs.readFileSync(new URL('../../agent-policy.json', import.meta.url), 'utf8'));
const policy = config.stalePolicy || {};
const DAY = 24 * 60 * 60 * 1000;
const MARKER_PREFIX = '<!-- thanhnguyxnagent:stale-marked-at:';
const labelCache = new Set();

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
      'X-GitHub-Api-Version': API_VERSION
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = raw; }
  }
  if (!response.ok) {
    const message = (data && data.message) || response.statusText || 'GitHub API request failed';
    throw new GitHubError(response.status, message, path);
  }
  return data;
}

async function listAll(path) {
  const result = [];
  for (let page = 1; page <= 30; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const batch = await request(path + separator + 'per_page=100&page=' + page);
    if (!Array.isArray(batch)) throw new Error('Expected an array from ' + path);
    result.push(...batch);
    if (batch.length < 100) return result;
  }
  throw new Error('Pagination limit reached while listing ' + path);
}

function labelNames(item) {
  return new Set((item.labels || []).map(label => String(typeof label === 'string' ? label : label.name).toLowerCase()));
}

export function parseStaleMarker(body) {
  const text = String(body || '');
  const start = text.indexOf(MARKER_PREFIX);
  if (start < 0) return null;
  const valueStart = start + MARKER_PREFIX.length;
  const end = text.indexOf(' -->', valueStart);
  if (end < 0) return null;
  const parsed = new Date(text.slice(valueStart, end));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function staleDecision(item, markerDate, now = new Date(), staleConfig = policy) {
  if (item?.draft || item?.locked) return 'exempt';
  const labels = labelNames(item);
  const exempt = new Set((staleConfig.exemptLabels || []).map(label => String(label).toLowerCase()));
  if ([...exempt].some(label => labels.has(label))) return 'exempt';

  if (!markerDate) {
    const updatedAt = new Date(item.updated_at);
    if (Number.isNaN(updatedAt.getTime())) return 'active';
    return now.getTime() - updatedAt.getTime() >= Number(staleConfig.daysBeforeStale || 14) * DAY
      ? 'mark'
      : 'active';
  }

  const updatedAt = new Date(item.updated_at);
  const toleranceMinutes = Math.max(0, Number(staleConfig.activityTimestampToleranceMinutes ?? 5));
  const activityThreshold = markerDate.getTime() + toleranceMinutes * 60 * 1000;
  if (!Number.isNaN(updatedAt.getTime()) && updatedAt.getTime() > activityThreshold) return 'reactivated';
  return now.getTime() - markerDate.getTime() >= Number(staleConfig.daysBeforeClose || 5) * DAY
    ? 'close'
    : 'wait';
}

async function ensureStaleLabel(fullName) {
  const key = fullName + ':stale';
  if (labelCache.has(key)) return;
  try {
    await request('/repos/' + fullName + '/labels/stale');
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 404) throw error;
    try {
      await request('/repos/' + fullName + '/labels', {
        method: 'POST',
        body: { name: 'stale', color: 'ededed', description: 'Inactive under the organization stale policy.' }
      });
    } catch (createError) {
      if (!(createError instanceof GitHubError) || createError.status !== 422) throw createError;
    }
  }
  labelCache.add(key);
}

async function addStaleLabel(fullName, number) {
  await ensureStaleLabel(fullName);
  await request('/repos/' + fullName + '/issues/' + number + '/labels', {
    method: 'POST',
    body: { labels: ['stale'] }
  });
}

async function removeStaleLabel(fullName, number) {
  try {
    await request('/repos/' + fullName + '/issues/' + number + '/labels/stale', { method: 'DELETE' });
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 404) throw error;
  }
}

function markerComment(now) {
  return [
    'This item has been inactive for ' + Number(policy.daysBeforeStale || 14) + ' days.',
    'Comment or add the keep-me label to keep it open. Items requiring review, security attention or CI repair are exempt.',
    '',
    MARKER_PREFIX + now.toISOString() + ' -->'
  ].join('\n');
}

async function findMarkerComment(fullName, number) {
  const comments = await listAll('/repos/' + fullName + '/issues/' + number + '/comments');
  const marked = comments
    .map(comment => ({ comment, date: parseStaleMarker(comment.body) }))
    .filter(item => item.date)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  return marked[0] || null;
}

async function closeItem(fullName, item, isPullRequest) {
  await request('/repos/' + fullName + '/issues/' + item.number + '/comments', {
    method: 'POST',
    body: { body: 'Closing this item after the organization stale window. Reopen it at any time with new information.' }
  });
  if (isPullRequest) {
    await request('/repos/' + fullName + '/pulls/' + item.number, {
      method: 'PATCH',
      body: { state: 'closed' }
    });
  } else {
    await request('/repos/' + fullName + '/issues/' + item.number, {
      method: 'PATCH',
      body: { state: 'closed', state_reason: 'not_planned' }
    });
  }
}

async function processItem(repo, item, now) {
  const fullName = repo.full_name;
  const isPullRequest = Boolean(item.pull_request);
  const current = isPullRequest ? { ...item, ...(await request('/repos/' + fullName + '/pulls/' + item.number)), pull_request: item.pull_request } : item;
  const labels = labelNames(current);
  const hasStaleLabel = labels.has('stale');
  if (current.draft || current.locked) {
    if (hasStaleLabel) await removeStaleLabel(fullName, current.number);
    console.log('[stale-exempt]', fullName + '#' + current.number, current.draft ? 'draft PR' : 'locked item');
    return;
  }

  if (!hasStaleLabel) {
    if (staleDecision(current, null, now) !== 'mark') return;
    await addStaleLabel(fullName, item.number);
    await request('/repos/' + fullName + '/issues/' + item.number + '/comments', {
      method: 'POST',
      body: { body: markerComment(now) }
    });
    console.log('[stale-marked]', fullName + '#' + item.number, isPullRequest ? 'PR' : 'issue');
    return;
  }

  const marker = await findMarkerComment(fullName, current.number);
  if (!marker) {
    // Legacy stale labels have no timestamp, so start a fresh and explicit grace period.
    await request('/repos/' + fullName + '/issues/' + item.number + '/comments', {
      method: 'POST',
      body: { body: markerComment(now) }
    });
    console.log('[stale-marker-added]', fullName + '#' + item.number, 'legacy label; grace period starts now');
    return;
  }

  const decision = staleDecision(current, marker.date, now);
  if (decision === 'exempt' || decision === 'reactivated') {
    await removeStaleLabel(fullName, item.number);
    console.log('[stale-cleared]', fullName + '#' + item.number, decision);
  } else if (decision === 'close') {
    await closeItem(fullName, current, isPullRequest);
    console.log('[stale-closed]', fullName + '#' + item.number);
  }
}

async function run() {
  const repositories = await listAll('/orgs/' + ORG + '/repos?type=all');
  const active = repositories.filter(repo => !repo.archived && !repo.fork && !config.ignoredRepositories.includes(repo.name));
  const now = new Date();
  let inspected = 0;
  let failures = 0;
  console.log('[stale] scanning ' + active.length + ' active repositories');
  for (const repo of active) {
    try {
      const items = await listAll('/repos/' + repo.full_name + '/issues?state=open');
      for (const item of items) {
        try {
          await processItem(repo, item, now);
          inspected += 1;
        } catch (error) {
          failures += 1;
          console.warn('[stale-item-error]', repo.full_name + '#' + item.number, error.message);
        }
      }
    } catch (error) {
      failures += 1;
      console.warn('[stale-repo-error]', repo.full_name, error.message);
    }
  }
  console.log('[stale] inspected ' + inspected + ' items; failures=' + failures);
  if (failures) throw new Error('Stale reconciliation had ' + failures + ' item/repository failures');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => {
    console.error('[stale-fatal]', error);
    process.exitCode = 1;
  });
}
