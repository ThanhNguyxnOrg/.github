import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('../../release-policy.json', import.meta.url), 'utf8'));

export function parseSemver(value) {
  const match = String(value || '').replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] || '' };
}

export function compareVersions(a, b) {
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

export function makeReleaseNotes(commits, fullName) {
  const groups = {
    'Breaking Changes': [],
    Features: [],
    'Bug Fixes and Performance': [],
    Reverts: [],
    'Other changes': []
  };
  for (const commit of commits) {
    const message = commit.message || commit.commit?.message || '';
    const parsed = classifyConventionalCommit(message);
    const subject = String(message).split('\n')[0].trim();
    if (!parsed && (!subject || releaseIntent(message, 'tag') || releaseIntent(message, 'commit') || /^Merge (?:branch|pull request|remote-tracking branch)\b/i.test(subject))) continue;
    const sha = commit.sha || commit.id || '';
    const url = 'https://github.com/' + fullName + '/commit/' + sha;
    const line = '- ' + (parsed ? parsed.subject : subject) + ' ([' + sha.slice(0, 7) + '](' + url + '))';
    if (!parsed) groups['Other changes'].push(line);
    else if (parsed.breaking) groups['Breaking Changes'].push(line);
    else if (parsed.type === 'feat') groups.Features.push(line);
    else if (parsed.type === 'revert') groups.Reverts.push(line);
    else groups['Bug Fixes and Performance'].push(line);
  }
  return Object.entries(groups)
    .filter(([, items]) => items.length)
    .map(([title, items]) => '### ' + title + '\n\n' + items.join('\n'))
    .join('\n\n');
}

export function releaseIntent(message, mode) {
  const subject = String(message || '').split('\n')[0].trim().replace(/ \(#\d+\)$/, '');
  const pattern = mode === 'commit'
    ? /^release:\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/i
    : /^chore\(release\):\s*prepare\s+v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/i;
  const match = subject.match(pattern);
  return match ? match[1] : null;
}

async function listAll(fullName, resource, request) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const batch = await request('/repos/' + fullName + '/' + resource + '?per_page=100&page=' + page);
    if (!Array.isArray(batch)) throw new Error('Invalid release notes ' + resource + ' response for ' + fullName);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

export async function notesSincePublishedRelease(fullName, targetTag, targetSha, rule, request) {
  if (!parseSemver(targetTag)) throw new Error('Unsupported release notes target: ' + targetTag);
  const releases = await listAll(fullName, 'releases', request);
  const tags = await listAll(fullName, 'tags', request);
  const previous = value => {
    const parsed = parseSemver(value);
    return parsed && !parsed.prerelease && compareVersions(value, targetTag) < 0;
  };
  const published = releases
    .filter(release => release.draft === false && release.prerelease === false && previous(release.tag_name))
    .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')) ||
      compareVersions(b.tag_name, a.tag_name))[0];
  const stableTags = tags.filter(tag => previous(tag.name))
    .sort((a, b) => compareVersions(b.name, a.name));
  const baseTag = stableTags.find(tag => tag.name === published?.tag_name) || stableTags[0];
  const base = baseTag ? baseTag.commit?.sha : rule.baselineSha;
  if (!base) throw new Error('No release notes baseline for ' + fullName + ' ' + targetTag);
  const commits = [];
  let total;
  for (let page = 1; ; page += 1) {
    const comparison = await request('/repos/' + fullName + '/compare/' +
      encodeURIComponent(base) + '...' + encodeURIComponent(targetSha) + '?per_page=100&page=' + page);
    if (!['ahead', 'identical'].includes(comparison.status)) {
      throw new Error('Release notes baseline is not an ancestor of ' + fullName + ' ' + targetTag);
    }
    total ??= comparison.total_commits;
    if (!Number.isInteger(total) || total < 0 || comparison.total_commits !== total ||
        !Array.isArray(comparison.commits) || comparison.commits.length > 100) {
      throw new Error('Incomplete release notes comparison for ' + fullName + ' ' + targetTag);
    }
    commits.push(...comparison.commits);
    if (commits.length > total || new Set(commits.map(commit => commit.sha)).size !== commits.length ||
        (commits.length < total && comparison.commits.length < 100)) {
      throw new Error('Incomplete release notes comparison for ' + fullName + ' ' + targetTag);
    }
    if (commits.length === total) break;
  }
  return makeReleaseNotes(commits, fullName);
}
