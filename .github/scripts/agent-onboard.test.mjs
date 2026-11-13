import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MANAGED_MARKER,
  decideWorkflowWrite,
  isEligibleRepository,
  onboardRepositories
} from './agent-onboard.mjs';

const quietLog = { log() {}, warn() {} };

test('onboarding only targets active non-fork repositories owned by the organization', () => {
  const base = {
    name: 'demo',
    full_name: 'ThanhNguyxnOrg/demo',
    owner: { login: 'ThanhNguyxnOrg' },
    default_branch: 'main',
    archived: false,
    fork: false
  };
  assert.equal(isEligibleRepository(base), true);
  assert.equal(isEligibleRepository({ ...base, archived: true }), false);
  assert.equal(isEligibleRepository({ ...base, fork: true }), false);
  assert.equal(isEligibleRepository({ ...base, owner: { login: 'someone-else' } }), false);
  assert.equal(isEligibleRepository({ ...base, default_branch: null }), false);
  assert.equal(isEligibleRepository(base, 'ThanhNguyxnOrg', ['demo']), false);
});

test('onboarding creates missing workflows, leaves custom workflows untouched, and updates only managed files', () => {
  const desired = MANAGED_MARKER + '\nname: managed\n';
  const managed = Buffer.from(MANAGED_MARKER + '\nname: old\n').toString('base64');
  const custom = Buffer.from('# user-owned workflow\nname: custom\n').toString('base64');
  assert.equal(decideWorkflowWrite(null, desired), 'create');
  assert.equal(decideWorkflowWrite({ encoding: 'base64', content: Buffer.from(desired).toString('base64') }, desired), 'unchanged');
  assert.equal(decideWorkflowWrite({ encoding: 'base64', content: managed }, desired), 'update');
  assert.equal(decideWorkflowWrite({ encoding: 'base64', content: custom }, desired), 'conflict');
});

test('onboarding writes both managed templates to each eligible default branch', async () => {
  const requests = [];
  const repo = {
    name: 'demo',
    full_name: 'ThanhNguyxnOrg/demo',
    owner: { login: 'ThanhNguyxnOrg' },
    default_branch: 'trunk',
    archived: false,
    fork: false
  };
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith('/orgs/ThanhNguyxnOrg/repos?type=all&per_page=100&page=1')) {
      return new Response(JSON.stringify([repo]), { status: 200 });
    }
    if (url.includes('/contents/') && !options.method) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
    if (options.method === 'PUT') return new Response(JSON.stringify({ content: { path: 'workflow.yml' } }), { status: 201 });
    throw new Error('Unexpected request: ' + url);
  };

  const summary = await onboardRepositories({
    token: 'test-token',
    organization: 'ThanhNguyxnOrg',
    fetchImpl,
    workflows: [
      { path: '.github/workflows/agent-pr-signal.yml', content: MANAGED_MARKER + '\nname: signal\n' },
      { path: '.github/workflows/agent-pr-worker.yml', content: MANAGED_MARKER + '\nname: worker\n' }
    ],
    log: quietLog
  });

  assert.deepEqual(summary, {
    repositories: 1,
    created: 2,
    updated: 0,
    unchanged: 0,
    conflicts: 0,
    failed: 0,
    skipped: 0
  });
  const writes = requests.filter(request => request.method === 'PUT');
  assert.equal(writes.length, 2);
  assert.ok(writes.every(write => write.body.branch === 'trunk'));
  assert.ok(writes.every(write => write.url.includes('/repos/ThanhNguyxnOrg/demo/contents/')));
});

test('onboarding reports a custom-file conflict without overwriting it', async () => {
  const custom = Buffer.from('# existing user workflow\nname: custom\n').toString('base64');
  const fetchImpl = async (url, options = {}) => {
    if (url.includes('/orgs/')) {
      return new Response(JSON.stringify([{
        name: 'demo',
        full_name: 'ThanhNguyxnOrg/demo',
        owner: { login: 'ThanhNguyxnOrg' },
        default_branch: 'main',
        archived: false,
        fork: false
      }]), { status: 200 });
    }
    if (url.includes('/contents/')) return new Response(JSON.stringify({ encoding: 'base64', content: custom, sha: 'blob-sha' }), { status: 200 });
    throw new Error('Unexpected request: ' + url);
  };
  const summary = await onboardRepositories({
    token: 'test-token',
    fetchImpl,
    workflows: [{ path: '.github/workflows/agent-pr-signal.yml', content: MANAGED_MARKER + '\nname: signal\n' }],
    log: quietLog
  });
  assert.equal(summary.conflicts, 1);
  assert.equal(summary.failed, 0);
});


test('onboarding reports failed writes so the controller can fail visibly', async () => {
  const fetchImpl = async (url, options = {}) => {
    if (url.includes('/orgs/')) {
      return new Response(JSON.stringify([{
        name: 'demo',
        full_name: 'ThanhNguyxnOrg/demo',
        owner: { login: 'ThanhNguyxnOrg' },
        default_branch: 'main',
        archived: false,
        fork: false
      }]), { status: 200 });
    }
    if (url.includes('/contents/') && !options.method) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
    if (options.method === 'PUT') {
      return new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), { status: 403 });
    }
    throw new Error('Unexpected request: ' + url);
  };

  const summary = await onboardRepositories({
    token: 'test-token',
    fetchImpl,
    workflows: [{ path: '.github/workflows/agent-pr-signal.yml', content: MANAGED_MARKER + '\\nname: signal\\n' }],
    log: quietLog
  });

  assert.equal(summary.failed, 1);
  assert.equal(summary.created, 0);
});
