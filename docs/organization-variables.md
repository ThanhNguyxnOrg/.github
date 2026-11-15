# Organization Actions Variables

Quick reference for non-sensitive GitHub Actions variables configured in
[ThanhNguyxnOrg](https://github.com/ThanhNguyxnOrg). This file documents names,
purpose, scope, and approved usage; values are managed in GitHub Settings.
Credentials, tokens, private keys, and client-secret values belong in
[Organization Actions Secrets](organization-secrets.md), never in variables.

## Organization-level variables

These values describe the shared Microsoft Store publisher identity. Configure
them under **ThanhNguyxnOrg → Settings → Secrets and variables → Actions →
Variables**.

| Variable | Purpose | Consumer |
|---|---|---|
| `MSSTORE_TENANT_ID` | Microsoft Entra directory (tenant) ID containing the shared Store-publisher app registration. | Authorized Microsoft Store submission repositories. |
| `MSSTORE_CLIENT_ID` | Application (client) ID of `ThanhNguyxnOrg-MicrosoftStore-Publisher`. This identifies the app; it is not a client secret. | Authorized Microsoft Store submission repositories. |
| `MSSTORE_SELLER_ID` | Seller ID for the Partner Center account linked to the shared Entra application. | Authorized Microsoft Store submission repositories. |

These variables are paired with the organization secret `MSSTORE_CLIENT_SECRET`.
See [Organization Actions Secrets](organization-secrets.md) for the credential
and access policy.

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
