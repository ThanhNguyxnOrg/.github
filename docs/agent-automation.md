# ThanhNguyxnAgent — Organization automation

The organization uses one central GitHub App control plane in this repository. Do not create a second governance bot or copy merge/release policy into product repositories.

## Control plane and project adapters

The central control plane owns organization-wide policy and decisions:

- `.github/workflows/agent-controller.yml`: organization-wide issue and PR classification, labels, human assignment, reviewer requests and CI/conflict status routing (10-minute polling).
- `.github/workflows/release-controller.yml`: Conventional Commit classification, version/changelog commits, tags, draft releases, build-result checks and asset verification (15-minute polling).
- `.github/workflows/stale.yml`: organization-wide stale issue/PR lifecycle (daily).
- `agent-policy.json`, `ci-policy.json` and `release-policy.json`: central policy registries.
- `.github/scripts/*-controller.mjs`: shared control-plane implementations.

Product repositories keep their native adapters for stack-specific tests, compilation, packaging, signing and artifact upload. A Go project, Electron app, CMake project and Tauri app do not need the same build commands.

## Central CI profile registry

**Required checks are declared once in `ci-policy.json` in this repository. No CI-policy file is uploaded into each product repository.**

Each profile records the default branch and exact required GitHub Actions check/job names. Dependency auto-merge is disabled across the organization.

A required check must exist on the commit and finish with the exact `success` conclusion. The newest attempt for each exact check name is authoritative, so a successful rerun supersedes an older failed attempt. Missing checks, skipped/neutral required checks, pending jobs and failures all hold the gate. Unconfigured repositories fail closed and require human review. A green unrelated check cannot substitute for a missing required job.

Path-scoped entries live only in this central registry and mirror the native workflow's `paths` filters. For pull requests, the controller checks the current synthetic merge commit SHA—not only the contributor head SHA—and defers if the head changes during evaluation.

PR labels are routing metadata, not merge authorization. The Agent never merges pull requests, including Dependabot or Renovate updates. Every non-draft PR receives classification labels, `needs-review`, maintainer assignment and a review request. Major, downgrade, unknown, malformed and security-sensitive dependency updates are clearly labeled for human review.

## Pull request safety

| Change | Agent behavior |
|---|---|
| Every non-draft pull request | Classify from title, author and changed files; apply type/area labels; add `needs-review`; assign maintainers and request review |
| Dependabot/Renovate or other bot PR | Add `automated`; dependency bots also receive `dependencies`; keep the PR assigned for human review |
| Major, downgrade, unknown or security-sensitive dependency update | Add the appropriate dependency/security labels and require human review |
| GitHub Actions or repository workflow changes | Add `workflow-update`; require human review |
| Failed, pending, missing, skipped or unconfigured required CI | Add the corresponding `ci-failed`, `ci-pending` or `ci-missing` label |
| Merge conflict or protected path | Add `merge-conflict` or retain `needs-review`; require human resolution |

The Agent does **not** automatically merge pull requests. It is the organization's single decision and routing authority: bots may open PRs, produce review comments, or publish security/check results, but the Agent labels and assigns work for a human maintainer to decide and merge. It does not check out or execute pull-request code; it reads PR metadata, changed-file names, mergeability, checks and commit statuses through the GitHub API.

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
2. Add one entry under `repositories` in central `ci-policy.json`: exact required job names, default branch, and the explicit `autoMergeDependabot` decision.
3. For automatic releases, add an entry in central `release-policy.json`: branch, baseline SHA, initial version, version files, changelog, release mode, build workflow name and required asset filenames.
4. Keep the project release workflow as a build/package adapter only. It should build from the central tag and upload files to that tag's draft release; it must not independently bump versions or create a second release.
5. Verify the first CI run, release build and asset manifest before enabling dependency auto-merge.

The worksheet is in `docs/repository-profile-template.md`. A plain-language note is a useful handoff; the machine-readable entry in this central repository is what the bot executes.

## APIDex Hub — domain-specific exception

`ThanhNguyxnOrg/apidex-hub` has a domain-specific link-health and catalog-remediation pipeline. It remains independent of generic PR/release automation:

- Daily two-stage link checks: fast CLI scan followed by Playwright verification.
- HTTP 401/403/418/429, WAF challenges, timeouts, SSL failures and 5xx are inconclusive, not proof an API is dead.
- Remove a catalog row only for confirmed 404/410 or NXDOMAIN after verification and canonical-documentation/replacement checks.
- Keep the `--max-delete` safety brake, incident issue, idempotent retry, catalog regeneration and dashboard update.
- API entries live under `apis/`; generated site data is handled by the APIDex CI pipeline.

Changes to the API checker or deletion behavior require APIDex-specific regression tests and review.
