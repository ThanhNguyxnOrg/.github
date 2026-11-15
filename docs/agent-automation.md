# ThanhNguyxnAgent — Organization automation

The organization uses one central GitHub App control plane in this repository. Do not create a second governance bot or copy merge/release policy into product repositories.

## Control plane and project adapters

The central control plane owns organization-wide policy and decisions:

- `.github/workflows/agent-controller.yml`: six-hour organization reconciliation, automatic PR-trigger onboarding, and missed-event recovery. PR lifecycle events enter through two managed workflows per repository: a metadata-only `pull_request_target` signal and a `workflow_run` relay to the central reusable worker. The signal uploads only a tiny JSON envelope containing repository, PR number, and head identity; the privileged worker validates it against the GitHub API before processing.
- `.github/workflows/release-controller.yml`: Conventional Commit classification, version/changelog commits, tags, draft releases, build-result checks and asset verification (15-minute polling).
- `.github/workflows/stale.yml`: organization-wide stale issue/PR lifecycle (daily).
- `agent-policy.json`, `ci-policy.json` and `release-policy.json`: central policy registries.
- `.github/scripts/*-controller.mjs`: shared control-plane implementations.

Product repositories keep their native adapters for stack-specific tests, compilation, packaging, signing and artifact upload. A Go project, Electron app, CMake project and Tauri app do not need the same build commands.

## Central CI profile registry

**Required checks are declared once in `ci-policy.json` in this repository. No CI-policy file is uploaded into each product repository.**

Each profile records the default branch and exact required GitHub Actions check/job names. Low-risk Dependabot patch/minor auto-merge is enabled by default, but only repositories with a non-empty, correctly mapped requiredChecks list are eligible. Repositories with missing or unmapped CI gates fail closed and require manual review.

A required check must exist on the commit and finish with the exact `success` conclusion. The newest attempt for each exact check name is authoritative, so a successful rerun supersedes an older failed attempt. Missing checks, skipped/neutral required checks, pending jobs and failures all hold the gate. Unconfigured repositories fail closed and require human review. A green unrelated check cannot substitute for a missing required job.

Path-scoped entries live only in this central registry and mirror the native workflow's `paths` filters. For pull requests, the controller evaluates check runs and commit statuses on the current PR head SHA; the synthetic merge SHA is only a fallback when a head SHA is unavailable. It refreshes PR metadata before CI evaluation and defers when the head changed since the initial repository listing.

PR labels are routing metadata, not merge authorization. PR opened, reopened, synchronize, ready-for-review, and edited events are routed to the central controller. All non-draft PRs receive classification labels. High-risk changes, failed/missing required checks, workflow edits, sensitive paths, and major/downgrade/unknown/security dependency updates receive `needs-review` and maintainer routing. Low-risk changes stay out of the human-review queue; Dependabot patch/minor updates can enter the guarded auto-merge path only in repositories with mapped required CI checks.

## Pull request safety

| Change | Agent behavior |
|---|---|
| Every non-draft pull request | Classify from title, author and changed files; apply type/area labels; route to a human only when risk or required-check policy demands it |
| Dependabot/Renovate or other bot PR | Add `automated`; dependency bots also receive `dependencies`; use the same risk and CI rules as other PRs |
| Major, downgrade, unknown or security-sensitive dependency update | Add the appropriate dependency/security labels and require human review |
| GitHub Actions or repository workflow changes | Add `workflow-update`; require human review |
| Failed, pending, missing, skipped or unconfigured required CI | Add the corresponding `ci-failed`, `ci-pending` or `ci-missing` label |
| Merge conflict or protected path | Add `merge-conflict` or retain `needs-review`; require human resolution |

The Agent is the organization's single decision and routing authority. It may enable guarded GitHub Auto-merge only for low-risk Dependabot patch/minor updates after validating changed paths, non-empty required checks, repository settings and the current head SHA. All other risky changes are routed to a human maintainer. It does not check out or execute pull-request code; it reads PR metadata, changed-file names, mergeability, checks and commit statuses through the GitHub API.

## Event security and automatic onboarding

The auto-onboarder installs two managed workflows on each active, non-fork organization repository's default branch:

1. `agent-pr-signal.yml` runs on `pull_request_target` and listens for completed workflows with the `workflow_run` filter `**`, including slash-bearing workflow names. Its job admits only completed runs associated with a pull request and excludes the Signal and Worker workflows themselves. It has no Actions secrets, no write permissions, no checkout, and no PR-code execution. It writes only GitHub-supplied repository, PR number, head SHA, and head repository metadata into a short-lived JSON artifact.
2. `agent-pr-worker.yml` runs after the Signal completes. A read-only validation job checks for that run's metadata artifact and validates its repository and PR identity fields before the processing job is admitted to the per-repository concurrency queue. The processing job accepts only Signal runs whose own triggering event was `pull_request_target` or `workflow_run`, and only for this organization. This rejects a PR-originated `pull_request` workflow that merely reuses the Signal display name. The worker passes only the `BOT_PRIVATE_KEY` organization secret; the called workflow reads `BOT_APP_ID` from the organization variable context.

