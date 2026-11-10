# ThanhNguyxnAgent — Organization automation

The organization uses one central GitHub App control plane in this repository. Do not create a second governance bot or copy merge/release policy into product repositories.

## Control plane and project adapters

The central control plane owns organization-wide policy and decisions:

- `.github/workflows/agent-controller.yml`: issue triage, PR triage, reviewer assignment and explicitly opted-in safe dependency merges (10-minute polling).
- `.github/workflows/release-controller.yml`: Conventional Commit classification, version/changelog commits, tags, draft releases, build-result checks and asset verification (15-minute polling).
- `.github/workflows/stale.yml`: organization-wide stale issue/PR lifecycle (daily).
- `agent-policy.json`, `ci-policy.json` and `release-policy.json`: central policy registries.
- `.github/scripts/*-controller.mjs`: shared control-plane implementations.

Product repositories keep their native adapters for stack-specific tests, compilation, packaging, signing and artifact upload. A Go project, Electron app, CMake project and Tauri app do not need the same build commands.

## Central CI profile registry

**Required checks are declared once in `ci-policy.json` in this repository. No CI-policy file is uploaded into each product repository.**

Each profile records the default branch, exact required GitHub Actions check/job names, and whether Dependabot/Renovate patch/minor auto-merge is enabled.

A required check must exist on the commit and finish with the exact `success` conclusion. The newest attempt for each exact check name is authoritative, so a successful rerun supersedes an older failed attempt. Missing checks, skipped/neutral required checks, pending jobs and failures all hold the gate. Unconfigured repositories fail closed and require human review. A green unrelated check cannot substitute for a missing required job.

Path-scoped entries live only in this central registry and mirror the native workflow's `paths` filters. For pull requests, the controller checks the current synthetic merge commit SHA—not only the contributor head SHA—and defers if the head changes during evaluation.

Regular PRs still need an explicit `automerge`, `safe-update` or repository-allowlisted label. Dependency auto-merge additionally requires `autoMergeDependabot: true` in the central CI profile. Major, downgrade, unknown, malformed and security-sensitive updates remain human-reviewed.

## Pull request safety

| Change | Agent behavior |
|---|---|
| Dependabot/Renovate patch or minor update | Eligible only when the central profile opts in, required checks pass, mergeability is clean and no blocking path/label is present |
| Major, downgrade, unknown, security-sensitive or malformed dependency update | Human review; never auto-merge |
| GitHub Actions or repository workflow changes | Human review |
| Regular pull request | Human review unless it has an explicit allowed auto-merge label |
| Failed, pending, missing, skipped or unconfigured required CI | Hold for human review; fail closed |
| Merge conflict, draft PR, blocking label or protected path | Do not merge |

The controller does not check out or execute pull-request code. It reads PR metadata, changed-file names, mergeability, checks and commit statuses through the GitHub API. This is designed for a solo-maintained organization: no branch protection, required review, or repository-side policy file is needed. The controller performs a direct squash merge only after central policy checks pass.

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
