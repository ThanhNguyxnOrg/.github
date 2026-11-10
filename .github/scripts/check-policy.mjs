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
 * gate. Every configured check must exist and every matching instance must
 * complete successfully; skipped/neutral required checks are not green.
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
    const matches = kind === 'status'
      ? contexts.filter(item => String(item.context || '') === name)
      : runs.filter(item => String(item.name || '') === name);

    if (!matches.length) {
      missing.push(name);
      continue;
    }

    if (kind === 'status') {
      const failedMatches = matches.some(item => !['success', 'pending'].includes(String(item.state || '').toLowerCase()));
      const pendingMatches = matches.some(item => String(item.state || '').toLowerCase() === 'pending');
      if (failedMatches) failed.push(name);
      else if (pendingMatches) pending.push(name);
    } else {
      const pendingMatches = matches.some(item => String(item.status || '').toLowerCase() !== 'completed');
      if (pendingMatches) {
        pending.push(name);
        continue;
      }
      const failedMatches = matches.some(item => String(item.conclusion || '').toLowerCase() !== 'success');
      if (failedMatches) failed.push(name);
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
