import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { evaluateRequiredChecks, getRepositoryProfile, matchesPathPattern } from './check-policy.mjs';

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
  const token = process.env.GH_TOKEN || TOKEN;
  if (!token) throw new Error('GH_TOKEN is required');
  const response = await fetch(API + path, {
    method: options.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
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
  // GitHub Actions/CodeRabbit checks are commonly attached to the PR head.
  // Prefer that SHA; the synthetic merge SHA is only a fallback when no head SHA is exposed.
  const headSha = String(pullRequest?.head?.sha || '').trim();
  if (/^[0-9a-f]{40}$/i.test(headSha)) return headSha;

  const mergeSha = String(pullRequest?.merge_commit_sha || '').trim();
  return /^[0-9a-f]{40}$/i.test(mergeSha) ? mergeSha : null;
}

function isBot(login) {
  return typeof login === 'string' && login.toLowerCase().endsWith('[bot]');
}

function textForRiskSignals(value) {
  return String(value || '')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/\[([^\]]+)\]\((?:<)?https?:\/\/[^)\s>]+(?:>)?\)/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ');
}

function hasSecuritySignal(value) {
  const text = textForRiskSignals(value);
  return /\b(?:security[\s-]+(?:fix|advisory|patch|vulnerabilit(?:y|ies)|issue)|vulnerabilit(?:y|ies)|CVE-\d{4}-\d+|GHSA-[\w-]+|remote code execution|privilege escalation|authentication bypass|exploit(?:s|ed|ation)?)\b/i.test(text);
}

export function classifyPullRequestLabels(pullRequest, changedFiles = []) {
  const title = String(pullRequest?.title || '');
  const body = String(pullRequest?.body || '');
  const author = String(pullRequest?.user?.login || '').toLowerCase();
  const text = title + '\n' + body;
  const paths = changedFiles.map(path => String(path).toLowerCase());
  const labels = new Set();
  const dependencyBot = author === 'dependabot[bot]' || author === 'renovate[bot]';

  if (isBot(author)) labels.add('automated');
  if (dependencyBot || /\b(dependencies|dependency|bump|update package|update action)\b/i.test(title)) {
    labels.add('dependencies');
  }
  if (dependencyBot && ['major', 'downgrade'].includes(classifyVersionUpdate(dependencySummary(pullRequest)))) {
    labels.add('major-update');
  }
  const riskBody = dependencyBot ? dependencySummary(pullRequest) : body;
  const riskText = dependencyBot ? dependencySummary(pullRequest) : text;
  const plainText = riskText.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ');
  if (/^[a-z][a-z0-9-]*(?:\([^)]*\))?!:/i.test(title) ||
      /\b(?:breaking\s*:|breaking changes?|backward[- ]incompatible)/i.test(plainText)) {
    labels.add('breaking');
  }
  if (hasSecuritySignal(riskText)) {
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

function parseVersionCore(value, allowBuildMetadata = false) {
  const normalized = String(value || '').trim().replace(/^[vV]/, '');
  // PEP 440 epochs, prereleases, post/dev releases and local versions need
  // PEP 440 ordering. Fail closed instead of comparing only their release tuple.
  // Cargo's SemVer build metadata is the exception: it does not affect precedence.
  if (/^\d+!/.test(normalized)) return null;
  const pattern = allowBuildMetadata
    ? /^(\d+(?:\.\d+){0,2})(?:\+[0-9A-Za-z.-]+)?$/
    : /^(\d+(?:\.\d+){0,2})$/;
  const match = normalized.match(pattern);
  if (!match) return null;
  const parts = match[1].split('.').map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) return null;
  while (parts.length < 3) parts.push(0);
  return parts;
}

function stripMarkdownVersionEmphasis(value) {
  let text = String(value || '').trim();
  // Strip only a wrapper around the complete version token, never an internal wildcard.
  for (const marker of ['**', '__', '*', '_']) {
    if (text.startsWith(marker) && text.endsWith(marker) && text.length > marker.length * 2) {
      return text.slice(marker.length, -marker.length);
    }
  }
  return text;
}

function extractVersionSpecifiers(value) {
  const text = String(value || '').replace(new RegExp(String.fromCharCode(96), 'g'), '').trim();
  // PEP 440 epochs must never be partially consumed as a numeric prefix.
  if (/\b\d+!/.test(text)) return null;

  // Parse every comma-separated comparator completely. Unsupported npm range
  // operators and wildcard tokens must fail closed instead of being stripped.
  const comparatorPattern = /^(===|==|~=|>=|<=|!=|>|<)?\s*/;
  const versionPattern = /^[vV]?(\d+(?:\.\d+){0,2}(?:[-_.]?[A-Za-z][0-9A-Za-z._-]*)?(?:\+[0-9A-Za-z.-]+)?)$/;
  const rawParts = text.split(',');
  if (!rawParts.length) return null;

  const matches = [];
  for (const rawPart of rawParts) {
    const part = rawPart.trim();
    const prefix = part.match(comparatorPattern);
    const operator = prefix?.[1] || '';
    let version = part.slice(prefix?.[0].length || 0).trim();
    // Remove sentence punctuation, but leave a terminal X-range wildcard intact.
    // Trim sentence punctuation before removing paired Markdown emphasis wrappers.
    if (version.endsWith('.') && !version.endsWith('.*')) version = version.slice(0, -1);
    version = stripMarkdownVersionEmphasis(version);
    // Wildcard suffixes remain untouched and fail the supported-token check.
    const versionMatch = version.match(versionPattern);
    if (!versionMatch) return null;
    matches.push({ operator, version: versionMatch[1] || versionMatch[0] });
  }
  return matches.length ? matches : null;
}

