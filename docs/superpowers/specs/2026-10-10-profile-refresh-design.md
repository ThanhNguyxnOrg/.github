# ThanhNguyxnOrg Profile Refresh — Design Spec (2026-10-10)

Status: draft — awaiting review. No profile files change until this spec is approved.

## 1. Shared understanding (agreed with owner)

- Owner said: keep `stack.md` + `projects.md` (they look good); want auto-update when new repos appear (a bot named `ThanhNguyxnAgent` will own it); wants colorful, as many dynamic stickers as possible; free to deploy on GitHub or use any better approach; sticker/markdown effects should look premium; final user-facing output must be 100% English.
- My assumptions (correct me if wrong): hybrid direction — professional practice on the outside, one line of journey on the inside; generic frame so future domains fit without restructuring; `ThanhNguyxnAgent` was not found in the local repo or on the web, so the design is agent-agnostic (Actions + script any bot can trigger).
- Success: profile matches live org (16 repos + practice tagline); stack matches live Top languages; many stickers but nothing broken; `stack.md`/`projects.md` self-update; P0 404 fixed; everything user-facing in English.

## 2. Options considered

- A — Actions-only (workflow calls the API and writes files inline, no script): lean but hard to test locally, logic buried in YAML.
- B — Local script only (`scripts/sync-org.py`, run by hand when remembered): simplest but forgettable, not automatic.
- C — Hybrid, selected: script is the source of truth + `sync-org.yml` workflow on daily cron + `workflow_dispatch`. Zero extra hosting (GitHub hosts both the API and the runner). Any bot just presses Run or executes the script.

## 3. Design

### 3.1 Architecture — files touched

