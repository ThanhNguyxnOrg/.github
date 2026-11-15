# Organization Actions Variables

Quick reference for non-sensitive GitHub Actions variables configured in
[ThanhNguyxnOrg](https://github.com/ThanhNguyxnOrg). This file documents names,
purpose, scope, and approved usage; values are managed in GitHub Settings.
Credentials, tokens, private keys, and client-secret values belong in
[Organization Actions Secrets](organization-secrets.md), never in variables.

## Organization-level variables

These non-sensitive identifiers are shared by approved organization workflows. Configure
them under **ThanhNguyxnOrg → Settings → Secrets and variables → Actions →
Variables**.

| Variable | Expected format / validation | Purpose and consumer |
|---|---|---|
| `BOT_APP_ID` | Positive integer (current value validated: `4125740`). | GitHub App ID for `ThanhNguyxnAgent[bot]`; used as the `app-id` input. Required by the central Agent Controller and repositories using Agent workflows. |
| `AMO_API_KEY` | JWT issuer in the form `user:<id>:<id>`; it is an identifier, not the JWT secret. | Firefox Add-ons API issuer for authorized extension repositories such as Lumeo. |
| `EDGE_CLIENT_ID` | UUID. | Microsoft Edge Partner Center Publish API Client ID for authorized extension repositories such as Lumeo. |
| `MSSTORE_TENANT_ID` | UUID. | Microsoft Entra directory (tenant) ID containing the shared Store-publisher app registration; authorized Microsoft Store submission repositories. |
| `MSSTORE_CLIENT_ID` | UUID. | Application (client) ID of `ThanhNguyxnOrg-MicrosoftStore-Publisher`; authorized Microsoft Store submission repositories. |
| `MSSTORE_SELLER_ID` | Partner Center Seller ID. | Seller ID for the linked Partner Center account; authorized Microsoft Store submission repositories. |

The Microsoft Store variables are paired with the organization secret `MSSTORE_CLIENT_SECRET`.
The `AMO_API_KEY` variable is paired with `AMO_API_SECRET`; the `EDGE_CLIENT_ID`
variable is paired with `EDGE_API_KEY`. `BOT_APP_ID` is paired with the
`BOT_PRIVATE_KEY` secret. See [Organization Actions Secrets](organization-secrets.md)
for the credential inventory and access policy.

**Access policy:** prefer **Selected repositories**. Add a repository only
after its Store submission workflow has been reviewed and is trusted to use the
organization publisher identity. Do not grant all repositories access merely
for convenience. The repository allowlist for these variables should match the
allowlist for `MSSTORE_CLIENT_SECRET`.

## Repository-level variables

Product-specific destinations and identifiers belong to the repository that
owns the product. Do not store them as organization-wide variables when they
differ by project.

| Variable | Scope | Purpose | Current consumer |
|---|---|---|---|
| `MSSTORE_PRODUCT_ID` | Repository | Microsoft Store product ID targeted by that repository's submission workflow. Each Store app must set its own value. | [WriteCanvas](https://github.com/ThanhNguyxnOrg/WriteCanvas), using its existing Store listing. |
| `ITCHIO_GAME` | Repository | itch.io destination in lowercase `account/project-slug` form; it is not a credential. | [AFTERFRAME](https://github.com/ThanhNguyxnOrg/AFTERFRAME-THE-LAST-LOOP). |

Create repository-level variables under **Repository → Settings → Secrets
and variables → Actions → Variables**. Keep product IDs, destinations, and
other project-specific settings with the project; keep only shared publisher
identity values at organization scope.

## Workflow usage

In GitHub Actions, read Actions variables through the `vars` context:

```yaml
env:
  STORE_TENANT_ID: ${{ vars.MSSTORE_TENANT_ID }}
  STORE_CLIENT_ID: ${{ vars.MSSTORE_CLIENT_ID }}
  STORE_SELLER_ID: ${{ vars.MSSTORE_SELLER_ID }}
  STORE_PRODUCT_ID: ${{ vars.MSSTORE_PRODUCT_ID }}
  STORE_CLIENT_SECRET: ${{ secrets.MSSTORE_CLIENT_SECRET }}
```

The first four values are configuration. The last value is sensitive and must
come from the Actions `secrets` context, not `vars`.

## Security and maintenance

- Do not copy live values into this document, commit them, or print them in
  workflow logs.
- Keep the organization-variable repository allowlist aligned with the
  corresponding publisher secret allowlist.
- Keep per-product variables in the owning repository; do not reuse one app's
  Store Product ID for another app.
- When adding, renaming, or removing a variable, update this inventory and the
  consuming workflow in the same change.

**Last reviewed:** November 15, 2026
