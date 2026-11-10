import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const token = process.env.GH_TOKEN;
const repository = process.env.REPOSITORY || '';
const tag = process.env.RELEASE_TAG || '';
const assetPath = path.resolve(process.env.ASSET_PATH || 'dist/release');
const policyRef = process.env.POLICY_REF || 'main';
const api = process.env.API_URL || 'https://api.github.com';
const org = 'ThanhNguyxnOrg';

function fail(message) {
  throw new Error(message);
}

export function expandRequiredAssets(patterns, releaseTag) {
  const version = String(releaseTag || '').replace(/^v/, '');
  return (Array.isArray(patterns) ? patterns : []).map(pattern =>
    String(pattern).replaceAll('{tag}', releaseTag).replaceAll('{version}', version)
  );
}

export function planAssetUpload(localAssets, expectedNames, existingAssets) {
  const local = new Map(localAssets.map(item => [item.name, item]));
  const existing = new Map((existingAssets || []).map(item => [item.name, item]));
  const missing = expectedNames.filter(name => !local.has(name));
  const uploads = localAssets.map(item => {
    const previous = existing.get(item.name);
    return {
      ...item,
      action: previous && previous.digest === item.digest ? 'skip' : previous ? 'replace' : 'upload',
      existingId: previous?.id ?? null
    };
  });
  return { missing, uploads };
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    const message = (data && data.message) || response.statusText || 'GitHub API request failed';
    throw new Error(`GitHub API ${response.status}: ${message} (${url})`);
  }
  return data;
}

async function main() {
  if (!token) fail('GH_TOKEN is required');
  if (!/^[^/]+\/[^/]+$/.test(repository)) fail('GITHUB_REPOSITORY is invalid');
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) fail(`Invalid release tag: ${tag}`);
  if (!/^[A-Za-z0-9._/-]+$/.test(policyRef) || policyRef.includes('..')) fail('POLICY_REF contains unsupported characters');

  const [owner, repo] = repository.split('/');
  const repoPolicyUrl = `https://raw.githubusercontent.com/${org}/.github/${encodeURIComponent(policyRef)}/release-policy.json`;
  const policyResponse = await fetch(repoPolicyUrl, { headers: { Accept: 'application/json' } });
  if (!policyResponse.ok) fail(`Unable to read central release policy (${policyResponse.status})`);
  const policy = await policyResponse.json();
  const profile = policy.repositories?.[repo];
  if (!profile) fail(`No central release-policy profile exists for ${repo}`);
  const required = expandRequiredAssets(profile.requiredAssets, tag);
  if (!required.length) fail(`No requiredAssets manifest is configured for ${repo}`);

  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isDirectory()) {
    fail(`Release asset directory does not exist: ${assetPath}`);
  }
  const entries = fs.readdirSync(assetPath, { withFileTypes: true });
  if (entries.some(entry => !entry.isFile())) {
    fail('Release asset directory must be flat and contain regular files only (no nested directories or symlinks)');
  }
  const localAssets = entries.map(entry => {
    const filePath = path.join(assetPath, entry.name);
    const bytes = fs.readFileSync(filePath);
    return {
      name: entry.name,
      filePath,
      bytes,
      size: bytes.length,
      digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex')
    };
  });
  if (!localAssets.length) fail('No release assets were found');
  const releaseUrl = `${api}/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const release = await request(releaseUrl);
  if (release.tag_name !== tag) fail(`Release tag mismatch: expected ${tag}, got ${release.tag_name}`);
  if (!release.draft) fail(`Release ${tag} is already published; refusing to mutate published assets`);

  const plan = planAssetUpload(localAssets, required, release.assets || []);
  if (plan.missing.length) fail(`Required assets missing from ${assetPath}: ${plan.missing.join(', ')}`);

  const uploadBase = String(release.upload_url || '').replace(/\{\?.*$/, '');
  if (!uploadBase) fail('Draft release upload_url is missing');

  for (const item of plan.uploads) {
    if (item.action === 'skip') {
      console.log(`[asset-skip] ${item.name} already has the expected SHA-256 digest`);
      continue;
    }
    if (item.existingId) {
      await request(`${api}/repos/${owner}/${repo}/releases/assets/${item.existingId}`, { method: 'DELETE' });
      console.log(`[asset-replace] removed previous draft asset ${item.name}`);
    }
    const uploadUrl = new URL(uploadBase);
    uploadUrl.searchParams.set('name', item.name);
    const uploaded = await request(uploadUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: item.bytes
    });
    if (uploaded.state !== 'uploaded' || Number(uploaded.size) !== item.size || uploaded.digest !== item.digest) {
      fail(`Asset verification failed for ${item.name}`);
    }
    console.log(`[asset-uploaded] ${item.name} ${item.size} bytes ${item.digest}`);
  }

  const verified = await request(`${api}/repos/${owner}/${repo}/releases/${release.id}`);
  const uploadedNames = new Set((verified.assets || [])
    .filter(asset => asset.state === 'uploaded')
    .map(asset => asset.name));
  const missingAfterUpload = required.filter(name => !uploadedNames.has(name));
  if (missingAfterUpload.length) fail(`Release is still missing required assets: ${missingAfterUpload.join(', ')}`);

  const summary = [
    '## ThanhNguyxnAgent release assets',
    '',
    `- Repository: \`${repository}\``,
    `- Tag: \`${tag}\``,
    `- Draft release: ${verified.html_url}`,
    `- Required assets verified: ${required.length}/${required.length}`,
    `- Assets uploaded or already verified: ${plan.uploads.length}`
  ].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  console.log(`[release-assets-verified] ${repository} ${tag}; ${required.length} required assets present`);
}

if (process.env.RELEASE_TAG) {
  main().catch(error => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
