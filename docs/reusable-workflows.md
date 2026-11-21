# Shared GitHub Actions Library

The organization keeps repeated automation primitives in `.github`. Project repositories retain their own caller workflows and project-specific build scripts; they do not copy the shared token, identity, changelog, or release-upload implementation.

## Design rules

- Use a reusable workflow when an entire job or multi-job process should be shared.
- Use a composite action for a sequence of steps inside an existing job (Agent token creation, Git identity, comments, or asset upload).
- Keep project-specific compiler, dependency, signing, packaging, and platform-matrix steps in the project adapter. A Qt/MSVC/CMake app, a Tauri app, a Go CLI, and an Electron app do not share the same build commands.
- Pin calls into this repository to a full commit SHA. Update pins deliberately when the central library changes.
- Pin third-party actions to verified full commit SHAs; Dependabot opens one PR per GitHub Actions dependency each week (no update groups).
- For Agent automation, do not pass all repository secrets to a called workflow. `BOT_APP_ID` is read directly from the organization `vars` context; only `BOT_PRIVATE_KEY` is declared and passed through `workflow_call.secrets`.
- For third-party publishing, consult both [organization-secrets.md](organization-secrets.md) and [organization-variables.md](organization-variables.md). Keep platform-specific publishing in the project adapter until at least two repositories share the same build/publish contract. If a reusable publisher is introduced, declare each required credential explicitly under `workflow_call.secrets`; never use `secrets: inherit`.
- The Agent-token action scopes tokens to the calling repository by default. Do not set `owner` without a repository allowlist unless organization-wide access is specifically required.
- Every automated write must use the GitHub App installation token. The default `GITHUB_TOKEN` is read-only in project workflows and must not be used for bot commits, comments, tags, release edits, or package-registry writes.

## Shared identity and secrets

Configure the shared GitHub App identity at organization scope:

- `BOT_APP_ID`: Organization Actions **variable** containing the numeric GitHub App ID.
- `BOT_PRIVATE_KEY`: Organization Actions **secret** containing the GitHub App private key.

These are configured once at organization scope; do not create a different copy in each repository. The reusable workflow reads `vars.BOT_APP_ID` directly and declares only the private key as a secret. A caller therefore passes only:

```yaml
secrets:
  BOT_PRIVATE_KEY: ${{ secrets.BOT_PRIVATE_KEY }}
```

The App installation must have only the repository permissions required by the workflows. Token profiles in `.github/actions/agent-token` request narrow permissions. Installation tokens expire after one hour, so mint them inside the job that performs the write.

For Git commits, use `.github/actions/agent-git-identity` and check out the repository with the same installation token. This sets both author and committer to `ThanhNguyxnAgent[bot]`; the token determines the actor for the push/API operation. Setting the Git name alone does not authenticate a push as the Agent.

## Platform publishing credentials

Organization-level publishing credentials are shared only with explicitly authorized repositories; they do not belong in the game repository or in reusable-workflow source. The canonical inventories and access policies are [Organization Secrets](organization-secrets.md) and [Organization Variables](organization-variables.md).