function classifySpecifierPair(oldSpecifier, newSpecifier, allowBuildMetadata = false) {
  const oldParts = extractVersionSpecifiers(oldSpecifier);
  const newParts = extractVersionSpecifiers(newSpecifier);
  if (!oldParts || !newParts || oldParts.length !== newParts.length) return 'unknown';

  // A plain SemVer pair has no comparator.
  if (oldParts.length === 1 && newParts.length === 1 &&
      oldParts[0].operator === '' && newParts[0].operator === '') {
    return classifyVersionPair(oldParts[0].version, newParts[0].version, allowBuildMetadata);
  }

  // Compound specifiers may be reordered. Match unchanged comparator/version
  // pairs first, then allow exactly one supported bound to move. Changes to an
  // upper bound, exclusion, or comparator shape are ambiguous and fail closed.
  const unmatchedNew = [...newParts];
  const unmatchedOld = [];
  for (const oldPart of oldParts) {
    const index = unmatchedNew.findIndex(newPart =>
      newPart.operator === oldPart.operator && newPart.version === oldPart.version
    );
    if (index >= 0) unmatchedNew.splice(index, 1);
    else unmatchedOld.push(oldPart);
  }

  if (unmatchedOld.length === 0 && unmatchedNew.length === 0) return 'unchanged';
  if (unmatchedOld.length !== 1 || unmatchedNew.length !== 1) return 'unknown';
  const oldPart = unmatchedOld[0];
  const newPart = unmatchedNew[0];
  if (oldPart.operator !== newPart.operator ||
      !['>=', '>', '==', '===', '~='].includes(oldPart.operator)) {
    return 'unknown';
  }
  return classifyVersionPair(oldPart.version, newPart.version, allowBuildMetadata);
}

function classifyVersionPair(oldVersion, newVersion, allowBuildMetadata = false) {
  const oldParts = parseVersionCore(oldVersion, allowBuildMetadata);
  const newParts = parseVersionCore(newVersion, allowBuildMetadata);
  if (!oldParts || !newParts) return 'unknown';
  if (newParts.every((part, index) => part === oldParts[index])) return 'unchanged';
  if (newParts[0] > oldParts[0]) return 'major';
  if (newParts[0] < oldParts[0]) return 'downgrade';
  if (newParts[1] > oldParts[1]) return oldParts[0] === 0 ? 'major' : 'minor';
  if (newParts[1] < oldParts[1]) return 'downgrade';
  return newParts[2] > oldParts[2] ? 'patch' : 'downgrade';
}

export function classifyVersionUpdate(value) {
  const text = String(value || '');
  const classifications = [];
  const allowCargoBuildMetadata = /\b(?:cargo|rust|src-tauri)\b/i.test(text);

  // Supports ordinary SemVer pairs and compound Python constraints such as
  // "from <1.0,>=0.17.4 to >=0.17.5,<1.0".
  const fromToPattern = /\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+\b(?:in|for|with|which|that)\b|[\r\n]|$)/gi;
  // Version-pair prose is parsed separately from Markdown tables; otherwise
  // the table header "From | To" can look like a malformed dependency pair.
  const proseText = text.split(/\r?\n/).filter(line => {
    const trimmed = line.trim();
    // Markdown table rows have multiple cell separators. Do not discard npm
    // range alternatives ("||") in ordinary prose; their unsupported syntax
    // must reach extractVersionSpecifiers and become unknown.
    return !(trimmed.includes('|') && !trimmed.includes('||') &&
      (trimmed.startsWith('|') && trimmed.endsWith('|') || trimmed.split('|').length >= 3));
  }).join('\n');
  for (const match of proseText.matchAll(fromToPattern)) {
    classifications.push(
      classifySpecifierPair(match[1], match[2], allowCargoBuildMetadata)
    );
  }

  // Dependabot grouped npm/Rust PRs commonly include a Markdown version table.
  // Parse contiguous table blocks as a unit. For headerless tables, first detect
  // whether ANY row looks like a version row; only then classify every row.
  // This prevents an unparseable first member (for example, "unknown | latest")
  // from being silently dropped just because a later member is a valid patch.
  const lines = text.split(/\r?\n/);
  const oldHeaders = new Set(['from', 'current', 'previous', 'old', 'installed']);
  const newHeaders = new Set(['to', 'latest', 'new', 'updated']);
  const isSeparatorRow = cells => cells.every(cell => /^:?-{3,}:?$/.test(cell));
  const isUnknownVersionMarker = value =>
    /^(?:unknown|latest|unavailable|not\s+available|n\/?a|undefined|null)$/i.test(
      String(value || '').replace(/[\x60*_]/g, '').trim()
    );
  const isWildcardVersionRange = value => {
    const normalized = String(value || '')
      .replace(new RegExp(String.fromCharCode(96), 'g'), '')
      .trim()
      // Strip paired Markdown emphasis wrappers, but retain inner wildcard markers.
      .replace(/(^|[=><!~^,|\s])(\*\*|__)([^,|\s]+?)\2(?=$|[,|\s])/g, '$1$3')
      .replace(/(^|[=><!~^,|\s])\*([^,|\s]+?)\*(?=$|[,|\s])/g, '$1$2')
      .replace(/(^|[=><!~^,|\s])_([^,|\s]+?)_(?=$|[,|\s])/g, '$1$2');
    // Find npm X-range components anywhere in a comparator expression,
    // including compound constraints like ">=1.0,==1.2.*".
    return /(?:^|[=><!~^,|_\s])(?:[vV]?(?:\d+|[xX*])(?:\.(?:\d+|[xX*]))*)_*(?=$|[,|\s])/i.test(normalized) &&
      /[xX*]/i.test(normalized);
  };

  for (let lineIndex = 0; lineIndex < lines.length;) {
    if (!lines[lineIndex].includes('|')) {
      lineIndex += 1;
      continue;
    }

    const tableRows = [];
    while (lineIndex < lines.length && lines[lineIndex].includes('|')) {
      const cells = lines[lineIndex].split('|').map(cell => cell.trim()).filter(Boolean);
      if (cells.length >= 3) tableRows.push(cells);
      lineIndex += 1;
    }
    if (!tableRows.length) continue;

    const headerIndex = tableRows.findIndex(cells => {
      const oldColumn = cells.at(-2).replace(/[\x60*_]/g, '').trim().toLowerCase();
      const newColumn = cells.at(-1).replace(/[\x60*_]/g, '').trim().toLowerCase();
      return oldHeaders.has(oldColumn) && newHeaders.has(newColumn);
    });
    const dataRows = headerIndex >= 0 ? tableRows.slice(headerIndex + 1) : tableRows;
    if (!dataRows.length) continue;

    const looksLikeVersionTable = headerIndex >= 0 || dataRows.some(cells => {
      if (isSeparatorRow(cells)) return false;
      const oldValue = cells.at(-2);
      const newValue = cells.at(-1);
      const rowRisk = classifySpecifierPair(oldValue, newValue, allowCargoBuildMetadata);
      return rowRisk !== 'unknown' ||
        isUnknownVersionMarker(oldValue) || isUnknownVersionMarker(newValue) ||
        isWildcardVersionRange(oldValue) || isWildcardVersionRange(newValue);
    });
    if (!looksLikeVersionTable) continue;

    for (const cells of dataRows) {
      if (isSeparatorRow(cells)) continue;
      classifications.push(
        classifySpecifierPair(cells.at(-2), cells.at(-1), allowCargoBuildMetadata)
      );
    }
  }

  if (!classifications.length) return 'unknown';
  if (classifications.includes('major')) return 'major';
  if (classifications.includes('downgrade')) return 'downgrade';
  // One unparseable pair in a grouped update must not be hidden by another
  // successfully parsed patch/minor pair.
  if (classifications.includes('unknown')) return 'unknown';
  if (classifications.includes('minor')) return 'minor';
  if (classifications.includes('patch')) return 'patch';
  return 'unchanged';
}

