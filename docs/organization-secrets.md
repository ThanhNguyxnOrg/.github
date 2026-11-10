# Organization Secrets

Quick reference for the GitHub Actions secrets configured in [ThanhNguyxnOrg](https://github.com/ThanhNguyxnOrg). This file documents names, purpose, scope, and approved usage only; secret values must stay in GitHub settings.

| Secret | Purpose |
|---|---|
| `BOT_APP_ID` | Identifies the `ThanhNguyxnAgent[bot]` GitHub App used by organization workflows. |
| `BOT_PRIVATE_KEY` | The GitHub App private key paired with the App ID. Workflows use it to authenticate the App and generate an installation access token. |
| `CHOCO_API_KEY` | Chocolatey publishing credential used by the `git-account-switcher` release workflow to publish the `gswitch` package. |
| `AMO_API_KEY` | Firefox Add-ons (AMO) JWT issuer used to authenticate extension signing and publishing requests. |
| `AMO_API_SECRET` | Matching AMO JWT secret used with `AMO_API_KEY` to authenticate with the AMO API. |
| `EDGE_API_KEY` | Microsoft Edge Partner Center Publish API key used by extension release workflows. |
| `EDGE_CLIENT_ID` | Partner Center client ID paired with `EDGE_API_KEY` for Microsoft Edge publishing. |
| `BUTLER_API_KEY` | itch.io Butler CLI credential used by authorized game repositories to push verified builds to itch.io channels. Create it through Butler login; its itch.io API-key source must be `wharf`. |

## GitHub App

`BOT_APP_ID` and `BOT_PRIVATE_KEY` are used together by `actions/create-github-app-token`. The action creates a temporary installation token; later workflow steps use that token for bot operations.

The organization-wide Agent Controller in [agent-controller.yml](../.github/workflows/agent-controller.yml) uses these credentials for metadata-only triage and safe dependency PR governance. See [Agent automation policy](agent-automation.md) for the decision rules and APIDex exception.

## Chocolatey

`CHOCO_API_KEY` is passed to the Chocolatey publishing job in [git-account-switcher release.yml](https://github.com/ThanhNguyxnOrg/git-account-switcher/blob/master/.github/workflows/release.yml), where `choco push` publishes `gswitch`.

## Firefox Add-ons (AMO)

`AMO_API_KEY` (JWT issuer) and `AMO_API_SECRET` (JWT secret) are paired credentials for Firefox Add-ons. They are intended for extension workflows that authenticate with AMO to sign or publish extensions. Grant access to all repositories only when all of them need AMO publishing; otherwise, select the extension repositories that use these credentials.

## Microsoft Edge Add-ons

`EDGE_API_KEY` and `EDGE_CLIENT_ID` are account-level Partner Center Publish API credentials. Extension release workflows use them to authenticate when submitting updates to Microsoft Edge Add-ons.

## itch.io (Butler)

`BUTLER_API_KEY` is an **organization-level Actions secret**, not a repository secret. It is the credential generated/authorized by Butler on behalf of the itch.io account and must appear in itch.io's API Keys page with source `wharf`. A key created directly from the itch.io web API-key page (source `web`) is not the Butler credential expected by the deployment workflow.

The current consumer is [AFTERFRAME's itch.io package/publish workflow](https://github.com/ThanhNguyxnOrg/AFTERFRAME-THE-LAST-LOOP/blob/main/.github/workflows/itch-html5.yml). Its publish job reads the secret directly as `secrets.BUTLER_API_KEY`; the value is never passed as a command-line argument, written to the repository, or echoed into logs. GitHub masks the value in Actions logs.

**Access policy**
- Store the credential once under **ThanhNguyxnOrg → Settings → Secrets and variables → Actions → Secrets**.
- Prefer **Selected repositories**. Grant access only to game repositories that are trusted to publish under this itch.io account. Add a repository to the allowlist when it adopts a reviewed publisher workflow.
- Do not select **All repositories** merely for convenience; most repositories do not need publishing authority.
- A future project should reuse this same organization secret after its repository has been explicitly authorized; do not duplicate the key in that repository.
- Keep each project's destination as its own repository Actions variable named `ITCHIO_GAME` (lowercase `account/project-slug`). It is configuration, not a credential, and differs per game.
- Keep project-specific build, browser-test, and release gates in that project's adapter. Factor Butler publishing into a central reusable workflow only after multiple projects share the same contract; do not prematurely force unrelated platform workflows into one adapter.

The organization secret is consumed in the caller repository's own trusted workflow. If publishing is later moved to a reusable workflow, define an explicit `workflow_call` secret contract and pass only `BUTLER_API_KEY`; do not use `secrets: inherit`.

## Security

This repository is public. Never put secret values, private keys, API keys, or tokens in this file or in workflow source. Manage values under GitHub Organization → Settings → Secrets and variables → Actions.

**Last reviewed:** November 10, 2026
