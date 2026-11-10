import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('../../ci-policy.json', import.meta.url), 'utf8'));

export function getRepositoryProfile(repoName) {
  return config.repositories?.[repoName] || null;
}

export function evaluateRequiredChecks(checkRuns = [], statuses = {}, requiredChecks = []) {
  const required = Array.isArray(requiredChecks) ? requiredChecks : [];
  if (!required.length) return { state: 'unconfigured', missing: [], failed: [], pending: [], required: [] };

  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  const contexts = Array.isArray(statuses?.statuses) ? statuses.statuses : [];
  const bad = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale', 'error']);
  const acceptableOptional = new Set(['success', 'neutral', 'skipped']);
  const failed = [];
  const pending = [];
  const missing = [];

  for (const run of runs) {
    const name = String(run.name || '(unnamed check)');
    const status = String(run.status || '').toLowerCase();
    const conclusion = String(run.conclusion || '').toLowerCase();
    if (bad.has(conclusion)) failed.push(name);
    else if (status !== 'completed') pending.push(name);
    else if (!acceptableOptional.has(conclusion)) missing.push(name);
  }
  for (const status of contexts) {
    const name = String(status.context || '(unnamed status)');
    const state = String(status.state || '').toLowerCase();
    if (state === 'failure' || state === 'error') failed.push(name);
    else if (state === 'pending') pending.push(name);
    else if (state !== 'success') missing.push(name);
  }

  for (const entry of required) {
    const spec = typeof entry === 'string' ? { name: entry, kind: 'check_run' } : entry;
    const name = String(spec?.name || '');
    const kind = spec?.kind || 'check_run';
    if (!name) { missing.push('(invalid required check definition)'); continue; }
    const matches = kind === 'status'
      ? contexts.filter(item => String(item.context || '') === name)
      : runs.filter(item => String(item.name || '') === name);
    if (!matches.length) { missing.push(name); continue; }
    const allSucceeded = kind === 'status'
      ? matches.every(item => String(item.state || '').toLowerCase() === 'success')
      : matches.every(item => String(item.status || '').toLowerCase() === 'completed' && String(item.conclusion || '').toLowerCase() === 'success');
    if (!allSucceeded) {
      const isPending = kind === 'status'
        ? matches.some(item => String(item.state || '').toLowerCase() === 'pending')
        : matches.some(item => String(item.status || '').toLowerCase() !== 'completed');
      if (isPending) pending.push(name);
      else failed.push(name);
    }
  }

  const unique = values => [...new Set(values)];
  const result = { state: 'success', missing: unique(missing), failed: unique(failed), pending: unique(pending), required: required.map(entry => typeof entry === 'string' ? entry : entry.name) };
  if (result.failed.length) result.state = 'failure';
  else if (result.pending.length) result.state = 'pending';
  else if (result.missing.length || (!runs.length && !contexts.length)) result.state = 'missing';
  return result;
}