The Worker serializes admitted PR events per repository with `queue: max`, allowing up to 100 pending jobs instead of replacing the previous pending event. Its reusable-workflow `uses` reference and `policy_ref` input use the same immutable SHA. The reusable workflow validates that SHA, checks out the central policy repository at that exact revision, then verifies that the PR is still open and its head SHA/repository still match the event. It uses a GitHub App installation token scoped to the single target repository. It never checks out, downloads, builds, or executes pull-request source code. The two-step relay is intentional: GitHub restricts Actions secrets for Dependabot-triggered `pull_request_target` runs, while the subsequent `workflow_run` can perform the privileged step after the metadata-only workflow completes.

The central bootstrapper first creates a short-lived organization-wide token with `Metadata: read` only to enumerate active repositories. It then runs a bounded matrix (five repositories at a time), minting a separate installation token for each repository with only `Contents: write` and `Workflows: write`. The write token never spans multiple repositories. The bootstrapper creates missing workflow files and updates only files beginning with the Agent-managed marker. Existing user-owned files at those paths are left untouched and fail that repository's onboarding job visibly rather than being silently treated as enrolled. New repositories are enrolled on the next six-hour reconciliation; that same pass also classifies their already-open PRs.

**Required GitHub App setup:** the Agent App installation needs `Metadata: read` for organization inventory, `Contents: write` and `Workflows: write` for per-repository onboarding tokens, and the existing `Issues: write`, `Pull requests: write`, Checks/Statuses read permissions for PR governance. `Administration: write` is additionally needed only for the repository-scoped token that enables GitHub's native **Allow auto-merge** setting; if the App does not have it, that setting-sync step is skipped and the PR controller must not assume the repository is enabled. The `BOT_APP_ID` organization variable and `BOT_PRIVATE_KEY` organization secret must be available to the central `.github` repository and every repository that receives the managed worker workflow. Keep both allowlists aligned; only the private key is a secret. Branch protection or rulesets can reject direct onboarding commits; those write failures make the onboarding workflow fail visibly instead of silently treating the repository as enrolled.

## Release safety

The central release policy owns version files, changelog path, branch, release mode and project build-workflow identity. Each build adapter remains responsible for native tests, compilation and packaging.

Before publishing a draft, the controller verifies:
1. the configured release workflow completed successfully for the exact tag commit;
2. every asset in that repository's central `requiredAssets` manifest exists and is uploaded.

If a build job is green but an expected archive is missing, the draft stays unpublished. Duplicate/orphan drafts are never deleted merely because they are duplicates. When a published release already owns the same tag, the controller may recover an orphan draft only after the exact tag's build workflow succeeded: it downloads each source asset, verifies its byte count and SHA-256, uploads it to the published release, verifies the uploaded asset's name/size/digest, then re-reads both release records. The orphan is deleted only when every source asset is mirrored byte-for-byte, every required manifest entry exists on the destination, and the source contains no unlisted extras. Missing, conflicting, unverifiable or unlisted assets keep the source draft intact.

Lumeo store releases remain manually approved because tag creation can trigger browser-store submission. APIDex remains excluded from generic product releases because its API catalog has a separate health/remediation lifecycle.

## Stale issue and PR lifecycle

The central stale controller scans active organization repositories daily. It marks items inactive for 14 days, then closes them after a further 5-day grace period only when there has been no new activity. Items with `keep-me`, `incident`, `automated`, `security`, active CI/merge-review or workflow labels are exempt. A stable timestamp comment prevents reruns from resetting the close window. Draft pull requests and locked conversations are excluded, and a configurable five-minute tolerance prevents the bot's own label/comment updates from immediately reactivating stale items.

## Adding a new repository

1. Keep the project's own CI workflow and make it run on pull requests to the default branch.
2. Add one entry under `repositories` in central `ci-policy.json`: exact required job names and default branch. The organization default permits only eligible Dependabot patch/minor auto-merge; leave the required-check list empty only when a repository must remain manual-review-only.
3. For automatic releases, add an entry in central `release-policy.json`: branch, baseline SHA, initial version, version files, changelog, release mode, build workflow name and required asset filenames.
4. Keep the project release workflow as a build/package adapter only. It should build from the central tag and upload files to that tag's draft release; it must not independently bump versions or create a second release.
5. Verify the first CI run, release build and asset manifest before treating the repository as eligible for guarded Dependabot auto-merge.

The worksheet is in `docs/repository-profile-template.md`. A plain-language note is a useful handoff; the machine-readable entry in this central repository is what the bot executes.

## APIDex Hub — domain-specific exception

`ThanhNguyxnOrg/apidex-hub` has a domain-specific link-health and catalog-remediation pipeline. It remains independent of generic PR/release automation:

- Daily two-stage link checks: fast CLI scan followed by Playwright verification.
- HTTP 401/403/418/429, WAF challenges, timeouts, SSL failures and 5xx are inconclusive, not proof an API is dead.
- Remove a catalog row only for confirmed 404/410 or NXDOMAIN after verification and canonical-documentation/replacement checks.
- Keep the `--max-delete` safety brake, incident issue, idempotent retry, catalog regeneration and dashboard update.
- API entries live under `apis/`; generated site data is handled by the APIDex CI pipeline.

Changes to the API checker or deletion behavior require APIDex-specific regression tests and review.
