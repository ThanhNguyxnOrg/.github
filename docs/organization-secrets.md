# Organization Secrets

Quick reference for the GitHub Actions secrets configured in [ThanhNguyxnOrg](https://github.com/ThanhNguyxnOrg). This file documents purpose only; secret values must stay in GitHub settings.

| Secret | Purpose |
|---|---|
| `BOT_APP_ID` | Identifies the `ThanhNguyxnAgent[bot]` GitHub App used by organization workflows. |
| `BOT_PRIVATE_KEY` | The GitHub App private key paired with the App ID. Workflows use it to authenticate the App and generate an installation access token. |
| `CHOCO_API_KEY` | Chocolatey publishing credential used by the `git-account-switcher` release workflow to publish the `gswitch` package. |
| `AMO_API_KEY` | Firefox Add-ons (AMO) JWT issuer used to authenticate extension signing and publishing requests. |
| `AMO_API_SECRET` | Matching AMO JWT secret used with `AMO_API_KEY` to authenticate with the AMO API. |
| `EDGE_API_KEY` | Microsoft Edge Partner Center Publish API key used by extension release workflows. |
| `EDGE_CLIENT_ID` | Partner Center client ID paired with `EDGE_API_KEY` for Microsoft Edge publishing. |

## GitHub App

`BOT_APP_ID` and `BOT_PRIVATE_KEY` are used together by `actions/create-github-app-token`. The action creates a temporary installation token; later workflow steps use that token for bot operations.

Example: [blendops auto-merge workflow](https://github.com/ThanhNguyxnOrg/blendops/blob/main/.github/workflows/auto-merge-dependabot.yml).

## Chocolatey

`CHOCO_API_KEY` is passed to the Chocolatey publishing job in [git-account-switcher release.yml](https://github.com/ThanhNguyxnOrg/git-account-switcher/blob/master/.github/workflows/release.yml), where `choco push` publishes `gswitch`.

## Firefox Add-ons (AMO)

`AMO_API_KEY` (JWT issuer) and `AMO_API_SECRET` (JWT secret) are paired credentials for Firefox Add-ons. They are intended for extension workflows that authenticate with AMO to sign or publish extensions. Grant access to all repositories only when all of them need AMO publishing; otherwise, select the extension repositories that use these credentials.

## Microsoft Edge Add-ons

`EDGE_API_KEY` and `EDGE_CLIENT_ID` are account-level Partner Center Publish API credentials. Extension release workflows use them to authenticate when submitting updates to Microsoft Edge Add-ons.

## Security

This repository is public. Never put secret values, private keys, API keys, or tokens in this file or in workflow source. Manage values under GitHub Organization → Settings → Secrets and variables → Actions.

**Last reviewed:** November 4, 2026
