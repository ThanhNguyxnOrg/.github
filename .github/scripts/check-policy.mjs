import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('../../ci-policy.json', import.meta.url), 'utf8'));

export function getRepositoryProfile(repoName) {
  return config.repositories?.[repoName] || null;
}

function globToRegExp(pattern) {
  const value = String(pattern || '').replace(/\\/g, '/');
  let source = '';

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '*' && value[index + 1] === '*') {
      if (value[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }

  return new RegExp('^' + source + '$');
}

export function matchesPathPattern(path, pattern) {
  return globToRegExp(pattern).test(String(path || '').replace(/\\/g, '/'));
}

function activityTimestamp(item) {
  const value = Date.parse(item.created_at || item.started_at || item.updated_at || item.completed_at || '');
  return Number.isNaN(value) ? 0 : value;
}

function latestAttempt(items) {
  return [...items].sort((a, b) => activityTimestamp(a) - activityTimestamp(b) || Number(a.id || 0) - Number(b.id || 0)).at(-1) || null;
}

function isCheckApplicable(spec, changedFiles) {
  const include = Array.isArray(spec.paths) ? spec.paths : [];
  const exclude = Array.isArray(spec.excludePaths) ? spec.excludePaths : [];
  if (!include.length && !exclude.length) return true;
  if (!Array.isArray(changedFiles)) return null;

  const normalized = changedFiles.map(path => String(path).replace(/\\/g, '/'));
  const included = !include.length || normalized.some(path => include.some(pattern => matchesPathPattern(path, pattern)));
  const excluded = exclude.length > 0 && normalized.some(path => exclude.some(pattern => matchesPathPattern(path, pattern)));
  return included && !excluded;
}

/**
 * Evaluate only the explicitly required checks for the changed files.
 * Unlisted check-runs are informational and cannot block an otherwise-valid
 * gate. The newest attempt for each configured check name is authoritative,
 * so a successful rerun supersedes an older failed attempt. Skipped/neutral
 * required checks are not green.
 */
export function evaluateRequiredChecks(checkRuns = [], statuses = {}, requiredChecks = [], changedFiles = undefined) {
  const required = Array.isArray(requiredChecks) ? requiredChecks : [];
  if (!required.length) {
    return { state: 'unconfigured', missing: [], failed: [], pending: [], required: [] };
  }

  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  const contexts = Array.isArray(statuses?.statuses) ? statuses.statuses : [];
  const failed = [];
  const pending = [];
  const missing = [];
  const applicable = [];
  let cannotEvaluatePaths = false;

  for (const entry of required) {
    const spec = typeof entry === 'string' ? { name: entry, kind: 'check_run' } : entry;
    const name = String(spec?.name || '');
    const kind = spec?.kind || 'check_run';
    if (!name || !['check_run', 'status'].includes(kind)) {
      missing.push('(invalid required check definition)');
      continue;
    }

    const applies = isCheckApplicable(spec, changedFiles);
    if (applies === null) {
      cannotEvaluatePaths = true;
      missing.push(name + ' (changed-file context unavailable)');
      continue;
    }
    if (!applies) continue;

    applicable.push({ name, kind });
    const candidates = kind === 'status'
      ? contexts.filter(item => String(item.context || '') === name)
      : runs.filter(item => String(item.name || '') === name);
    const matches = spec.appSlug ? candidates.filter(item => String(item.app?.slug || '') === String(spec.appSlug)) : candidates;
    const latest = latestAttempt(matches);
    if (!latest) {
      missing.push(name);
      continue;
    }
    if (kind === 'status') {
      const state = String(latest.state || '').toLowerCase();
      if (state === 'pending') pending.push(name);
      else if (state !== 'success') failed.push(name);
    } else {
      const status = String(latest.status || '').toLowerCase();
      if (status !== 'completed') pending.push(name);
      else if (String(latest.conclusion || '').toLowerCase() !== 'success') failed.push(name);
    }
  }

  if (!applicable.length && !cannotEvaluatePaths) {
    missing.push('No required checks apply to the changed files');
  }

  const unique = values => [...new Set(values)];
  const result = {
    state: 'success',
    missing: unique(missing),
    failed: unique(failed),
    pending: unique(pending),
    required: applicable.map(item => item.name)
  };

  if (result.failed.length) result.state = 'failure';
  else if (result.pending.length) result.state = 'pending';
  else if (result.missing.length) result.state = cannotEvaluatePaths ? 'unconfigured' : 'missing';

  return result;
}
