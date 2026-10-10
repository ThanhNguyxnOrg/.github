# ThanhNguyxnOrg Profile Refresh — Design Spec (2026-10-10)

Status: draft — chờ duyệt. Không đụng profile cho tới khi spec này được duyệt.

## 1. Hiểu chung (đã chốt với bạn)

- Bạn nói: giữ `stack.md` + `projects.md` vì thấy ok; muốn auto-update khi có repo mới (nhắc tới `ThanhNguyxnAgent`); thích màu mè, nhiều sticker động càng tốt; deploy lên GitHub thoải mái, có cách hay hơn cứ làm.
- Giả định của mình (cần bạn sửa nếu sai): hướng lai — ngoài pro như practice thật, trong giữ 1 dòng journey; khung chung chung để sau làm thêm mảng không phải đập cấu trúc; `ThanhNguyxnAgent` chưa tìm thấy ở local lẫn web nên thiết kế bất khả tri với agent (Actions + script mà bot nào cũng gọi được).
- Thành công: profile khớp live 16 repos + tagline practice; stack đúng Top langs live; sticker nhiều nhưng không vỡ; `stack.md`/`projects.md` tự cập nhật; fix 404 P0.

## 2. Hướng đã cân nhắc

- A — Chỉ Actions inline (workflow gọi API + viết file trực tiếp, khỏi script): gọn nhưng khó test local, logic chôn trong YAML.
- B — Chỉ script local (`scripts/sync-org.py`, chạy tay khi nhớ): đơn giản nhất nhưng hay quên, không tự động.
- C — Hybrid, được chọn: script là source of truth + workflow `sync-org.yml` chạy cron daily + `workflow_dispatch`. Không host gì thêm (API + runner đều của GitHub). Bot sau này chỉ cần bấm Run hoặc chạy script.

## 3. Design

### 3.1 Architecture — files chạm

