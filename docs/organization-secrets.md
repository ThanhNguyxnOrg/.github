# Organization Actions Secrets

Quick reference for the GitHub Actions secrets configured in [ThanhNguyxnOrg](https://github.com/ThanhNguyxnOrg). This file documents names, purpose, scope, and approved usage only; secret values must stay in GitHub settings. Non-sensitive Actions variables are inventoried separately in [Organization Actions Variables](organization-variables.md).

| Secret | Purpose |
|---|---|
| `NPM_TOKEN` | npm publishing token consumed through the explicit `publish-npm.yml` secret contract; current consumer is Techstack-Studio's `techstack-studio` package. |
| `BOT_PRIVATE_KEY` | The GitHub App private key paired with the App ID. Workflows use it to authenticate the App and generate an installation access token. |
| `CHOCO_API_KEY` | Chocolatey publishing credential used by the `git-account-switcher` release workflow to publish the `gswitch` package. |
| `AMO_API_SECRET` | Matching AMO JWT secret used with `AMO_API_KEY` to authenticate with the AMO API. |
| `EDGE_API_KEY` | Microsoft Edge Partner Center Publish API key used by extension release workflows. |
| `MSSTORE_CLIENT_SECRET` | Microsoft Entra application client-secret value used by authorized repositories to authenticate Microsoft Store submissions through Partner Center. |
| `BUTLER_API_KEY` | itch.io Butler CLI credential used by authorized game repositories to push verified builds to itch.io channels. Create it through Butler login; its itch.io API-key source must be `wharf`. |

## GitHub App

`BOT_PRIVATE_KEY` is the GitHub App private key used with the non-sensitive organization variable `BOT_APP_ID`. Workflows pass the variable as the action's `app-id` input and use this secret as `private-key`; the action creates a temporary installation token for later bot operations. The variable is inventoried in [organization-variables.md](organization-variables.md).

The organization-wide Agent Controller in [agent-controller.yml](../.github/workflows/agent-controller.yml) uses these credentials for metadata-only triage and safe dependency PR governance. See [Agent automation policy](agent-automation.md) for the decision rules and APIDex exception.

## Chocolatey

`CHOCO_API_KEY` is passed to the Chocolatey publishing job in [git-account-switcher release.yml](https://github.com/ThanhNguyxnOrg/git-account-switcher/blob/master/.github/workflows/release.yml), where `choco push` publishes `gswitch`.

## Firefox Add-ons (AMO)

`AMO_API_KEY` is the non-sensitive JWT issuer identifier stored as an organization variable; `AMO_API_SECRET` is the matching JWT secret stored here. They are used together by Firefox Add-ons workflows to authenticate signing and publishing requests. Grant the secret only to extension repositories that use these credentials; see [organization-variables.md](organization-variables.md) for the issuer variable.

## Microsoft Edge Add-ons

`EDGE_API_KEY` is the account-level Partner Center Publish API credential stored as an organization secret. It is paired with the non-sensitive organization variable `EDGE_CLIENT_ID` (a UUID client identifier). Extension release workflows use both to authenticate Microsoft Edge Add-ons submissions. See [organization-variables.md](organization-variables.md) for the Client ID variable.

## Microsoft Store

`MSSTORE_CLIENT_SECRET` is the **client secret Value** for the shared `ThanhNguyxnOrg-MicrosoftStore-Publisher` Entra application. It is used by approved product repositories when their Microsoft Store workflow authenticates with Partner Center. Do not use the Entra **Secret ID**, and never put the Value in this public repository, a workflow file, an artifact, a log, or a chat.

The secret is paired with the organization-level variables `MSSTORE_TENANT_ID`, `MSSTORE_CLIENT_ID`, and `MSSTORE_SELLER_ID`. Those non-secret identifiers are documented in [organization-variables.md](organization-variables.md). Each app repository supplies its own `MSSTORE_PRODUCT_ID` repository variable because the Store product ID is specific to that app.

The current consumer is [WriteCanvas's Microsoft Store workflow](https://github.com/ThanhNguyxnOrg/WriteCanvas/blob/master/.github/workflows/store.yml). Store publisher credentials must be available only to repositories with a reviewed, trusted submission workflow. Prefer **Selected repositories** and do not grant access to every repository by default; Partner Center publishing credentials can authorize submissions for the linked seller account.

Rotate the organization secret before its Entra credential expires. Update the GitHub secret first, validate a controlled submission, and only then retire the previous credential.

## itch.io (Butler)

`BUTLER_API_KEY` is an **organization-level Actions secret**, not a repository secret. It is the credential generated/authorized by Butler on behalf of the itch.io account and must appear in itch.io's API Keys page with source `wharf`. A key created directly from the itch.io web API-key page (source `web`) is not the Butler credential expected by the deployment workflow.

The current consumer is [AFTERFRAME's itch.io package/publish workflow](https://github.com/ThanhNguyxnOrg/AFTERFRAME-THE-LAST-LOOP/blob/main/.github/workflows/itch-html5.yml). Its publish job reads the secret directly as `secrets.BUTLER_API_KEY`; the value is never passed as a command-line argument, written to the repository, or echoed into logs. GitHub masks the value in Actions logs.

### Provisioning the Butler credential

1. Install the official [Butler CLI](https://itch.io/docs/butler/installing.html).
2. Authenticate the CLI with the itch.io account that owns the game: `butler login`.
3. Complete the browser authorization flow, then open [itch.io API Keys](https://itch.io/user/settings/api-keys).
4. Use the key whose **Source** is `wharf`. Do not substitute a key created directly from the itch.io web API-key page with source `web`.
5. Add that value once as the Organization Actions secret `BUTLER_API_KEY`. Never copy the value into a repository, issue, pull request, chat, or documentation.

**Access policy**
- Store the credential once under **ThanhNguyxnOrg → Settings → Secrets and variables → Actions → Secrets**.
- Prefer **Selected repositories**. Grant access only to game repositories that are trusted to publish under this itch.io account. Add a repository to the allowlist when it adopts a reviewed publisher workflow.
- Do not select **All repositories** merely for convenience; most repositories do not need publishing authority.
- A future project should reuse this same organization secret after its repository has been explicitly authorized; do not duplicate the key in that repository.
- Keep each project's destination as its own repository Actions variable named `ITCHIO_GAME` (lowercase `account/project-slug`). It is configuration, not a credential, and differs per game; see [organization-variables.md](organization-variables.md) for the variable inventory and scope rules.
- Keep project-specific build, browser-test, and release gates in that project's adapter. Factor Butler publishing into a central reusable workflow only after multiple projects share the same contract; do not prematurely force unrelated platform workflows into one adapter.

The organization secret is consumed in the caller repository's own trusted workflow. If publishing is later moved to a reusable workflow, define an explicit `workflow_call` secret contract and pass only `BUTLER_API_KEY`; do not use `secrets: inherit`.

## npm

`NPM_TOKEN` is an npm granular/automation access token with publish rights. Configure it once at organization level and make it available to public repositories. The current consumer is Techstack-Studio's `techstack-studio` package.

Consume it only through the explicit `publish-npm.yml` secret contract: callers pass `NPM_TOKEN: ${{ secrets.NPM_TOKEN }}`, never `secrets: inherit`. The workflow exposes the token only through the `NODE_AUTH_TOKEN` environment variable, never as a CLI argument. See [reusable-workflows.md](reusable-workflows.md) for caller permissions, provenance requirements, and recovery.

Rotate before expiry: update the organization secret, run a `dry_run`, then revoke the old token.

## Security

This repository is public. Never put secret values, private keys, API keys, or tokens in this file or in workflow source. Manage values under GitHub Organization → Settings → Secrets and variables → Actions.

**Last reviewed:** November 21, 2026