function dependencySummary(pullRequest) {
  const title = String(pullRequest?.title || '');
  const body = String(pullRequest?.body || '');
  const detailsIndex = body.search(/<details\b/i);
  const summary = detailsIndex >= 0 ? body.slice(0, detailsIndex) : body;
  return title + '\n' + summary.slice(0, 16000);
}

export function isDependencyManifestPath(path) {
  const normalized = String(path || '').replace(/\\/g, '/').toLowerCase();
  const basename = normalized.split('/').at(-1) || '';
  if (normalized.startsWith('.github/workflows/') || normalized.startsWith('.github/actions/')) return false;
  const isNestedRequirementsFile = /^requirements\/.+\.txt$/i.test(normalized);
  if (isNestedRequirementsFile) return true;
  return /^(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|cargo\.toml|cargo\.lock|go\.mod|go\.sum|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|pipfile(?:\.lock)?|composer\.json|composer\.lock|gemfile(?:\.lock)?|directory\.packages\.props|packages\.lock\.json|packages\.config)$/i.test(basename)
    || /\.(?:csproj|fsproj|vbproj)$/i.test(basename);
}

export function analyzeDependencyUpdate(pullRequest, changedFiles = []) {
  const author = String(pullRequest?.user?.login || '').toLowerCase();
  const title = String(pullRequest?.title || '');
  const summary = dependencySummary(pullRequest);
  const body = String(pullRequest?.body || '');
  const plainBody = summary.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ');
  const versionRisk = classifyVersionUpdate(summary);
  const reasons = [];

  if (author !== 'dependabot[bot]') reasons.push('not-dependabot');
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) reasons.push('changed-files-unavailable');
  else if (!changedFiles.every(isDependencyManifestPath)) reasons.push('non-dependency-files');
  if (!['patch', 'minor'].includes(versionRisk)) reasons.push('version-risk-' + versionRisk);
  if (/\b(?:breaking(?:\s+changes?)?|backward[- ]incompatible)\b/i.test(plainBody)) {
    reasons.push('breaking-release-notes');
  }
  if (hasSecuritySignal(summary)) {
    reasons.push('security-update');
  }

  return { eligible: reasons.length === 0, versionRisk, reasons: [...new Set(reasons)], summary };
}

export function assessPullRequestRisk(pullRequest, changedFiles = [], repositoryConfig = {}) {
  const labels = new Set(classifyPullRequestLabels(pullRequest, changedFiles));
  const reasons = [];
  for (const label of ['breaking', 'security', 'major-update', 'workflow-update', 'release', 'triage-needed']) {
    if (labels.has(label)) reasons.push(label);
  }
  if (hasSensitivePath(changedFiles, repositoryConfig.sensitivePaths || [])) reasons.push('sensitive-path');

  let dependency = null;
  if (String(pullRequest?.user?.login || '').toLowerCase() === 'dependabot[bot]') {
    dependency = analyzeDependencyUpdate(pullRequest, changedFiles);
    reasons.push(...dependency.reasons.filter(reason => reason !== 'not-dependabot'));
  }
  return {
    requiresHumanReview: reasons.length > 0,
    reasons: [...new Set(reasons)],
    dependency,
    labels: [...labels]
  };
}

export function requiredCheckReviewReason(state) {
  if (state === 'failure') return 'required-checks-failure';
  if (state === 'missing') return 'required-checks-missing';
  if (state === 'unconfigured') return 'required-checks-unconfigured';
  if (state === 'not-applicable') return 'required-checks-not-applicable';
  return null;
}

export function isAutoMergeCheckReady(state) {
  return state === 'success';
}

