import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('Agent signal catches slash-bearing workflow names and excludes its own relay workflows', () => {
  const signal = read('.github/templates/agent-pr-signal.yml');
  assert.match(signal, /workflows:\s*\["\*\*"\]/);
  assert.match(signal, /workflow_run\.name\s*!=\s*'ThanhNguyxnAgent PR Event Signal'/);
  assert.match(signal, /workflow_run\.name\s*!=\s*'ThanhNguyxnAgent PR Event Worker'/);
  assert.match(signal, /workflow_run\.pull_requests\[0\]\.number\s*!=\s*null/);
});

test('managed worker calls an immutable central reusable workflow', () => {
  const worker = read('.github/templates/agent-pr-worker.yml');
  assert.match(worker, /uses:\s*ThanhNguyxnOrg\/\.github\/\.github\/workflows\/agent-pr-worker\.yml@[0-9a-f]{40}/);
  assert.doesNotMatch(worker, /agent-pr-worker\.yml@main/);
  const workflowRef = worker.match(/agent-pr-worker\.yml@([0-9a-f]{40})/);
  const policyRef = worker.match(/^\s+policy_ref:\s*([0-9a-f]{40})$/m);
  assert.ok(workflowRef, 'worker reusable workflow must be pinned to a full SHA');
  assert.ok(policyRef, 'trusted policy checkout must receive an immutable SHA');
  assert.equal(policyRef[1], workflowRef[1], 'workflow code and trusted policy checkout must use the same commit');
});

test('Worker admits only signal runs with a valid artifact and queues all pending per-repository events', () => {
  const worker = read('.github/templates/agent-pr-worker.yml');
  assert.ok(worker.includes('/actions/runs/'));
  assert.ok(worker.includes('steps.artifact.outputs.present == \'true\''));
  assert.ok(worker.includes('needs: validate'));
  assert.ok(worker.includes("github.event.workflow_run.conclusion == 'success'"));
  assert.ok(worker.includes('queue: max'));
  assert.ok(worker.includes('cancel-in-progress: false'));
  assert.doesNotMatch(worker, /^concurrency:/m);
});
test('all shared CI workflows expose the same baseline controls', () => {
  const files = ['ci-node.yml', 'ci-python.yml', 'ci-go.yml', 'ci-cmake.yml'];
  const inputs = ['job_name', 'runner', 'timeout_minutes', 'fetch_depth', 'working_directory', 'artifact_name', 'artifact_path', 'artifact_retention_days'];
  for (const file of files) {
    const workflow = read('.github/workflows/' + file);
    for (const input of inputs) assert.match(workflow, new RegExp('^      ' + input + ':', 'm'), file + ' is missing ' + input);
    assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/);
    assert.match(workflow, /persist-credentials:\s*false/);
    assert.match(workflow, /timeout-minutes:\s*\$\{\{ inputs\.timeout_minutes \}\}/);
    assert.doesNotMatch(workflow, /^ {6}working-directory:/m);
    const runSteps = [...workflow.matchAll(/^ {8}run:/gm)].length;
    const workingDirectorySteps = [...workflow.matchAll(/^ {8}working-directory: \$\{\{ inputs\.working_directory \}\}$/gm)].length;
    assert.equal(workingDirectorySteps, runSteps, file + ' must apply working_directory on every run step');
    const expectedTimeout = file === 'ci-node.yml' ? 20 : 360;
    const timeoutMatch = workflow.match(/timeout_minutes:\s*\n(?:[^\n]*\n){0,3}\s+default:\s*(\d+)/);
    assert.ok(timeoutMatch, file + ' must declare a timeout default');
    assert.equal(Number(timeoutMatch[1]), expectedTimeout, file + ' must preserve its prior timeout default');
  }
});

