const token = process.env.GH_TOKEN;
const repository = process.env.REPOSITORY || '';
const issueNumber = Number(process.env.ISSUE_NUMBER);
const body = process.env.COMMENT_BODY || '';
const api = process.env.GITHUB_API_URL || 'https://api.github.com';

if (!token) throw new Error('GH_TOKEN is required');
if (!/^[^/]+\/[^/]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY is invalid');
if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error('ISSUE_NUMBER must be a positive integer');
if (!body.trim()) throw new Error('COMMENT_BODY must not be empty');

const [owner, repo] = repository.split('/');
const response = await fetch(`${api}/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ body })
});
const raw = await response.text();
let result;
try { result = raw ? JSON.parse(raw) : {}; } catch { result = { message: raw }; }
if (!response.ok) {
  throw new Error(`GitHub comment creation failed (${response.status}): ${result.message || response.statusText}`);
}
console.log(`[ThanhNguyxnAgent] Comment created: ${result.html_url}`);