export function isPolicyAutoMergeScope(pullRequest, changedFiles = [], profile = {}) {
  const rule = profile?.autoMerge;
  if (!rule || typeof rule !== 'object') return false;

  const author = String(pullRequest?.user?.login || '').toLowerCase();
  if (rule.author && author !== String(rule.author).trim().toLowerCase()) return false;

  const branch = String(pullRequest?.head?.ref || '');
  if (rule.branchPrefix && !branch.startsWith(String(rule.branchPrefix))) return false;

  if (rule.sameRepository === true) {
    const headRepository = String(pullRequest?.head?.repo?.full_name || '').toLowerCase();
    const baseRepository = String(pullRequest?.base?.repo?.full_name || '').toLowerCase();
    if (!headRepository || !baseRepository || headRepository !== baseRepository) return false;
  }

  const allowedPaths = Array.isArray(rule.paths) ? rule.paths : [];
  if (!allowedPaths.length || !Array.isArray(changedFiles) || !changedFiles.length) return false;
  return changedFiles.every(path =>
    allowedPaths.some(pattern => matchesPathPattern(path, pattern))
  );
}

export function domainVerificationState(pullRequest, profile = {}, changedFiles = undefined) {
  const labels = names(pullRequest?.labels);
  const pendingLabel = String(profile.pendingLabel || '').trim().toLowerCase();
  const reviewHoldLabel = String(profile.reviewHoldLabel || '').trim().toLowerCase();
  if (pendingLabel && labels.has(pendingLabel)) return 'pending';
  if (reviewHoldLabel && labels.has(reviewHoldLabel)) return 'review';

  const rule = profile?.autoMerge;
  const optInLabel = String(rule?.label || '').trim().toLowerCase();
  if (rule?.deferUntilHandoff === true &&
      optInLabel && !labels.has(optInLabel) &&
      isPolicyAutoMergeScope(pullRequest, changedFiles, profile)) {
    return 'pending';
  }
  return 'ready';
}

export function isPolicyAutoMergeCandidate(pullRequest, changedFiles = [], profile = {}) {
  const rule = profile?.autoMerge;
  const requiredLabel = String(rule?.label || '').trim().toLowerCase();
  return Boolean(requiredLabel &&
    names(pullRequest?.labels).has(requiredLabel) &&
    isPolicyAutoMergeScope(pullRequest, changedFiles, profile));
}

export function reconcilePolicyTriageReason(reasons = [], authorizedCandidate = false, profile = {}) {
  const next = [...reasons];
  if (!authorizedCandidate || profile?.autoMerge?.allowTriageBypass !== true) return next;
  return next.filter(reason => reason !== 'triage-needed');
}

export function buildEnablePullRequestAutoMergeRequest(pullRequest, mergeMethod) {
  if (!pullRequest?.node_id) throw new Error('PR node_id is unavailable for Auto-merge');
  if (!pullRequest?.head?.sha) throw new Error('Validated PR head SHA is unavailable for Auto-merge');
  return {
    query: 'mutation($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!, $expectedHeadOid: GitObjectID!) { enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod, expectedHeadOid: $expectedHeadOid }) { pullRequest { number autoMergeRequest { enabledAt mergeMethod } } } }',
    variables: {
      pullRequestId: pullRequest.node_id,
      mergeMethod: String(mergeMethod || 'squash').toUpperCase(),
      expectedHeadOid: pullRequest.head.sha
    }
  };
}

export function expandChangedFilePaths(files = []) {
  return files.flatMap(file =>
    [file?.filename, file?.previous_filename]
      .filter(path => typeof path === 'string' && path.length > 0)
  );
}

export function getBlockingPullRequestLabels(pullRequest, blockingLabels = config.blockingLabels || []) {
  const present = names(pullRequest?.labels);
  const configured = [
    ...new Set([
      ...blockingLabels.filter(label => String(label || '').trim().toLowerCase() !== 'needs-review'),
      'do-not-merge',
      'breaking-change',
      'wip',
      'pinned'
    ].map(label => String(label || '').trim().toLowerCase()).filter(Boolean))
  ];
  return configured.filter(label => present.has(label));
}

export function shouldDisableAutoMergeForDeferredState(pullRequest, { headChanged = false, baseChanged = false, verificationPending = false } = {}) {
  return Boolean(pullRequest?.auto_merge && pullRequest?.node_id && (headChanged || baseChanged || verificationPending));
}

export function shouldDisableAutoMergeForKnownReviewHold(pullRequest, riskReasons = []) {
  return Boolean(pullRequest?.auto_merge && pullRequest?.node_id && Array.isArray(riskReasons) && riskReasons.length > 0);
}

export function evaluateCheckRollup(checkRuns = [], statuses = {}, requiredChecks = []) {
  return evaluateRequiredChecks(checkRuns, statuses, requiredChecks).state;
}

export function assessReviewFeedback(reviews = [], reviewThreads = []) {
  // Only the latest submitted review from each reviewer is authoritative.
  const latestByReviewer = new Map();
  for (const review of reviews) {
    const login = String(review?.user?.login || '');
    if (!login) continue;
    const previous = latestByReviewer.get(login);
    const timestamp = Date.parse(review?.submitted_at || review?.submittedAt || '') || 0;
    const previousTimestamp = previous
      ? (Date.parse(previous?.submitted_at || previous?.submittedAt || '') || 0)
      : -1;
    if (!previous || timestamp >= previousTimestamp) latestByReviewer.set(login, review);
  }
  const changesRequested = [...latestByReviewer.values()].some(review =>
    String(review?.state || '').toUpperCase() === 'CHANGES_REQUESTED'
  );
  const unresolvedThreads = reviewThreads.filter(thread => thread?.isResolved !== true).length;
  const reasons = [];
  if (changesRequested) reasons.push('changes-requested');
  if (unresolvedThreads > 0) reasons.push('unresolved-review-threads');
  return {
    requiresHumanReview: reasons.length > 0,
    reasons,
    unresolvedThreads
  };
}

