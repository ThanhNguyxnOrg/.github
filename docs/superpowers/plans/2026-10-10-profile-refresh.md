# Profile Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh ThanhNguyxnOrg's public profile and docs to match the live org, plus a self-updating sync script and workflow.

**Architecture:** Content rewrite first (profile Top-6, docs full table, P0 link fix), then a stdlib-only Python script that regenerates marker-delimited blocks, then a daily Actions workflow that runs it. Docs-only change; no hosting.

**Tech Stack:** GitHub Flavored Markdown, Python 3 stdlib only (`urllib`, `json`, `argparse`), GitHub Actions (`schedule`, `workflow_dispatch`), GitHub REST API.

**Spec:** `docs/superpowers/specs/2026-10-10-profile-refresh-design.md`

## Global Constraints

- All user-facing markdown output is 100% English.
- `profile/README.md` shows the Top-6 table only; the full 16-row table lives in `docs/projects.md`.
- Dynamic images per page: maximum 5 (capsule best-effort rule).
- Never use `github-readme-stats` cards (upstream archived).
- Shields logo slugs must be exact SimpleIcons slugs (`vuedotjs`, `nodedotjs`, `cplusplus`).
- Never present komarev counts as unique visitors.
- Script uses Python stdlib only — no pip dependencies.
- Workflow triggers on `schedule` + `workflow_dispatch` only (never on `push`, to avoid commit loops).

## Marker Contract (shared by Tasks 2, 3, 5)

- `profile/README.md`: `<!-- AUTO-TOP6-START -->` / `<!-- AUTO-TOP6-END -->`
- `docs/projects.md`: `<!-- AUTO-FULL-START -->` / `<!-- AUTO-FULL-END -->`
- `docs/stack.md`: `<!-- AUTO-STACK-START -->` / `<!-- AUTO-STACK-END -->`
- Hand-written content always lives outside markers and is never overwritten.

## Review Focus

- Capsule-render outage degrades header/footer — profile must still read fine as text if images fail.
- A wrong shields `logo=` slug silently drops the icon — verify each badge renders.
- Issue-template labels `bug` / `enhancement` must exist in all 16 repos or templates fail silently.
- Workflow must commit only on real diff, or history fills with empty commits.
- Repo descriptions with `|` or newlines break markdown tables — rows must be sanitized.

---

### Task 1: Fix P0 broken support link

**Files:**
- Modify: `ISSUE_TEMPLATE/config.yml:4`

**Interfaces:**
- Consumes: nothing.
- Produces: correct URL `https://github.com/ThanhNguyxnOrg/.github/blob/main/SUPPORT.md` used by the issue chooser.

- [ ] **Step 1: Apply the one-line fix**

Replace `ThanhNguyxn-Org` with `ThanhNguyxnOrg` in `ISSUE_TEMPLATE/config.yml:4`.

- [ ] **Step 2: Verify the URL resolves**

Run: `curl -sI -o NUL -w "%{http_code}" https://github.com/ThanhNguyxnOrg/.github/blob/main/SUPPORT.md`
Expected: `200` (the old `ThanhNguyxn-Org` URL returns `404`).

- [ ] **Step 3: Commit**

```bash
git add ISSUE_TEMPLATE/config.yml
git commit -m "fix: correct org name in issue template support link"
```

### Task 2: Rewrite `profile/README.md`

**Files:**
- Modify: `profile/README.md`

**Interfaces:**
- Consumes: marker contract above; live data (tagline `An independent technology practice focused on building, exploring, and evolving ideas.`, Top-6 by stars: blendops, lumeo, apidex-hub, awesome-cert-sherpa, PurgeKit, SkillGauge).
- Produces: profile layout + `AUTO-TOP6` markers that Task 5 fills.

- [ ] **Step 1: Write the new profile**

Order: header capsule `waving` (`text=ThanhNguyxnOrg`, `desc=` = live tagline) → komarev views (keep existing URL) → typing-svg one-liner → About, 5 bullets + org link → skillicons strip (`i=ts,js,py,go,rust,powershell,vue,svelte,tauri,docker,nodejs,express,git,githubactions,vscode`, `perline=8`) → 6–8 core shields `for-the-badge` (spec section 3.2 for exact colors/slugs) → dynamic GitHub stars/forks shields for the Top-6 → `AUTO-TOP6` marker block (seed with current Top-6 rows) + link to `docs/projects.md` → Philosophy, 3 lines + link → Pinned strategy, 2 lines → footer capsule + Docs/Support/Security link badges. Delete Why Exists / What You'll Find / Migration Note sections (replaced by `docs/` links). 100% English.

- [ ] **Step 2: Preview and check**

Run: open the markdown preview in VS Code and confirm no row wider than mobile view, every image has alt text, total dynamic images <= 5.
Expected: clean render, no broken image icons.

- [ ] **Step 3: Commit**

```bash
git add profile/README.md
git commit -m "docs: rewrite org profile, Top-6 showcase plus docs links"
```

### Task 3: Sync `docs/stack.md` and `docs/projects.md`

**Files:**
- Modify: `docs/stack.md`, `docs/projects.md`

**Interfaces:**
- Consumes: marker contract; live Top languages (TypeScript, JavaScript, Python, Go, PowerShell + Rust, Vue) and topics (`developer-tools`, `ai-agents`, `static-analysis`).
- Produces: `AUTO-FULL` + `AUTO-STACK` blocks that Task 5 regenerates.

