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

export function collectReleaseAssets(directory) {
  const files = [];
  const seen = new Set();
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filePath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) fail('Symbolic links are not allowed in release artifacts: ' + filePath);
      if (entry.isDirectory()) {
        visit(filePath);
      } else if (entry.isFile()) {
        if (seen.has(entry.name)) fail('Duplicate release asset filename across platform artifacts: ' + entry.name);
        seen.add(entry.name);
        files.push({ name: entry.name, filePath });
      } else {
        fail('Unsupported release artifact entry: ' + filePath);
      }
    }
  }
  visit(directory);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export function planAssetUpload(localAssets, expectedNames, existingAssets) {
  const allowed = new Set(expectedNames);
  const local = new Map(localAssets.map(item => [item.name, item]));
  const existing = new Map((existingAssets || []).map(item => [item.name, item]));
  const missing = expectedNames.filter(name => !local.has(name));
  const unexpected = localAssets
    .map(item => item.name)
    .filter(name => !allowed.has(name))
    .sort((a, b) => a.localeCompare(b));
  const uploads = localAssets.filter(item => allowed.has(item.name)).map(item => {
    const previous = existing.get(item.name);
    return {
      ...item,
      action: previous && previous.digest === item.digest ? 'skip' : previous ? 'replace' : 'upload',
      existingId: previous?.id ?? null
    };
  });
  return { missing, unexpected, uploads };
}

export function selectDraftRelease(releases, releaseTag) {
  const matches = (Array.isArray(releases) ? releases : [])
    .filter(release => release && release.tag_name === releaseTag && release.draft === true)
    .sort((a, b) => {
      const aDate = String(a.updated_at || a.created_at || '');
      const bDate = String(b.updated_at || b.created_at || '');
      return bDate.localeCompare(aDate);
    });
  return matches[0] || null;
}

export function selectOrphanDraftRelease(releases, releaseTag, targetSha) {
  const tag = String(releaseTag || '');
  const expectedSha = String(targetSha || '').toLowerCase();
  if (!tag || !/^[0-9a-f]{40}$/.test(expectedSha)) return null;

  const matches = (Array.isArray(releases) ? releases : [])
    .filter(release => {
      if (!release || release.draft !== true) return false;
      if (!/^untagged-[0-9a-f]{8,}$/i.test(String(release.tag_name || ''))) return false;
      if (String(release.target_commitish || '').toLowerCase() !== expectedSha) return false;
      const nameParts = String(release.name || '').trim().split(/\s+/);
      return nameParts[nameParts.length - 1] === tag;
    })
    .sort((a, b) => {
      const aDate = String(a.updated_at || a.created_at || '');
      const bDate = String(b.updated_at || b.created_at || '');
      return bDate.localeCompare(aDate);
    });
  return matches[0] || null;
}

async function resolveTagCommitSha(owner, repo, releaseTag) {
  const refUrl = `${api}/repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(releaseTag)}`;
  let ref;
  try {
    ref = await request(refUrl);
  } catch (error) {
    if (String(error.message).startsWith('GitHub API 404:')) return null;
    throw error;
  }
  if (ref.object?.type === 'commit') return ref.object.sha;
  if (ref.object?.type === 'tag') {
    const annotated = await request(`${api}/repos/${owner}/${repo}/git/tags/${ref.object.sha}`);
    return annotated.object?.sha || null;
  }
  return null;
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
  if (new Set(required).size !== required.length) fail('Central requiredAssets manifest contains duplicate filenames');
  if (required.some(name => !name || path.basename(name) !== name || name === '.' || name === '..')) {
    fail('Central requiredAssets manifest must contain filenames only');
  }

  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isDirectory()) {
    fail(`Release asset directory does not exist: ${assetPath}`);
  }
  const discoveredFiles = collectReleaseAssets(assetPath);
  const localAssets = discoveredFiles.map(({ name, filePath }) => {
    const bytes = fs.readFileSync(filePath);
    return {
      name,
      filePath,
      bytes,
      size: bytes.length,
      digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex')
    };
  });
  if (!localAssets.length) fail('No release assets were found');
  const releaseUrl = `${api}/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const releaseListUrl = `${api}/repos/${owner}/${repo}/releases?per_page=100`;
  let release;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      release = await request(releaseUrl);
      break;
    } catch (error) {
      if (!String(error.message).startsWith('GitHub API 404:')) throw error;

      // GitHub can return 404 from GET /releases/tags/{tag} for a freshly
      // created draft even while GET /releases already exposes that draft.
      // Resolve by exact tag_name from the collection before assuming that the
      // central controller has not created the draft yet.
      const releases = await request(releaseListUrl);
      release = selectDraftRelease(releases, tag);
      if (release) {
        console.log(`[release-lookup-fallback] resolved draft ${tag} from release collection (id=${release.id})`);
        break;
      }

      // Older controller runs could create a draft before its Git tag existed.
      // GitHub then retained an untagged-* release record. Recover only when
      // its target commit and final name both identify this exact tagged build.
      const targetSha = await resolveTagCommitSha(owner, repo, tag);
      const orphan = targetSha ? selectOrphanDraftRelease(releases, tag, targetSha) : null;
      if (orphan) {
        release = await request(`${api}/repos/${owner}/${repo}/releases/${orphan.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tag_name: tag,
            target_commitish: targetSha,
            draft: true
          })
        });
        if (release.tag_name !== tag || release.draft !== true) {
          fail(`Unable to repair orphan draft ${orphan.id} to tag ${tag}`);
        }
        console.log(`[release-orphan-repaired] attached orphan draft ${orphan.id} to existing tag ${tag}`);
        break;
      }

      if (attempt === 19) {
        fail(`Central draft release ${tag} was not found by tag lookup or safe orphan-draft recovery`);
      }
      console.log(`[release-wait] draft ${tag} is not visible yet; retry ${attempt + 1}/20`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  if (!release) fail(`Central draft release was not created for ${tag}`);
  if (release.tag_name !== tag) fail(`Release tag mismatch: expected ${tag}, got ${release.tag_name}`);
  if (!release.draft) fail(`Release ${tag} is already published; refusing to mutate published assets`);

  const plan = planAssetUpload(localAssets, required, release.assets || []);
  if (plan.unexpected.length) {
    fail(`Unlisted release assets are not allowed by the central manifest: ${plan.unexpected.join(', ')}`);
  }
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
