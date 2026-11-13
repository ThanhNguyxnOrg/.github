# Agent Event-Driven PR Routing and Auto-Onboarding

**Status:** Approved for implementation by the repository owner on 2026-11-13.

## Intent

Make ThanhNguyxnAgent react to pull-request lifecycle events without relying on frequent organization-wide polling, while preserving one central policy and automatically enrolling new organization repositories.

## Architecture

- Each active repository receives two managed workflow files: an unprivileged `pull_request` signal workflow and a privileged `workflow_run` worker workflow.
- The signal workflow has no secrets, no write permissions, no checkout, and never executes pull-request code.
- The worker delegates to a reusable workflow in `ThanhNguyxnOrg/.github`. The central reusable workflow validates the organization/repository/PR target, mints an installation token scoped to that one repository, checks out only the central policy repository, and invokes the existing controller in single-PR mode.
- The central controller remains the only owner of classification, risk, labels, reviewer routing, check evaluation, and dependency auto-merge policy.
- The organization controller performs a full reconciliation and auto-onboarding pass every six hours, with manual dispatch retained. This sweep also catches PR events that GitHub does not emit or that a repository cannot process yet.

## Goals

- React to PR opened, reopened, synchronize, ready-for-review, and edited events.
- Automatically install/update only Agent-managed workflow files in active, non-fork repositories.
- Preserve user-owned files at the managed paths; report conflicts instead of overwriting them.
- Keep App tokens repository-scoped for event processing and separate onboarding permissions from routine PR processing.
- Avoid external hosting and per-repository policy duplication.

## Non-goals

- No Cloudflare Worker, database, queue service, or third-party webhook host.
- No execution, checkout, or artifact download of PR code in a privileged workflow.
- No changes to risk classification or merge policy beyond routing a single event PR through the existing logic.

## Constraints and operational notes

- New repositories are auto-onboarded on the next six-hour reconciliation run; the same sweep processes any already-open PRs before event workflows are installed.
- Creating files under `.github/workflows` requires GitHub App Contents and Workflows write permissions.
- The organization secrets `BOT_APP_ID` and `BOT_PRIVATE_KEY` must be available to the auto-onboarded worker workflows. Use organization-level access rather than adding per-repository secrets.
- If a managed path already exists and is not marked as Agent-managed, the bootstrapper leaves it untouched and reports a conflict.
- The event worker treats the PR number as untrusted input and validates the repository owner, repository metadata, PR state, and PR head through the GitHub API.