test('workflow, template, and composite-action references use immutable SHAs or same-repository self references', () => {
  const workflowFiles = fs.readdirSync('.github/workflows')
    .filter((file) => file.endsWith('.yml'))
    .map((file) => '.github/workflows/' + file);
  const templateFiles = fs.readdirSync('.github/templates')
    .filter((file) => file.endsWith('.yml'))
    .map((file) => '.github/templates/' + file);
  const compositeActionFiles = fs.readdirSync('.github/actions')
    .map((directory) => '.github/actions/' + directory + '/action.yml')
    .filter((file) => fs.existsSync(file));
  const files = [...workflowFiles, ...templateFiles, ...compositeActionFiles];
  const refs = files.flatMap((file) => {
    const source = read(file);
    return [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((match) => ({ file, ref: match[1] }));
  });
  const unpinned = refs.filter(({ ref }) => !ref.startsWith('./.github/actions/') && !/@[0-9a-f]{40}$/.test(ref));
  assert.ok(refs.some(({ ref }) => ref.startsWith('./.github/actions/')), 'same-repository composite actions should use a local ./ path');
  assert.deepEqual(unpinned, [], 'un-pinned workflow/action references: ' + JSON.stringify(unpinned));
});

test('Signal preserves original PR event provenance and both workers validate it', () => {
  const signal = read('.github/templates/agent-pr-signal.yml');
  const worker = read('.github/templates/agent-pr-worker.yml');
  const reusable = read('.github/workflows/agent-pr-worker.yml');

  assert.ok(signal.includes('EVENT_SOURCE_EVENT: ${{ github.event_name == \'pull_request_target\' && \'pull_request_target\' || github.event.workflow_run.event }}'));
  assert.ok(signal.includes("source_event: process.env.EVENT_SOURCE_EVENT || ''"));
  assert.ok(signal.includes("github.event.workflow_run.event == 'pull_request'"));
  assert.ok(signal.includes("github.event.workflow_run.event == 'pull_request_target'"));

  for (const [name, source] of [['template worker', worker], ['central reusable worker', reusable]]) {
    assert.ok(source.includes("const sourceEvent = String(payload.source_event || '');"), name + ' must read source_event');
    assert.ok(source.includes("!['pull_request', 'pull_request_target'].includes(sourceEvent)"), name + ' must reject non-PR source events');
  }
});

test('central release policy does not claim chess-on-glass is private', () => {
  const policy = JSON.parse(read('release-policy.json'));
  assert.doesNotMatch(policy.excluded['chess-on-glass'], /private/i);
});

test('central PR test workflow runs all Node regression tests and Python sync tests', () => {
  const workflow = read('.github/workflows/agent-policy-tests.yml');
  assert.match(workflow, /node --test \.github\/scripts\/\*\.test\.mjs/);
  assert.match(workflow, /python -m unittest scripts\/test_sync_org\.py/);
  assert.match(workflow, /actionlint.*v1\.7\.12|actionlint/);
});

test('reusable Agent worker checks out the exact immutable policy revision passed by its caller', () => {
  const reusable = read('.github/workflows/agent-pr-worker.yml');
  assert.ok(reusable.includes('ref: ${{ inputs.policy_ref }}'));
  assert.ok(reusable.includes('repository: ThanhNguyxnOrg/.github'));
  assert.doesNotMatch(reusable, /job\.workflow_(repository|sha)/);
});

test('the central .github repository uses a self-hosted PR signal and relay without being excluded from triage', () => {
  const policy = JSON.parse(read('agent-policy.json'));
  assert.equal(policy.ignoredRepositories.includes('.github'), false);
  assert.equal(
    read('.github/workflows/agent-pr-signal.yml'),
    read('.github/templates/agent-pr-signal.yml'),
    'the central metadata-only Signal must stay aligned with the managed template'
  );
  assert.equal(
    read('.github/workflows/agent-pr-worker-relay.yml'),
    read('.github/templates/agent-pr-worker.yml'),
    'the central relay must stay aligned with the managed Worker template'
  );
  const signal = read('.github/workflows/agent-pr-signal.yml');
  assert.match(signal, /pull_request_target:/);
  assert.match(signal, /permissions:\s*\{\}/);
  assert.doesNotMatch(signal, /BOT_PRIVATE_KEY|BOT_APP_ID|actions\/checkout/);
  const worker = read('.github/workflows/agent-pr-worker-relay.yml');
  assert.match(worker, /workflow_run:/);
  assert.match(worker, /ThanhNguyxnAgent PR Event Worker/);
});

test('stale controller uses the numeric organization App ID through app-id, not client-id', () => {
  const workflow = read('.github/workflows/stale.yml');
  assert.match(workflow, /app-id:\s*\$\{\{\s*vars\.BOT_APP_ID\s*\}\}/);
  assert.doesNotMatch(workflow, /client-id:\s*\$\{\{\s*vars\.BOT_APP_ID\s*\}\}/);
});;
