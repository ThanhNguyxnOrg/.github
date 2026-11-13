# Agent Event-Driven PR Routing and Auto-Onboarding Implementation Plan

> **For agentic workers:** Execute the tasks in order and verify each task before continuing.

**Goal:** Route PR events to the central ThanhNguyxnAgent immediately and automatically install event triggers in current and future active organization repositories.

**Architecture:** A repository-local unprivileged `pull_request` signal completes, then a privileged `workflow_run` workflow calls a central reusable workflow. The central controller processes one validated PR; a six-hour central reconciliation handles missed events and auto-onboarding.

**Tech Stack:** GitHub Actions, GitHub App installation tokens, GitHub REST API, Node.js ESM, built-in `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-13-agent-event-driven-auto-onboarding-design.md`

## Global Constraints

- Central classification and policy stay in `ThanhNguyxnOrg/.github`.
- No third-party hosting or per-repository business logic.
- Untrusted PR code is never checked out, downloaded, or executed by a privileged job.
- Event-processing App tokens are scoped to a single repository.
- Bootstrapper writes only absent files or files carrying the Agent-managed marker.
- Fallback reconciliation cadence is six hours; manual dispatch remains available.

## Review Focus

- Fork and Dependabot PRs must still reach the privileged worker without exposing secrets to the signal workflow.
- Empty or malformed `workflow_run.pull_requests` payloads must be ignored safely and recovered by fallback reconciliation.
- A malicious/unrelated existing workflow at a managed path must never be overwritten.
- Archived repositories, forks, the central `.github` repository, and empty repositories must be skipped.
- A stale event must not process a closed PR or bypass the fresh-head check already in the controller.

### Task 1: Single-PR event mode

**Files:**
- Modify: `.github/scripts/agent-controller.mjs`
- Test: `.github/scripts/agent-controller.test.mjs`

- [x] Add strict event-target validation.
- [x] Add an event execution path that fetches and processes only the specified open PR.
- [x] Preserve the existing full organization reconciliation path.
- [x] Add tests for valid, malformed, cross-organization, and invalid PR targets.

### Task 2: Safe per-repository event workflows

**Files:**
- Create: `.github/workflows/agent-pr-worker.yml` (central reusable workflow)
- Create: `.github/templates/agent-pr-signal.yml`
- Create: `.github/templates/agent-pr-worker.yml`

- [x] Add a secret-free PR signal workflow template.
- [x] Add a workflow_run worker template that delegates to the central reusable workflow.
- [x] Scope the event worker's GitHub App token to the target repository.
- [x] Keep privileged processing on trusted central code only.

### Task 3: Automatic repository onboarding

**Files:**
- Create: `.github/scripts/agent-onboard.mjs`
- Create: `.github/scripts/agent-onboard.test.mjs`
- Modify: `.github/workflows/agent-controller.yml`

- [x] Add a separate least-privilege onboarding token with Contents and Workflows write.
- [x] Implement pagination, active-repository filtering, and safe create/update/conflict behavior.
- [x] Run onboarding before the six-hour full reconciliation.
- [x] Add tests for eligibility, create/update/no-op/conflict behavior, and default-branch writes.

### Task 4: Policy and documentation

**Files:**
- Modify: `agent-policy.json`
- Modify: `docs/agent-automation.md`
- Create: this design and plan document.

- [x] Change the fallback interval metadata to 360 minutes.
- [x] Document event flow, auto-onboarding, security boundaries, and the six-hour fallback.
- [x] Document that organization secrets must be accessible to the repositories receiving the worker workflow.