- Rewrite `profile/README.md` per the layout in 3.2.
- Sync `docs/stack.md` (drop C/C++/Java/C#/Bootstrap/MySQL/MongoDB; replace with TS/JS/Python/Go/Rust/PowerShell + Vue/Svelte/Tauri/Node/Express/Docker/Actions).
- Sync `docs/projects.md` (full 16-repo Showcase table: Name | one-line desc from GitHub | language badge | topics — the profile links here for the complete auto-updated list).
- Update repo-meta `README.md` (capsule text + live tagline + list `docs/research/`).
- Fix P0 `ISSUE_TEMPLATE/config.yml:4`: `ThanhNguyxn-Org` → `ThanhNguyxnOrg`.
- Add: `scripts/sync-org.py`, `.github/workflows/sync-org.yml` (runs inside this `.github` repo for this repo — not an org-wide runner).
- Explicitly not now: default `LICENSE` (docs forbid it), `CITATION.cff` inside `.github` (does not propagate), `github-readme-stats` cards (upstream repo archived), `ACCESSIBILITY.md` / `VULNERABILITY_REPORT.yml`.
- Language policy: all profile/docs output 100% English. No Vietnamese in user-facing markdown.

### 3.2 Components — profile layout + sticker system

Order: header capsule `waving` (`text=ThanhNguyxnOrg`, `desc=` = live tagline) → komarev views (keep URL, `username=ThanhNguyxnOrg`) → typing-svg one-liner → About, 5 bullets + org link → skillicons strip, one line (`i=ts,js,py,go,rust,powershell,vue,svelte,tauri,docker,nodejs,express,git,githubactions,vscode`, `perline=8`) → 6–8 core shields `for-the-badge` (TypeScript `3178C6`/`logo=typescript`, JavaScript `F7DF1E`/`logo=javascript`, Python `3776AB`, Go `00ADD8`, Rust `000000`, PowerShell `5391FE`, Vue `4FC08D`/`logo=vuedotjs`, Tauri `24C8DB`) → dynamic GitHub shields (stars/forks/issues per flagship repo — they update themselves, the safe kind of dynamic) → Top-6 Showcase table (real data, the highest-value sticker) + link to the full auto-updated table in `docs/projects.md` → Philosophy, 3 lines + link to `docs/philosophy.md` (keep the visible/organized/honest quote) → Pinned strategy, 2 lines (real pinning of 6 repos happens in the UI: blendops, lumeo, apidex-hub, awesome-cert-sherpa, PurgeKit, SkillGauge) → footer capsule + 3 link badges (Docs / Support / Security).
Remove from the profile, keep as `docs/` links: Why Exists, What You'll Find Here, long Migration Note.

### 3.3 Data flow — auto-update (owns the "new repo → stack updates" requirement)

`sync-org.yml` (daily cron off-peak + `workflow_dispatch`, `permissions: contents:write`) → checkout → run `python scripts/sync-org.py` with `GITHUB_TOKEN` → GET `/orgs/ThanhNguyxnOrg/repos?per_page=100&type=public` (plus optional `/repos/{repo}/languages` per repo when language counts are needed) → render two blocks (Top-6 Showcase for the profile + full Showcase table and stack counts for `docs/`) → write between `<!-- AUTO-START -->` / `<!-- AUTO-END -->` markers (`profile/README.md` gets the Top-6 block only, so it stays short; `docs/projects.md` gets the full 16-row table; `docs/stack.md` gets stack counts) (hand-written content lives outside the markers, never overwritten) → commit only on diff. No server, no extra PAT, 16 repos stay far below rate limits. `ThanhNguyxnAgent` integrates by (a) dispatching the workflow, (b) running the script itself, or (c) owning the commit identity — all three keep working without design changes.

### 3.4 Error handling

- Fix the `config.yml` 404 with a one-line change, verify HTTP 200 after.
- Capsule-render is best-effort (upstream warns about traffic spikes): max ~5 dynamic images per page, always `width="100%"`, encode spaces as `%20`, never raw `# & /`.
- Shields logo slugs must be exact SimpleIcons slugs (`vuedotjs` not `vue`, `nodedotjs`, `cplusplus`); a wrong slug drops the logo but the badge still renders.
- Template labels `bug` / `enhancement` must exist in all 16 repos or templates fail silently — verify once.
- Override rule: any repo with its own `ISSUE_TEMPLATE/` ignores the `.github` default entirely.

### 3.5 Testing / verification

- Preview markdown (VS Code or branch preview), check mobile layout (no more than ~20 badges per row).
- Link-check every URL after edits (especially `config.yml` + footer links).
- Dry-run the script locally (`python scripts/sync-org.py --check`) before enabling cron; trigger one manual workflow run and inspect the diff commit.
- Never present komarev counts as unique visitors (it counts hits via the Camo proxy; reloads count too).

## 4. Applied ui-ux-pro-max guidance (searched, matched)

- Pattern: Hero + Features + CTA → header capsule + About + Showcase + pinned/CTA footer.
- Style: Flat Design, dark slate (`#0F172A` / `#020617`), gold accent `#A16207` + run green `#22C55E` for dynamic badges; icon-heavy, no gradients/shadows.
- Type: Inter mood (GitHub renders system fonts, so hierarchy comes from size/weight, not exotic fonts).
- UX rules: badges communicate state, never encode status by color alone; keep count slots stable so dynamic badges never shift layout (content-jumping rule).
- Pre-delivery: alt text on every image, badge text contrast, reduced-motion respected (gentle capsule `fadeIn`, no blink).

## 5. Scope

- In: files in 3.1 + script/workflow + sticker URLs above, all output 100% English.
- Out: brandkit image, `FUNDING.yml`, per-flagship `CITATION.cff`, self-hosted capsule on Vercel (optional later).
- Prior research: `docs/research/2026-10-10-profile-refresh-research.md` (primary sources, working notes).

## 6. Cost note (daily cron)

Public repos get free Actions minutes; this job runs ~30–60s/day (≈15–30 min/month). No resource concern. If it ever matters, drop to weekly with one line change.

## 7. Primary sources

GitHub Docs (org profile, community health, issue/PR templates, CITATION); shields.io (static badges, logos); capsule-render README; komarev GHPVC README; skillicons README; github-readme-stats (archived — banned); live `github.com/ThanhNguyxnOrg`; SimpleIcons slugs.
