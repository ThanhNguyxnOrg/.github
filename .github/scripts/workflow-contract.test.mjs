import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = (path) => fs.readFileSync(path, 'utf8');
const managedTag = /^ThanhNguyxnOrg\/\.github\/\.github\/(?:workflows\/[\w.-]+@(agent-v1|release-v1|ci-v1)|actions\/[\w.-]+@agent-v1)$/;

test('managed tags are scoped to central workflows and Agent composite actions', () => {
  for (const ref of ['workflows/ci-node.yml@ci-v1', 'workflows/publish-npm.yml@ci-v1', 'workflows/release-publish.yml@release-v1', 'actions/agent-token@agent-v1', 'actions/agent-git-identity@agent-v1']) {
    assert.ok(managedTag.test('ThanhNguyxnOrg/.github/.github/' + ref), ref);
  }
  for (const ref of ['', 'actions/checkout@v7', 'OtherOrg/.github/.github/workflows/ci-node.yml@ci-v1', 'ThanhNguyxnOrg/.github/.github/actions/agent-token@ci-v1', 'ThanhNguyxnOrg/.github/.github/workflows/ci-node.yml@main']) {
    assert.equal(managedTag.test(ref), false, ref);
  }
});

test('CI tag promotion tests main before atomically promoting ci-v1 and retaining snapshots', () => {
  const workflow = read('.github/workflows/ci-tag-promote.yml');
  assert.match(workflow, /push:\n    branches: \[main\]/);
  for (const path of ['.github/workflows/ci-*.yml', '.github/workflows/publish-npm.yml', 'ci-policy.json', '.github/workflows/ci-tag-promote.yml']) {
    assert.ok(workflow.includes("      - '" + path + "'"), path);
  }
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /ref: main/);
  const tests = workflow.indexOf('run: node --test .github/scripts/workflow-contract.test.mjs');
  assert.ok(tests > 0 && tests < workflow.indexOf('git tag -fa ci-v1'));
  assert.ok(workflow.includes('immutable="ci-v1-${stamp}-${short}"'));
  assert.ok(workflow.includes('git push --atomic --no-thin origin "refs/tags/${immutable}" "+refs/tags/ci-v1"'));
  assert.ok(workflow.includes('for ref in ci-v1 "${immutable}"; do'));
  assert.ok(workflow.includes('if [[ "${verified}" != "${head}" ]]'));
  assert.ok(workflow.includes('matching-refs/tags/ci-v1-'));
  assert.match(workflow, /keep=20/);
});

test('CI promotion handles first promotion, no-op, and verification failures', () => {
  const workflow = read('.github/workflows/ci-tag-promote.yml');
  const script = workflow.split('      - name: Promote ci-v1 tag to HEAD\n')[1]
    .split('\n      - name:')[0].split('        run: |\n')[1].replace(/^          /gm, '');
  const mocks = `
    git() {
      if [[ "$1" == rev-parse ]]; then printf '%s\\n' "$HEAD_SHA";
      else
        printf 'git %s\\n' "$*"
        if [[ "$1" == push ]]; then export PROMOTED=true; fi
      fi
    }
    gh() {
      if [[ "\${PROMOTED:-}" == true ]]; then
        printf '%s\\n' "$VERIFIED_SHA"
      elif [[ -n "$CURRENT_SHA" ]]; then
        printf '%s\\n' "$CURRENT_SHA"
      else
        return 1
      fi
    }
  `;
  for (const [current, verified, expectedStatus, pushed] of [
    ['', 'head-sha', 0, true],
    ['head-sha', 'head-sha', 0, false],
    ['', 'wrong-sha', 1, true],
  ]) {
    const result = spawnSync('bash', ['-c', mocks + script], {
      encoding: 'utf8',
      env: { ...process.env, HEAD_SHA: 'head-sha', CURRENT_SHA: current, VERIFIED_SHA: verified, GITHUB_REPOSITORY: 'ThanhNguyxnOrg/.github' },
    });
    assert.equal(result.status, expectedStatus, result.stderr);
    assert.equal(result.stdout.includes('git push --atomic --no-thin'), pushed);
  }
});