async function getReviewFeedback(fullName, number) {
  const [owner, name] = fullName.split('/');
  if (!owner || !name) throw new Error('Invalid repository name for review lookup');

  const reviews = await listAll('/repos/' + fullName + '/pulls/' + number + '/reviews');
  const threads = [];
  let after = null;

  for (let page = 1; page <= 10; page += 1) {
    const response = await request('/graphql', {
      method: 'POST',
      body: {
        query: `query($owner: String!, $name: String!, $number: Int!, $after: String) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              reviewThreads(first: 100, after: $after) {
                nodes { isResolved }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }`,
        variables: { owner, name, number, after }
      }
    });
    if (Array.isArray(response.errors) && response.errors.length) {
      throw new Error(response.errors.map(item => item.message || 'GraphQL review lookup failed').join('; '));
    }
    const connection = response.data?.repository?.pullRequest?.reviewThreads;
    if (!connection) throw new Error('GitHub did not return pull request review threads');
    threads.push(...(connection.nodes || []));
    if (!connection.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor;
    if (!after || page === 10) throw new Error('Review-thread pagination limit reached');
  }

  return assessReviewFeedback(reviews, threads);
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


function managedReviewerNames() {
  return [...new Set([...(config.reviewers || []), ...(config.legacyReviewers || [])])];
}

async function reconcileReviewRouting(fullName, item, keepReviewers = []) {
  const keep = new Set(keepReviewers.map(name => name.toLowerCase()));
  const managed = new Set(managedReviewerNames().map(name => name.toLowerCase()));
  const obsolete = [...managed].filter(name => !keep.has(name));
  const requested = (item.requested_reviewers || []).map(user => user.login)
    .filter(name => obsolete.includes(name.toLowerCase()));
  const assigned = (item.assignees || []).map(user => user.login)
    .filter(name => obsolete.includes(name.toLowerCase()));

  if (requested.length) {
    try {
      await request('/repos/' + fullName + '/pulls/' + item.number + '/requested_reviewers', {
        method: 'DELETE', body: { reviewers: requested }
      });
    } catch (error) {
      console.warn('[review-request-remove]', fullName + '#' + item.number, error.message);
    }
  }
  if (assigned.length) {
    try {
      await request('/repos/' + fullName + '/issues/' + item.number + '/assignees', {
        method: 'DELETE', body: { assignees: assigned }
      });
    } catch (error) {
      console.warn('[assignee-remove]', fullName + '#' + item.number, error.message);
    }
  }
}

function mergeMethodFor(repository, policy) {
  const configured = String(policy.mergeMethod || '').toLowerCase();
  if (['merge', 'squash', 'rebase'].includes(configured)) return configured;
  if (repository.allow_squash_merge === true) return 'squash';
  if (repository.allow_merge_commit === true) return 'merge';
  if (repository.allow_rebase_merge === true) return 'rebase';
  return null;
}

export function isTransientAutoMergeError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return /pull request.*unstable status|mergeability.*comput(?:e|ing)|checks? (?:are )?still (?:pending|running)|merge already in progress/i.test(message);
}

async function enablePullRequestAutoMerge(fullName, pullRequest, mergeMethod) {
  if (pullRequest.auto_merge) return;
  const autoMergeRequest = buildEnablePullRequestAutoMergeRequest(pullRequest, mergeMethod);
  const response = await request('/graphql', {
    method: 'POST',
    body: autoMergeRequest
  });
  if (Array.isArray(response.errors) && response.errors.length) {
    throw new Error(response.errors.map(item => item.message || 'GraphQL error').join('; '));
  }
  if (!response.data?.enablePullRequestAutoMerge?.pullRequest?.autoMergeRequest) {
    throw new Error('GitHub did not confirm that Auto-merge was enabled');
  }
}

async function disablePullRequestAutoMerge(fullName, pullRequest) {
  if (!pullRequest.auto_merge || !pullRequest.node_id) return;
  const response = await request('/graphql', {
    method: 'POST',
    body: {
      query: 'mutation($pullRequestId: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId }) { pullRequest { number } } }',
      variables: { pullRequestId: pullRequest.node_id }
    }
  });
  if (Array.isArray(response.errors) && response.errors.length) {
    throw new Error(response.errors.map(item => item.message || 'GraphQL error').join('; '));
  }
}

async function mergePullRequestNow(fullName, pullRequest, mergeMethod) {
  return request('/repos/' + fullName + '/pulls/' + pullRequest.number + '/merge', {
    method: 'PUT',
    body: { merge_method: mergeMethod, sha: pullRequest.head?.sha }
  });
}

async function getChangedFiles(fullName, number) {
  return listAll('/repos/' + fullName + '/pulls/' + number + '/files').then(expandChangedFilePaths);
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
      : (state === 'success' || state === 'not-applicable' ? null : 'ci-missing'));
  for (const label of labels) {
    if (label !== current) await removeLabel(fullName, number, label);
  }
  if (current) await addLabels(fullName, number,
    current === 'ci-failed' ? [current, 'needs-review'] : [current]);
}