- [ ] **Step 1: Rewrite `docs/stack.md`**

Replace the C/C++/Java/C#/Bootstrap/MySQL/MongoDB list with the real stack (TS/JS/Python/Go/Rust/PowerShell + Vue/Svelte/Tauri/Node/Express/Docker/Actions), keeping the `AUTO-STACK` markers around the counts section. 100% English.

- [ ] **Step 2: Rewrite `docs/projects.md`**

Replace generic repo-type lists with the full 16-repo Showcase table (Name | one-line desc from GitHub | language | topics) inside `AUTO-FULL` markers. Sanitize `|` and newlines in descriptions. 100% English.

- [ ] **Step 3: Verify tables render**

Run: markdown preview of both files; count table rows in `docs/projects.md`.
Expected: 16 data rows, pipes aligned, no raw `|` inside cells.

- [ ] **Step 4: Commit**

```bash
git add docs/stack.md docs/projects.md
git commit -m "docs: sync stack and projects with live org data"
```

### Task 4: Touch up repo-meta `README.md`, `SECURITY.md`, `SUPPORT.md`

**Files:**
- Modify: `README.md`, `SECURITY.md`, `SUPPORT.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: consistent meta docs linking the refreshed profile.

- [ ] **Step 1: Apply the edits**

`README.md`: capsule text → `ThanhNguyxnOrg · .github`, one line with the live tagline, list `docs/research/` under What's inside. `SECURITY.md`: add a contact point (private issue or security advisories link). `SUPPORT.md`: fix any org link, add active-vs-archive expectation table. 100% English.

- [ ] **Step 2: Verify links**

Run: open preview and click every link (footer badges, docs links).
Expected: no 404.

- [ ] **Step 3: Commit**

```bash
git add README.md SECURITY.md SUPPORT.md
git commit -m "docs: align meta, security, and support docs"
```

### Task 5: Create `scripts/sync-org.py`

**Files:**
- Create: `scripts/sync-org.py`

**Interfaces:**
- Consumes: marker contract; `GITHUB_TOKEN` env (optional, raises rate limit); `--org` (default `ThanhNguyxnOrg`), `--check` (dry-run, exit 1 on diff).
- Produces: `fetch_repos() -> list[dict]`, `render_top6(repos) -> str`, `render_full(repos) -> str`, `render_stack(repos) -> str`, `update_file(path, start_marker, end_marker, block) -> bool (changed)` — Task 6 calls this script.

- [ ] **Step 1: Write the script (stdlib only)**

`urllib.request` GET `/orgs/{org}/repos?per_page=100&type=public` with `Accept: application/vnd.github+json`; follow `Link` pagination; sort Top-6 by `stargazers_count`; sanitize cell text (`|` → `/`, newlines → spaces); replace marker blocks; `--check` prints diff summary and exits 1 without writing.

- [ ] **Step 2: Dry-run against live data**

Run: `python scripts/sync-org.py --check`
Expected: exit 0 with `no changes` (content was hand-synced in Tasks 2–3) or a small intelligible diff — never a traceback.

- [ ] **Step 3: Verify markers survive a rewrite**

Run: `python scripts/sync-org.py` then `git diff --stat`
Expected: only marker-delimited regions change; hand-written sections untouched. Restore with `git checkout -- profile/README.md docs/projects.md docs/stack.md` if the run was only a test.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-org.py
git commit -m "feat: add org sync script with check mode"
```

### Task 6: Create `sync-org.yml` workflow and verify

**Files:**
- Create: `.github/workflows/sync-org.yml`

**Interfaces:**
- Consumes: Task 5's script interface (`python scripts/sync-org.py`, exit codes).
- Produces: daily auto-sync with commit-on-diff.

- [ ] **Step 1: Write the workflow**

Triggers `schedule: cron 0 0 * * *` + `workflow_dispatch`; `permissions: contents: write`; `concurrency: group: sync-org, cancel-in-progress: true`; steps: checkout → setup-python → run script → commit with `github-actions[bot]` identity only if `git diff --quiet` fails. Never trigger on `push`.

- [ ] **Step 2: Validate the YAML**

Run: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/sync-org.yml'))" ` (or paste into an online Actions validator if PyYAML is missing).
Expected: parses with `on.schedule`, `on.workflow_dispatch`, and `permissions.contents: write` present.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/sync-org.yml
git commit -m "feat: daily org sync workflow with manual dispatch"
```

- [ ] **Step 4: Manual dispatch note**

After push, trigger one `workflow_dispatch` run on GitHub and inspect the diff commit. (Requires push access; record the result.)

### Task 7: Final verification and workspace cleanup

**Files:**
- Delete: `docs/research/`, `docs/superpowers/` (owner-requested cleanup, done last).

**Interfaces:**
- Consumes: all tasks above.
- Produces: clean tree with only the refreshed profile, docs, script, and workflow.

- [ ] **Step 1: Full link and render pass**

Run: preview `profile/README.md`, `docs/projects.md`, `docs/stack.md`; re-check every URL including the fixed `config.yml` link; confirm labels `bug` and `enhancement` exist (check one repo's labels page — templates reference them).
Expected: zero 404, Top-6 in profile, 16 rows in projects, dynamic images <= 5, both labels present.

- [ ] **Step 2: Remove research and planning notes**

Run: `git rm -r docs/research docs/superpowers`
Expected: `git status --short` shows only deletions under those two dirs.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove research and planning notes after refresh"
```
