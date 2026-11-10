# Repository automation profile worksheet

Use this note to onboard a project. Fill in the facts; the machine-readable profile is committed centrally in `ThanhNguyxnOrg/.github/ci-policy.json` and, when applicable, `release-policy.json`. Do not add a duplicate policy file to the product repository.

## Project facts

| Field | Value |
|---|---|
| Repository | `owner/repo` |
| Default branch | `main` or `master` |
| Stack | e.g. Go, Python, CMake/C++, Electron, Tauri |
| Pull-request CI workflow | Exact workflow filename |
| Required checks | Exact job/check names from a successful PR run |
| Dependency auto-merge | Yes/No; patch/minor only, after CI verification |
| Sensitive paths | Paths that always require human review |

## Release adapter (only if automatic releases are wanted)

| Field | Value |
|---|---|
| Release mode | Central tag or central release commit |
| Baseline commit SHA | Full 40-character SHA |
| Initial version | SemVer |
| Version files | Exact files and JSON paths / regex replacement |
| Changelog | Exact path |
| Build workflow | Exact workflow display name |
| Required assets | Every filename/pattern that must exist before publish |
| External publishing | Store/package-manager submission that still needs approval |

## Operating contract

- The central Agent applies PR policy and the central CI gate.
- The central Release Controller creates version/changelog commits and tags as configured.
- The repository adapter checks out that tag, runs native tests/build/package, and uploads assets to the matching draft release.
- The central Release Controller publishes only after the matching build workflow succeeds and every required asset is present.
- Missing or unconfigured checks hold automation for human review.
- Do not create a second auto-merge, version-bump or release-publishing bot in the product repository.