export async function processPullRequest(repo, pr) {
  const fullName = repo.full_name;
  const repoName = repo.name;
  const dependencyBot = String(pr.user?.login || '').toLowerCase() === 'dependabot[bot]';
  const policy = repositoryPolicy(repoName);
  const profile = getRepositoryProfile(repoName);
  if (pr.draft) return;

  let paths = [];
  let pathsAvailable = true;
  try {
    paths = await getChangedFiles(fullName, pr.number);
  } catch (error) {
    pathsAvailable = false;
    console.warn('[files]', fullName + '#' + pr.number, error.message);
  }

  const verificationState = domainVerificationState(pr, profile, paths);

  const autoMergeCandidate = !dependencyBot && isPolicyAutoMergeCandidate(pr, paths, profile);
  let risk = assessPullRequestRisk(pr, paths, policy);
  const labels = new Set(classifyPullRequestLabels(pr, paths));
  const allowedBaseBranches = policy.allowedBaseBranches || [profile?.defaultBranch || repo.default_branch].filter(Boolean);
  let riskReasons = reconcilePolicyTriageReason(risk.reasons, autoMergeCandidate, profile);
  if (autoMergeCandidate && profile?.autoMerge?.allowSensitivePaths === true) {
    const sensitiveIndex = riskReasons.indexOf('sensitive-path');
    if (sensitiveIndex >= 0) riskReasons.splice(sensitiveIndex, 1);
  }
  if (verificationState === 'review') {
    riskReasons.push('domain-verification-review');
  }
  if (!allowedBaseBranches.includes(pr.base.ref)) riskReasons.push('target-branch-outside-policy');
  if (!pathsAvailable) riskReasons.push('changed-files-unavailable');
  if (verificationState !== 'pending') {
    await addLabels(fullName, pr.number, [...labels]);
  }

  // Reconcile stale risk labels previously created by broad security/version heuristics.
  // Only reconcile Dependabot PRs; preserve labels on human-authored PRs.
  if (String(pr.user?.login || '').toLowerCase() === 'dependabot[bot]') {
    const currentLabels = names(pr.labels);
    for (const label of ['security', 'breaking', 'major-update', 'workflow-update', 'release']) {
      if (currentLabels.has(label) && !labels.has(label)) {
        await removeLabel(fullName, pr.number, label);
      }
    }
  }

  let fresh;
  try {
    fresh = await request('/repos/' + fullName + '/pulls/' + pr.number);
  } catch (error) {
    console.warn('[pull]', fullName + '#' + pr.number, error.message);
    return;
  }
  const freshVerificationState = domainVerificationState(fresh, profile, paths);
  const headChanged = fresh.head?.sha !== pr.head.sha;
  const baseChanged = fresh.base?.ref !== pr.base.ref;
  if (headChanged || baseChanged) {
    if (shouldDisableAutoMergeForDeferredState(fresh, {
      headChanged,
      baseChanged,
      verificationPending: freshVerificationState === 'pending'
    })) {
      await disablePullRequestAutoMerge(fullName, fresh);
    }
    console.log('[defer]', fullName + '#' + pr.number + ': PR head or base changed during evaluation; any stale native Auto-merge was disabled and the current diff will be retried');
    return;
  }
  if (freshVerificationState === 'pending') {
    if (shouldDisableAutoMergeForDeferredState(fresh, { verificationPending: true })) {
      await disablePullRequestAutoMerge(fullName, fresh);
    }
    console.log('[domain-verification-wait]', fullName + '#' + pr.number + ': repository-specific verification is still pending; any stale native Auto-merge was disabled');
    return;
  }
  const freshAutoMergeCandidate = !dependencyBot && isPolicyAutoMergeCandidate(fresh, paths, profile);
  risk = assessPullRequestRisk(fresh, paths, policy);
  const refreshedRiskReasons = reconcilePolicyTriageReason(risk.reasons, freshAutoMergeCandidate, profile);
  if (freshAutoMergeCandidate && profile?.autoMerge?.allowSensitivePaths === true) {
    const sensitiveIndex = refreshedRiskReasons.indexOf('sensitive-path');
    if (sensitiveIndex >= 0) refreshedRiskReasons.splice(sensitiveIndex, 1);
  }
  if (freshVerificationState === 'review') refreshedRiskReasons.push('domain-verification-review');
  if (!allowedBaseBranches.includes(fresh.base.ref)) refreshedRiskReasons.push('target-branch-outside-policy');
  if (!pathsAvailable) refreshedRiskReasons.push('changed-files-unavailable');
  riskReasons.splice(0, riskReasons.length, ...refreshedRiskReasons);
  if (!dependencyBot && autoMergeCandidate && !freshAutoMergeCandidate &&
      profile?.autoMerge?.allowTriageBypass === true &&
      !riskReasons.includes('triage-needed')) {
    riskReasons.push('triage-needed');
  }

  for (const label of getBlockingPullRequestLabels(fresh)) {
    if (!riskReasons.includes(label)) riskReasons.push(label);
  }
  if (fresh.mergeable === false || fresh.mergeable_state === 'dirty') {
    riskReasons.push('merge-conflict');
    await addLabels(fullName, pr.number, ['merge-conflict']);
  } else if (fresh.mergeable === true) {
    await removeLabel(fullName, pr.number, 'merge-conflict');
  } else {
    if (shouldDisableAutoMergeForKnownReviewHold(fresh, riskReasons)) {
      await disablePullRequestAutoMerge(fullName, fresh);
    }
    if (dependencyBot && risk.dependency?.eligible && riskReasons.length === 0) {
      await addLabels(fullName, pr.number, ['automerge-pending']);
    }
    console.log('[defer]', fullName + '#' + pr.number + ': GitHub is still computing mergeability; native Auto-merge was disabled for any known review hold');
    return;
  }

  const checkSha = pullRequestCheckSha(fresh);
  const checkState = checkSha
    ? await getCheckState(fullName, checkSha, repoName, pathsAvailable ? paths : undefined)
    : 'unconfigured';
  await syncCheckLabels(fullName, pr.number, checkState);
  if (!dependencyBot && checkState === 'success' && freshVerificationState === 'review' && profile?.reviewHoldLabel) {
    // The current head's commit-bound domain status is green. A review-hold
    // label from an older, out-of-order workflow run is stale and can be cleared.
    const staleVerificationHold = String(profile.reviewHoldLabel).trim().toLowerCase();
    for (let index = riskReasons.length - 1; index >= 0; index -= 1) {
      if (riskReasons[index] === staleVerificationHold || riskReasons[index] === 'domain-verification-review') {
        riskReasons.splice(index, 1);
      }
    }
    await removeLabel(fullName, pr.number, profile.reviewHoldLabel);
  }

  const checkReviewReason = requiredCheckReviewReason(checkState);
  if (checkReviewReason) riskReasons.push(checkReviewReason);

  // Successful CI does not override an outstanding human or CodeRabbit review thread.
  // Query review state only when no earlier risk signal already requires human review.
  if (!riskReasons.length) {
    try {
      const reviewFeedback = await getReviewFeedback(fullName, pr.number);
      if (reviewFeedback.requiresHumanReview) riskReasons.push(...reviewFeedback.reasons);
    } catch (error) {
      // Fail closed rather than silently clearing a human-review hold when review state is unavailable.
      riskReasons.push('review-feedback-unavailable');
      console.warn('[review-feedback]', fullName + '#' + pr.number, error.message);
    }
  }


  const uniqueReasons = [...new Set(riskReasons)];

  if (uniqueReasons.length) {
    await addLabels(fullName, pr.number, ['needs-review']);
    await removeLabel(fullName, pr.number, 'automerge-pending');
    await removeLabel(fullName, pr.number, 'automerge');
    await removeLabel(fullName, pr.number, 'automerge-blocked');
    await disablePullRequestAutoMerge(fullName, fresh);
    await reconcileReviewRouting(fullName, pr, config.reviewers || []);
    await assignHumans(fullName, pr, true);
    console.log('[human-review-required]', fullName + '#' + pr.number + ': reasons=' + uniqueReasons.join(',') + '; checks=' + checkState);
    return;
  }

  // Low-risk changes stay out of the human-review queue. CodeRabbit continues independently.
  await removeLabel(fullName, pr.number, 'needs-review');
  await removeLabel(fullName, pr.number, 'automerge-blocked');
  await reconcileReviewRouting(fullName, pr, []);

  const dependency = dependencyBot
    ? (risk.dependency || analyzeDependencyUpdate(pr, paths))
    : null;

  if (dependencyBot && !dependency.eligible) {
    await removeLabel(fullName, pr.number, 'automerge-pending');
    await addLabels(fullName, pr.number, ['needs-review']);
    await reconcileReviewRouting(fullName, pr, config.reviewers || []);
    await assignHumans(fullName, pr, true);
    console.log('[human-review-required]', fullName + '#' + pr.number + ': Dependabot update is not eligible (' + dependency.reasons.join(',') + ')');
    return;
  }

  if (dependencyBot) {
    if (profile?.autoMergeDependabot !== true ||
        !Array.isArray(profile.requiredChecks) || profile.requiredChecks.length === 0) {
      await removeLabel(fullName, pr.number, 'automerge');
      await removeLabel(fullName, pr.number, 'automerge-pending');
      console.log('[auto-merge-disabled]', fullName + '#' + pr.number + ': repository is not explicitly opted in with required checks');
      return;
    }
  } else if (!freshAutoMergeCandidate) {
    const optInLabel = String(profile?.autoMerge?.label || 'automerge');
    await disablePullRequestAutoMerge(fullName, fresh);
    await removeLabel(fullName, pr.number, optInLabel);
    await removeLabel(fullName, pr.number, 'automerge-pending');
    console.log('[triaged]', fullName + '#' + pr.number + ': repository-specific auto-merge opt-in is no longer present on the latest PR state; native Auto-merge disabled');
    return;
  }

  if (!Array.isArray(profile?.requiredChecks) || profile.requiredChecks.length === 0) {
    await removeLabel(fullName, pr.number, 'automerge-pending');
    await addLabels(fullName, pr.number, ['needs-review']);
    await reconcileReviewRouting(fullName, pr, config.reviewers || []);
    await assignHumans(fullName, pr, true);
    console.log('[human-review-required]', fullName + '#' + pr.number + ': no required CI checks are configured for this auto-merge path');
    return;
  }

  if (!isAutoMergeCheckReady(checkState)) {
    await addLabels(fullName, pr.number, ['automerge-pending']);
    await disablePullRequestAutoMerge(fullName, fresh);
    console.log('[auto-merge-wait]', fullName + '#' + pr.number + ': required checks must all be successful before enabling Auto-merge; checks=' + checkState);
    return;
  }

  let repositorySettings;
  try {
    repositorySettings = await request('/repos/' + fullName);
  } catch (error) {
    if (error instanceof GitHubError && [403, 404].includes(error.status)) {
      await removeLabel(fullName, pr.number, 'automerge-pending');
      await addLabels(fullName, pr.number, ['automerge-blocked']);
    } else {
      await addLabels(fullName, pr.number, ['automerge-pending']);
    }
    console.warn('[auto-merge-settings]', fullName + '#' + pr.number, error.message);
    return;
  }
  if (repositorySettings.allow_auto_merge !== true) {
    await removeLabel(fullName, pr.number, 'automerge-pending');
    await addLabels(fullName, pr.number, ['automerge-blocked']);
    console.warn('[auto-merge-blocked]', fullName + '#' + pr.number + ': Allow auto-merge is disabled in repository settings');
    return;
  }
  const mergeMethod = mergeMethodFor(repositorySettings, profile);
  if (!mergeMethod) {
    await removeLabel(fullName, pr.number, 'automerge-pending');
    await addLabels(fullName, pr.number, ['automerge-blocked']);
    console.warn('[auto-merge-blocked]', fullName + '#' + pr.number + ': no enabled merge method');
    return;
  }

  try {
    await enablePullRequestAutoMerge(fullName, fresh, mergeMethod);
    await removeLabel(fullName, pr.number, 'automerge-pending');
    await addLabels(fullName, pr.number, ['automerge']);
    const mergeReason = dependencyBot
      ? 'low-risk ' + dependency.versionRisk + ' dependency update'
      : 'repository-authorized ' + String(profile.autoMerge.label) + ' update';
    console.log('[auto-merge-enabled]', fullName + '#' + pr.number + ': ' + mergeReason + '; checks=' + checkState);
  } catch (error) {
    // GitHub refuses to queue Auto-merge when all requirements are already satisfied.
    // In that case the same verified low-risk PR is merged immediately with a head-SHA guard.
    if (checkState === 'success' && /clean status|in clean status/i.test(error.message)) {
      const merged = await mergePullRequestNow(fullName, fresh, mergeMethod);
      if (!merged?.merged) throw new Error('GitHub did not confirm immediate merge');
      await removeLabel(fullName, pr.number, 'automerge');
      await removeLabel(fullName, pr.number, 'automerge-blocked');
      await removeLabel(fullName, pr.number, 'automerge-pending');
      console.log('[auto-merged]', fullName + '#' + pr.number + ': required checks passed; merge=' + merged.sha);
      return;
    }
    if (isTransientAutoMergeError(error)) {
      await removeLabel(fullName, pr.number, 'automerge-blocked');
      await addLabels(fullName, pr.number, ['automerge-pending']);
      console.log('[auto-merge-wait] ' + fullName + '#' + pr.number + ': ' + error.message + '; hourly reconciliation will retry without routing this PR to human review');
      return;
    }
    await removeLabel(fullName, pr.number, 'automerge-pending');
    await addLabels(fullName, pr.number, ['automerge-blocked']);
    console.warn('[auto-merge-error]', fullName + '#' + pr.number, error.message);
  }
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

export function resolvePullRequestEvent(
  repositoryFullName,
  pullRequestNumber,
  organization = ORG,
  headSha,
  headRepository = ''
) {
  const fullName = String(repositoryFullName || '').trim();
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(fullName);
  if (!match) throw new Error('EVENT_REPOSITORY must be an owner/repository pair');
  if (match[1].toLowerCase() !== String(organization).toLowerCase()) {
    throw new Error('Event repository is outside the configured organization');
  }

  const rawNumber = String(pullRequestNumber ?? '').trim();
  if (!/^[1-9][0-9]*$/.test(rawNumber)) throw new Error('EVENT_PR_NUMBER must be a positive integer');
  const number = Number(rawNumber);
  if (!Number.isSafeInteger(number)) throw new Error('EVENT_PR_NUMBER exceeds the safe integer range');

  const normalizedHeadSha = String(headSha || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalizedHeadSha)) {
    throw new Error('EVENT_PR_HEAD_SHA must be a 40-character hexadecimal head SHA');
  }

  const normalizedHeadRepository = String(headRepository || '').trim();
  if (normalizedHeadRepository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalizedHeadRepository)) {
    throw new Error('EVENT_PR_HEAD_REPOSITORY must be an owner/repository pair when provided');
  }

  return {
    fullName: match[1] + '/' + match[2],
    number,
    owner: match[1],
    name: match[2],
    headSha: normalizedHeadSha,
    headRepository: normalizedHeadRepository
  };
}