test('CI snapshot pruning handles empty listings and failed deletions without touching the moving tag', () => {
  const workflow = read('.github/workflows/ci-tag-promote.yml');
  const script = workflow.split('      - name: Prune old immutable CI tags (keep newest 20)\n')[1]
    .split('        run: |\n')[1].replace(/^          /gm, '');
  for (const count of [0, 20, 22]) {
    const tags = Array.from({ length: count }, (_, index) => 'refs/tags/ci-v1-20260101-' + String(index).padStart(4, '0') + '-abcdef0').join('\n');
    const result = spawnSync('bash', ['-c', `
      gh() {
        if [[ "$1" == api && "$2" == -X ]]; then
          printf 'delete %s\\n' "$4"
          return 1
        fi
        printf '%s\\n' "$SNAPSHOTS"
      }
    ` + script], {
      encoding: 'utf8',
      env: { ...process.env, SNAPSHOTS: tags, GITHUB_REPOSITORY: 'ThanhNguyxnOrg/.github' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((result.stdout.match(/^delete /gm) || []).length, Math.max(0, count - 20));
    assert.doesNotMatch(result.stdout, /delete [^\n]*\/ci-v1\n/);
    if (count > 20) assert.match(result.stdout, /::warning::could not delete/);
  }
});

test('Agent signal catches slash-bearing workflow names and excludes its own relay workflows', () => {
  const signal = read('.github/templates/agent-pr-signal.yml');
  assert.match(signal, /workflows:\s*\["\*\*"\]/);
  assert.match(signal, /workflow_run\.name\s*!=\s*'ThanhNguyxnAgent PR Event Signal'/);
  assert.match(signal, /workflow_run\.name\s*!=\s*'ThanhNguyxnAgent PR Event Worker'/);
  assert.match(signal, /workflow_run\.pull_requests\[0\]\.number\s*!=\s*null/);
});

test('managed worker calls the central reusable workflow via the agent-v1 tag', () => {
  const worker = read('.github/templates/agent-pr-worker.yml');
  assert.match(worker, /uses:\s*ThanhNguyxnOrg\/\.github\/\.github\/workflows\/agent-pr-worker\.yml@agent-v1/);
  assert.doesNotMatch(worker, /agent-pr-worker\.yml@main/);
  assert.doesNotMatch(worker, /agent-pr-worker\.yml@[0-9a-f]{40}/, 'worker must follow the agent-v1 tag, not a pinned SHA');
  assert.doesNotMatch(worker, /^\s+policy_ref:/m, 'callers omit policy_ref so the reusable worker resolves agent-v1 itself');
});

test('the central relay calls the reusable worker via the agent-v1 tag', () => {
  const relay = read('.github/workflows/agent-pr-worker-relay.yml');
  assert.match(relay, /uses:\s*ThanhNguyxnOrg\/\.github\/\.github\/workflows\/agent-pr-worker\.yml@agent-v1/);
  assert.doesNotMatch(relay, /^\s+policy_ref:/m, 'the relay omits policy_ref so the reusable worker resolves agent-v1 itself');
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

test('npm publishing exposes an explicit reusable workflow and credential contract', () => {
  const workflow = read('.github/workflows/publish-npm.yml');
  const ci = read('.github/workflows/ci-node.yml');
  assert.match(workflow, /^on:\n  workflow_call:/m);
  const inputs = workflow.split('    inputs:\n')[1].split('    secrets:\n')[0];
  for (const input of ['job_name', 'node_version_file', 'package_manager', 'cache', 'install_command', 'verify_command', 'build_command', 'working_directory', 'access', 'tag', 'dry_run', 'provenance']) {
    assert.match(inputs, new RegExp('^      ' + input + ':', 'm'), 'missing input ' + input);
  }
  assert.match(workflow, /    secrets:\n      NPM_TOKEN:\n(?:        description:[^\n]*\n)?        required: true/);
  assert.doesNotMatch(workflow, /secrets:\s*inherit/);
  assert.match(workflow, /permissions:\s*\n\s+contents: read\s*\n\s+id-token: write/);
  assert.match(workflow, /persist-credentials: false/);
  for (const action of ['checkout', 'setup-node']) {
    const pattern = new RegExp('uses: actions/' + action + '@([0-9a-f]{40})', 'g');
    const expected = [...ci.matchAll(pattern)].map((match) => match[1]);
    const actual = [...workflow.matchAll(pattern)].map((match) => match[1]);
    assert.ok(expected.length > 0);
    assert.deepEqual(actual, expected, action + ' must match ci-node.yml pins');
  }
  const nodeSteps = workflow.split(/\n      - name:/).filter((step) => step.includes('uses: actions/setup-node@'));
  for (const step of nodeSteps) assert.match(step, /registry-url: https:\/\/registry\.npmjs\.org/);
  const tokenBindings = [...workflow.matchAll(/NODE_AUTH_TOKEN:\s*([^\n]+)/g)].map((match) => match[1]);
  assert.ok(tokenBindings.length > 0);
  for (const binding of tokenBindings) assert.ok(['unused', '${{ secrets.NPM_TOKEN }}'].includes(binding));
  for (const name of ['Install dependencies', 'Verify', 'Build']) {
    const step = workflow.split('      - name: ' + name + '\n')[1].split('\n      - name:')[0];
    assert.match(step, /NODE_AUTH_TOKEN: unused/);
    assert.doesNotMatch(step, /secrets\.NPM_TOKEN/);
  }
  const publish = workflow.split('      - name: Publish to npm\n')[1].split('\n      - name:')[0];
  assert.match(publish, /working-directory: \$\{\{ inputs\.working_directory \}\}/);
  assert.match(publish, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
});

test('npm provenance is enabled only when the checkout matches the workflow commit', () => {
  const workflow = read('.github/workflows/publish-npm.yml');
  const step = workflow.split('      - name: Publish to npm\n')[1].split('\n      - name:')[0];
  const script = step.split('        run: |\n')[1].replace(/^          /gm, '');
  for (const [requested, checkout, expected] of [
    ['true', 'workflow-sha', 'enabled'],
    ['true', 'recovery-sha', 'disabled (checkout differs from GITHUB_SHA)'],
    ['false', 'workflow-sha', 'disabled'],
    ['', 'workflow-sha', 'disabled'],
  ]) {
    const result = spawnSync('bash', ['-c', 'git() { printf "%s" "$CHECKOUT_SHA"; }; npm() { printf "arg=%s\\n" "$@"; };\n' + script.replace(' >> "$GITHUB_OUTPUT"', '')], {
      encoding: 'utf8',
      env: { ...process.env, CHECKOUT_SHA: checkout, GITHUB_SHA: 'workflow-sha', GITHUB_OUTPUT: '/dev/stdout', PROVENANCE: requested, DRY_RUN: 'false', ACCESS: 'public', DIST_TAG: 'latest' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('provenance=' + expected));
    assert.equal(result.stdout.includes('arg=--provenance'), expected === 'enabled');
    assert.equal(result.stdout.includes('::warning::'), requested === 'true' && checkout !== 'workflow-sha');
  }
});

test('workflow, template, and composite-action references use immutable SHAs, managed version tags, or same-repository self references', () => {
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
  // The org's own workflows and actions may follow managed moving tags
  // (agent-v1 / release-v1 / ci-v1), which the promotion workflows advance
  // on main. Everything else must stay pinned to a full commit SHA.
  const unpinned = refs.filter(({ ref }) => !ref.startsWith('./.github/actions/') && !/@[0-9a-f]{40}$/.test(ref) && !managedTag.test(ref));
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

test('reusable Agent worker checks out the exact immutable policy revision resolved from agent-v1', () => {
  const reusable = read('.github/workflows/agent-pr-worker.yml');
  assert.ok(reusable.includes('ref: ${{ steps.policy.outputs.resolved_sha }}'));
  assert.ok(reusable.includes('repository: ThanhNguyxnOrg/.github'));
  assert.ok(reusable.includes("repos/${REPOSITORY_OWNER}/.github/commits/agent-v1"));
  assert.ok(reusable.includes("compare/${resolved}...main"));
  assert.ok(reusable.includes('required: false'));
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
});
