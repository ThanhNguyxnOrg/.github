export function releaseNotesFromChangelog(changelog, version) {
  const source = String(changelog || '').replace(/\r/g, '');
  const lines = source.split('\n');
  const normalizedVersion = String(version || '').replace(/^v/, '');
  const heading = new RegExp('^##\\s+\\[?v?' + normalizedVersion.replace(/\./g, '\\.') + '\\]?(?:\\s+-.*)?\\s*$');
  const start = lines.findIndex(line => heading.test(line));
  if (start < 0) return '';
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}
export function releaseBodyFromChangelog(changelog, version) {
  const body = releaseNotesFromChangelog(changelog, version);
  if (!body) {
    throw new Error('CHANGELOG.md has no release section for version ' + version + '; publication is blocked');
  }
  return body;
}
