# ThanhNguyxnAgent — Organization automation

The organization uses one central GitHub App controller in this repository. Do not add a second bot or copy the policy engine into individual repositories.

## Entry point and cadence

- `.github/workflows/agent-controller.yml` runs every 10 minutes and can also be started manually.
- `.github/scripts/agent-controller.mjs` scans active organization repositories, triages open issues and pull requests, and applies the policy in `agent-policy.json`.
- The workflow creates a short-lived installation token from the existing `BOT_APP_ID` and `BOT_PRIVATE_KEY` organization secrets. The token is scoped to this organization.

## Pull request policy

| Change | Agent behavior |
|---|---|
| Dependabot/Renovate patch or minor update | Eligible only after SemVer classification, a clean mergeability check, and successful CI |
| Major, downgrade, unknown, security-sensitive or malformed dependency update | Human review; never auto-merge |
| GitHub Actions or repository workflow changes | Human review |
| Regular pull request | Human review unless it carries an explicit `automerge` or `safe-update` label, or a repository-specific allowlisted label |
| Failed, pending, missing or incomplete CI | Hold for human review; fail closed |
| Merge conflict, draft PR, blocking label or protected path | Do not merge |

The controller does not check out or execute pull-request code. It reads PR metadata, changed-file names, mergeability, checks and commit statuses through the GitHub API. It must not bypass repository rulesets or branch protection.

## Issue triage

Open human-authored issues are categorized with labels and assigned/requested for maintainer attention. Automated, incident, keep-me, stale and wontfix issues are excluded according to policy. Security-related issues are escalated for human review.

## Repository-specific safeguards

The policy in `agent-policy.json` defines allowed base branches, sensitive paths, explicit merge labels and issue exclusions. No repository may opt all regular PRs into automatic merging by default.

### APIDex Hub — protected exception

`ThanhNguyxnOrg/apidex-hub` has a domain-specific link-health and catalog-remediation pipeline. It is not a generic dependency workflow and must remain independent:

- Daily two-stage link checks: fast CLI scan followed by Playwright verification.
- HTTP 401/403/418/429, WAF challenges, timeouts, SSL failures and 5xx are inconclusive, not proof an API is dead.
- Remove a catalog row only for confirmed 404/410 or NXDOMAIN after verification and canonical-documentation/replacement checks.
- Keep the `--max-delete` safety brake, incident issue, idempotent retry, catalog regeneration and dashboard update.
- API entries live under `apis/`; generated site data is handled by the APIDex CI pipeline.

Changes to the API checker or deletion behavior require APIDex-specific regression tests and review.