For the current Microsoft Store integration:
- Shared organization variables: `MSSTORE_TENANT_ID`, `MSSTORE_CLIENT_ID`, and `MSSTORE_SELLER_ID`.
- Shared organization secret: `MSSTORE_CLIENT_SECRET`.
- Each product repository defines its own `MSSTORE_PRODUCT_ID` repository variable; never share one Store product ID between apps.
- The current caller is [WriteCanvas's Store workflow](https://github.com/ThanhNguyxnOrg/WriteCanvas/blob/master/.github/workflows/store.yml). It listens for a published stable GitHub Release and retains manual dispatch for recovery.
- Keep the shared variables' repository allowlist aligned with the secret allowlist, and grant access only to repositories with a reviewed Store submission workflow. The Entra app must be linked to the same Partner Center seller account that owns the product.
- Keep each product's Store packaging and identity validation in its own adapter. A successful submission starts Microsoft's Store review; it does not bypass certification or immediately publish the update to every user.

For the current itch.io integration:
- `BUTLER_API_KEY` is the Organization Actions secret (itch.io key source: `wharf`).
- The project workflow reads it directly as `secrets.BUTLER_API_KEY` in the publish job.
- Each caller repository keeps its own `ITCHIO_GAME` repository variable because the account/project slug is project-specific.
- Keep the build, archive validation, and browser smoke tests in the project adapter. Only the credential is shared.
- When a second project adopts an equivalent verified-ZIP-to-Butler contract, evaluate extracting the publish job into a reusable workflow with an explicit `BUTLER_API_KEY` input contract. Until then, avoid adding a one-consumer abstraction.

Never put actual secret values in documentation, workflow inputs, artifacts, or command arguments. Expose the key only as a masked environment variable to the Butler process.

## Reusable workflows

- `ci-node.yml`, `ci-python.yml`, `ci-go.yml`, and `ci-cmake.yml` share the optional baseline inputs `job_name`, `runner`, `timeout_minutes`, `fetch_depth`, `working_directory`, `artifact_name`, `artifact_path`, and `artifact_retention_days`. Defaults preserve existing check names and timeout behavior: Node remains 20 minutes; Python, Go, and CMake default to 360 minutes (the prior GitHub-hosted job limit). Callers may lower the timeout explicitly. Each workflow retains ecosystem-specific setup and commands, supports explicit Node versions or version files and lockfile-aware caching, and applies `working_directory` on each `run` step because GitHub does not allow expressions in `defaults.run`.
- `ci-python.yml`: Python setup, pip caching, dependency installation, lint, typecheck, test, build, and optional CI artifact upload.
- `ci-go.yml`: Go setup, module caching, optional lint-tool installation and lint command, test, vet, build, and optional CI artifact upload.
- `ci-cmake.yml`: CMake configure, build, test, optional system dependencies, and optional CI artifact upload; use custom project adapters for extra Qt/MSVC/NASM or other system requirements.

All shared CI workflows expose an explicit `job_name` so the check-run name can match `ci-policy.json`. Every reusable CI workflow defaults `run` steps to Bash, including Windows runners, so command inputs have consistent shell behavior. They default to read-only checkout credentials and `contents: read`. CI artifacts are optional; do not upload every intermediate build by default. Keep short-lived CI artifacts only when another job or a human reviewer consumes them.
- `release-publish.yml`: downloads the caller's build artifacts, mints a repository-scoped Agent token, uploads to the central draft release, and verifies the required asset manifest from `release-policy.json`.

Reusable workflow files must live directly under `.github/workflows/`; GitHub does not support nested directories in that folder. The managed Agent worker calls its reusable workflow via the `agent-v1` tag and omits `policy_ref`; the reusable worker resolves that tag to a commit SHA, verifies the commit is on `main`, and checks out `ThanhNguyxnOrg/.github` at that exact commit, keeping the workflow implementation and trusted policy code aligned while policy promotions only require moving the tag. A caller may still pass `policy_ref` as a full commit SHA as an emergency per-repository override.

## Standard release artifact contract

Each project release adapter does only the project-specific work. The release controller is the sole version/tag decision-maker; a normal push does not start platform release packaging:

1. Build and package on the correct OS/architecture.
2. Place final distributables in a flat `dist/release/` directory.
3. Upload each platform's files as a GitHub Actions artifact named `release-assets-<platform>` (for a single job, `release-assets` is also valid).
4. Call the central `release-publish.yml` job after all build jobs complete.
5. Do not add a schedule or ordinary `push` trigger to the release build adapter. It listens for the central controller's new tag event. A `workflow_dispatch` recovery input may be provided, but it must accept only an existing `vX.Y.Z` tag, check out that exact tag, and must never create or move a tag. Duplicate tag events are harmlessly rejected by tag/release checks.

Example caller:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      # Project-specific checkout, dependencies, tests, compiler and packaging.
      - uses: actions/upload-artifact@v7
        with:
          name: release-assets-linux-amd64
          path: dist/release/*
          if-no-files-found: error

  publish:
    needs: build
    uses: ThanhNguyxnOrg/.github/.github/workflows/release-publish.yml@<CENTRAL_COMMIT_SHA>
    with:
      tag: ${{ github.ref_name }}
      artifact_pattern: release-assets-*
      artifact_directory: dist/release
    secrets:
      BOT_PRIVATE_KEY: ${{ secrets.BOT_PRIVATE_KEY }}
```

The central `release-policy.json` is the only required-asset manifest. Build adapters must produce filenames matching `requiredAssets`, including the supported `{tag}` and `{version}` placeholders. The publisher refuses to upload when a required local file is missing, refuses to mutate a published release, replaces only changed same-name assets in an existing draft, verifies SHA-256 after upload, and leaves publication to the central Release Controller. Release lookup first tries the tag endpoint and then checks the release collection by exact `tag_name`; an HTTP 404 from the tag endpoint alone must not create a duplicate draft. Legacy orphan drafts may be repaired only when the release name and target commit SHA both match the requested tag.

Do not add a second version bump, changelog generator, tag creator, or GitHub Release publisher in the project adapter. The central Release Controller already owns those decisions.

## When to keep a custom adapter

Keep a custom workflow where the project has special release mechanics, such as browser-store submission, Tauri signing/updater bundles, macOS notarization, Chocolatey/Scoop/Homebrew synchronization, Qt deployment, cross-compilation, or custom test gates. Reuse the Agent-token and identity actions even in those workflows. The custom adapter still follows the same tag-only trigger, `dist/release/` staging, artifact naming, manifest validation, and central publisher contract wherever the platform tooling permits. Do not force unrelated products into a single generic build command.

## New repository onboarding

1. Add the CI caller and its exact check names to `ci-policy.json`.
2. Decide whether the repository is an automatic release, manually released, or excluded; every organization repository must appear in `release-policy.json`.
3. For automatic releases, add the version files, changelog path, release workflow name, and exact required asset names centrally.
4. Use the shared token and Git identity actions for every automated write.
5. Validate the first CI run, release draft, artifact manifest, and final publication before enabling any automatic merge policy.
