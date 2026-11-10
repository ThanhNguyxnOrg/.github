# Shared GitHub Actions Library

The organization keeps repeated automation primitives in `.github`. Project repositories retain their own caller workflows and project-specific build scripts; they do not copy the shared token, identity, changelog, or release-upload implementation.

## Design rules

- Use a reusable workflow when an entire job or multi-job process should be shared.
- Use a composite action for a sequence of steps inside an existing job (Agent token creation, Git identity, comments, or asset upload).
- Keep project-specific compiler, dependency, signing, packaging, and platform-matrix steps in the project adapter. A Qt/MSVC/CMake app, a Tauri app, a Go CLI, and an Electron app do not share the same build commands.
- Pin calls into this repository to a full commit SHA. Update pins deliberately when the central library changes.
- Do not pass all repository secrets to a called workflow. Pass only `BOT_APP_ID` and `BOT_PRIVATE_KEY`.
- The Agent-token action scopes tokens to the calling repository by default. Do not set `owner` without a repository allowlist unless organization-wide access is specifically required.
- Every automated write must use the GitHub App installation token. The default `GITHUB_TOKEN` is read-only in project workflows and must not be used for bot commits, comments, tags, release edits, or package-registry writes.

## Shared identity and secrets

Create the following as organization-level Actions secrets, available to the project repositories that use the automation:

- `BOT_APP_ID`: the GitHub App Client ID.
- `BOT_PRIVATE_KEY`: the GitHub App private key.

These are configured once at organization scope; do not create a different copy in each repository. In a caller workflow, explicitly pass these two secrets to a reusable workflow:

```yaml
secrets:
  BOT_APP_ID: ${{ secrets.BOT_APP_ID }}
  BOT_PRIVATE_KEY: ${{ secrets.BOT_PRIVATE_KEY }}
```

The App installation must have only the repository permissions required by the workflows. Token profiles in `.github/actions/agent-token` request narrow permissions. Installation tokens expire after one hour, so mint them inside the job that performs the write.

For Git commits, use `.github/actions/agent-git-identity` and check out the repository with the same installation token. This sets both author and committer to `ThanhNguyxnAgent[bot]`; the token determines the actor for the push/API operation. Setting the Git name alone does not authenticate a push as the Agent.

## Reusable workflows

- `ci-node.yml`: Node.js setup, npm/pnpm/yarn/Bun install, optional preparation, validation, lint, typecheck, test, build, post-build verification, and optional CI artifact upload. Supports explicit Node version or version files and lockfile-aware caching. All command steps use Bash explicitly, including on Windows runners, so caller commands behave consistently across operating systems.
- `ci-python.yml`: Python setup, pip caching, dependency installation, lint, typecheck, test, build, and optional CI artifact upload.
- `ci-go.yml`: Go setup, module caching, optional lint-tool installation and lint command, test, vet, build, and optional CI artifact upload.
- `ci-cmake.yml`: CMake configure, build, test, optional system dependencies, and optional CI artifact upload; use custom project adapters for extra Qt/MSVC/NASM or other system requirements.

All shared CI workflows expose an explicit `job_name` so the check-run name can match `ci-policy.json`. Every reusable CI workflow defaults `run` steps to Bash, including Windows runners, so command inputs have consistent shell behavior. They default to read-only checkout credentials and `contents: read`. CI artifacts are optional; do not upload every intermediate build by default. Keep short-lived CI artifacts only when another job or a human reviewer consumes them.
- `release-publish.yml`: downloads the caller's build artifacts, mints a repository-scoped Agent token, uploads to the central draft release, and verifies the required asset manifest from `release-policy.json`.

Reusable workflow files must live directly under `.github/workflows/`; GitHub does not support nested directories in that folder.

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
      BOT_APP_ID: ${{ secrets.BOT_APP_ID }}
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
