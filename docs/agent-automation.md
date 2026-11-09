# ThanhNguyxnAgent — Organization automation

This repository is the shared workflow source for the existing `ThanhNguyxnAgent[bot]` GitHub App. Do not create a second bot or duplicate policy engines in individual repositories.

## Dependency PR governance

Repositories that use Dependabot automation call:

`.github/workflows/reusable-dependabot-governance.yml`

The caller workflow stays in each repository because GitHub reusable workflows require an explicit caller. Policy and implementation live here so they can be changed once.

### Decision policy

| Change | Agent behavior |
|---|---|
| Non-major package patch/minor | Wait for reported checks; approve and enable squash auto-merge only after checks succeed |
| Major dependency update | Add review labels, assign/request human reviewers; never auto-merge |
| GitHub Actions dependency update | Human review, including patch/minor |
| Missing/unknown dependency metadata | Fail closed and request human review |
| Failed, missing, or pending CI | Do not merge; label and request human review |
| PR not authored by Dependabot | Workflow does not run |

The Agent uses the existing `BOT_APP_ID` and `BOT_PRIVATE_KEY` organization secrets. Installation tokens are scoped to the current repository and the minimum permissions required for the operation. The shared workflow does not check out or execute code from the pull request.

### Labels

The reusable workflow creates/updates these labels when it processes a Dependabot PR:

- `dependencies`
- `agent-auto-merge`
- `needs-review`
- `major-update`
- `workflow-update`
- `ci-failed`
- `ci-pending`
- `ci-missing`

### Migration note

The reusable workflow is invoked by local `pull_request_target` callers. This event is deliberately used without checking out or executing PR code, so the workflow can access the existing App secrets for safe metadata-only operations. Keep the caller allowlist and GitHub Actions event-policy configuration aligned with GitHub's current platform requirements. Do not replace it with a privileged workflow that checks out untrusted PR code.

## APIDex Hub — protected exception

`ThanhNguyxnOrg/apidex-hub` has a domain-specific link-health and catalog-remediation pipeline. It is not a generic dependency PR workflow and must remain independent:

- Daily two-stage link checks: fast CLI scan followed by Playwright verification.
- HTTP 401/403/418/429, WAF challenges, timeouts, SSL failures and 5xx are inconclusive, not proof an API is dead.
- Remove a catalog row only for confirmed 404/410 or NXDOMAIN after verification and canonical-documentation/replacement checks.
- Keep the `--max-delete` safety brake, incident issue, idempotent retry, catalog regeneration and dashboard update.
- Preserve the APIDex source-of-truth rule: API entries live under `apis/`; generated site data is handled by the repository's CI pipeline.

Do not point APIDex link-checker incidents at the Dependabot policy. Changes to the API checker or deletion behavior require APIDex-specific regression tests and review.