export function matchesPullRequestEvent(pullRequest, target) {
  if (String(pullRequest?.state || '').toLowerCase() !== 'open') return false;
  const currentHeadSha = String(pullRequest?.head?.sha || '').trim().toLowerCase();
  if (!currentHeadSha || currentHeadSha !== target.headSha) return false;

  if (target.headRepository) {
    const currentHeadRepository = String(pullRequest?.head?.repo?.full_name || '').trim().toLowerCase();
    if (!currentHeadRepository || currentHeadRepository !== target.headRepository.toLowerCase()) return false;
  }
  return true;
}

async function runPullRequestEvent() {
  const target = resolvePullRequestEvent(
    process.env.EVENT_REPOSITORY,
    process.env.EVENT_PR_NUMBER,
    ORG,
    process.env.EVENT_PR_HEAD_SHA,
    process.env.EVENT_PR_HEAD_REPOSITORY
  );
  const repo = await request('/repos/' + target.fullName);
  if (repo.archived || repo.fork || config.ignoredRepositories.includes(repo.name)) {
    console.log('[event-skip] ' + target.fullName + ': repository is archived, forked, or centrally ignored');
    return;
  }
  if (String(repo.owner?.login || '').toLowerCase() !== ORG.toLowerCase()) {
    throw new Error('Resolved repository owner does not match the configured organization');
  }

  const pr = await request('/repos/' + target.fullName + '/pulls/' + target.number);
  if (!matchesPullRequestEvent(pr, target)) {
    console.log('[event-skip] ' + target.fullName + '#' + target.number + ': PR is closed or its head metadata no longer matches this event');
    return;
  }
  await processPullRequest(repo, pr);
}

async function run() {
  const eventRepository = process.env.EVENT_REPOSITORY;
  const eventPrNumber = process.env.EVENT_PR_NUMBER;
  if (eventRepository || eventPrNumber) {
    if (!eventRepository || !eventPrNumber) {
      throw new Error('EVENT_REPOSITORY and EVENT_PR_NUMBER must be provided together');
    }
    await runPullRequestEvent();
    return;
  }

  const repos = await listAll('/orgs/' + ORG + '/repos?type=all');
  const active = repos.filter(repo => !repo.archived && !repo.fork && !config.ignoredRepositories.includes(repo.name));
  console.log('[agent] full reconciliation across ' + active.length + ' repositories; fallback interval=' + config.pollIntervalMinutes + ' minutes');

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