- Rewrite `profile/README.md` theo layout mục 3.2.
- Sync `docs/stack.md` (bỏ C/C++/Java/C#/Bootstrap/MySQL/MongoDB, thay bằng TS/JS/Python/Go/Rust/PowerShell + Vue/Svelte/Tauri/Node/Express/Docker/Actions).
- Sync `docs/projects.md` (thêm Showcase table 16 repos: Name | Desc từ GitHub | Lang badge | Topics).
- Sửa `README.md` repo meta (capsule text + tagline live + liệt kê `docs/research/`).
- Fix P0 `ISSUE_TEMPLATE/config.yml:4`: `ThanhNguyxn-Org` → `ThanhNguyxnOrg`.
- Thêm mới: `scripts/sync-org.py`, `.github/workflows/sync-org.yml` (lưu ý: workflow nằm trong chính repo `.github`, chạy cho repo này, không phải org-wide runner).
- Không làm lúc này: `LICENSE` default (docs cấm), `CITATION.cff` trong `.github` (không lan tỏa), `github-readme-stats` card (repo gốc archived), `ACCESSIBILITY.md`/`VULNERABILITY_REPORT.yml`.

### 3.2 Components — layout profile + sticker system

Thứ tự: header capsule `waving` (`text=ThanhNguyxnOrg`, `desc=` tagline live) → komarev views (giữ nguyên URL, `username=ThanhNguyxnOrg`) → typing-svg 1 dòng → About 5 bullets + link org → skillicons strip 1 dòng (`i=ts,js,py,go,rust,powershell,vue,svelte,tauri,docker,nodejs,express,git,githubactions,vscode`, `perline=8`) → 6–8 shields `for-the-badge` core (TypeScript `3178C6`/`logo=typescript`, JavaScript `F7DF1E`/`logo=javascript`, Python `3776AB`, Go `00ADD8`, Rust `000000`, PowerShell `5391FE`, Vue `4FC08D`/`logo=vuedotjs`, Tauri `24C8DB`) → shields github dynamic (stars/forks/issues — tự nhảy, đây là sticker động an toàn) → Showcase table (data thật, là sticker giá trị nhất) → Philosophy 3 dòng + link `docs/philosophy.md` (giữ quote visible/organized/honest) → Pinned strategy 2 dòng (pin thật 6 repos trên UI: blendops, lumeo, apidex-hub, awesome-cert-sherpa, PurgeKit, SkillGauge) → footer capsule + 3 badges link Docs/Support/Security.
Bỏ khỏi profile, chuyển thành link `docs/`: Why Exists, What You'll Find Here, Migration Note dài.

### 3.3 Data flow — auto-update

`sync-org.yml` (cron daily + `workflow_dispatch`, `permissions: contents:write`) → checkout → chạy `python scripts/sync-org.py` với `GITHUB_TOKEN` → GET `/orgs/ThanhNguyxnOrg/repos?per_page=100&type=public` (+ optional `/repos/{repo}/languages` khi cần đếm lang) → render 2 khối (Showcase table + stack counts) → ghi vào giữa markers `<!-- AUTO-START -->` / `<!-- AUTO-END -->` trong `profile/README.md`, `docs/projects.md`, `docs/stack.md` (phần tay nằm ngoài markers, không bị ghi đè) → `git diff --quiet` rồi commit nếu đổi. Không server, không PAT riêng, 16 repos không đụng rate limit.

### 3.4 Error handling

- 404 `config.yml` fix 1 dòng, verify 200 sau sửa.
- Capsule best-effort (README gốc cảnh báo traffic spikes): giữ ≤5 ảnh động/page, luôn `width="100%"`, encode `%20`/`-nl-`, không dùng `# & /` thô.
- Shields slug chuẩn SimpleIcons (`vuedotjs` không phải `vue`, `nodedotjs`, `cplusplus`); sai slug = logo mất, badge vẫn hiện.
- Template labels `bug`/`enhancement` phải tồn tại ở cả 16 repos, không thì template lỗi thầm.
- Repo override rule: repo nào tự có `ISSUE_TEMPLATE/` riêng thì default của `.github` bị bỏ qua toàn bộ.

### 3.5 Testing / verify

- Preview markdown (VS Code hoặc branch preview) check layout mobile (không quá ~20 badges/dòng).
- Link check toàn bộ URL sau sửa (đặc biệt `config.yml` + footer links).
- Dry-run script local (`python scripts/sync-org.py --check`) trước khi bật cron; rerun workflow tay 1 lần, xem diff commit.
- Không claim komarev là unique visitors (nó đếm hits qua Camo proxy, reload cũng +1).

## 4. Áp dụng ui-ux-pro-max (đã search, có match)

- Pattern: Hero + Features + CTA → header capsule + About + Showcase + Pinned/CTA footer.
- Style: Flat Design, dark slate (`#0F172A`/`#020617`), accent gold `#A16207` + run green `#22C55E` cho badges dynamic; icon-heavy, không gradients/shadows.
- Type: Inter mood (GitHub render font hệ thống, giữ hierarchy bằng size/weight thay vì font lạ).
- UX rules: badges nói state, không mã hóa status chỉ bằng màu; giữ slot đếm ổn định để badge dynamic không đẩy layout (content-jumping rule).
- Pre-delivery: alt text cho mọi ảnh, tương phản text trên badge, tôn trọng reduced-motion (capsule `fadeIn` nhẹ, không blink).

## 5. Scope

- Trong spec: các files mục 3.1 + script/workflow + sticker URLs trên.
- Ngoài spec: ảnh brandkit, `FUNDING.yml`, `CITATION.cff` từng repo flagship, self-host capsule Vercel (optional sau).
- Research nền: `docs/research/2026-10-10-profile-refresh-research.md` (primary sources, đã xong).

## 6. Nguồn chính

GitHub Docs org profile + community health + issue/PR templates + CITATION; shields.io static-badges + logos; capsule-render README; komarev GHPVC README; skillicons README; github-readme-stats (archived, cấm dùng); live `github.com/ThanhNguyxnOrg`; SimpleIcons slugs.
