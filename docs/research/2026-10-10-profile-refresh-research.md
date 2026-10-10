<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=soft&color=gradient&height=140&section=header&text=Profile%20Refresh%20Research&fontSize=34&animation=fadeIn" width="100%"/>
</div>

# Profile Refresh Research — 2026-10-10

> Câu hỏi gốc: "làm profile org GitHub đẹp chuyên nghiệp nhiều sticker md" — trả lời dựa trên PRIMARY SOURCES (docs.github.com + repo gốc của từng badge service), không dùng blog thứ cấp. Mọi claim đều có cite.

---

## Summary

1. **Org profile hợp lệ hiện tại:** `profile/README.md` trong repo `.github` public là đúng chuẩn GitHub. Không cần đổi vị trí. Chỉ cần viết lại nội dung cho khớp thực tế org live (xem B, E). ([docs][org-profile])
2. **Community health files đã đủ bộ khung:** `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, `ISSUE_TEMPLATE/` (bug/feature + `config.yml`), `PULL_REQUEST_TEMPLATE.md` đều là loại file được docs hỗ trợ làm default cho cả org. Thiếu (optional): `FUNDING.yml`, `CITATION.cff`, `ACCESSIBILITY.md`, `VULNERABILITY_REPORT.yml`. ([docs][default-health])
3. **Lỗi xác nhận (P0):** `ISSUE_TEMPLATE/config.yml` đang link tới `https://github.com/ThanhNguyxn-Org/.github/blob/main/SUPPORT.md` — org `ThanhNguyxn-Org` **không tồn tại (404)**, URL đúng phải là `https://github.com/ThanhNguyxnOrg/.github/blob/main/SUPPORT.md`. Verify live ngày 2026-10-10. ([live][org-404])
4. **Sticker/badge chỉ nên dùng 3 họ chính chủ:** `shields.io` (static badges), `capsule-render` (header/footer), `komarev.com/ghpvc` (view counter) + optional `skillicons.dev` (icon strip). **Không nên** dùng `anuraghazra/github-readme-stats` cho org vì repo gốc đã archived + stats theo user chứ không phải org, dễ vỡ. ([src][shields-static], [src][capsule], [src][komarev], [src][grs])
5. **Tech stack profile hiện tại SAI thực tế:** profile đang show C/C++/Java/C#/React/Next.js — trong khi Top languages live là TypeScript/JavaScript/Python/Go/PowerShell + Rust/Vue. Cần thay bằng badges đúng stack (bảng ở E). ([live][org])
6. **Đề xuất cấu trúc mới (giữ gọn):** Header capsule + tagline live + About ngắn + Showcase table 16 repos + Tech stack (shields + skillicons) + Stats tối thiểu + Philosophy rút gọn 3 dòng + Pinned strategy + Footer capsule. Bỏ/gộp các section dài dòng hiện tại (Why Exists, What You'll Find, Migration Note chi tiết → link sang `docs/`).

---

## Sources (primary only)

| # | Nguồn | URL chính chủ | Dùng cho |
|---|-------|---------------|----------|
| S1 | GitHub Docs — Customizing your organization's profile | https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/customizing-your-organizations-profile | A: vị trí `profile/README.md`, pin 6 repos, GFM |
| S2 | GitHub Docs — Creating a default community health file | https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file | A: `.github` public, thứ tự ưu tiên, danh sách file hỗ trợ |
| S3 | GitHub Docs — About issue and PR templates | https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates | A+D: `ISSUE_TEMPLATE/config.yml`, frontmatter `name/about`, override rule |
| S4 | GitHub Docs — About CITATION files | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-citation-files | A: `CITATION.cff` optional, format `cff-version: 1.2.0` |
| S5 | Shields.io — Static Badges | https://shields.io/docs/static-badges | C: syntax `https://img.shields.io/badge/<label>-<message>-<color>` |
| S6 | Shields.io — Logos (SimpleIcons slugs) | https://shields.io/docs/logos | C: `?logo=<slug>&logoColor=...`, slug lấy từ simpleicons.org/slugs.md |
| S7 | capsule-render — README (kyechan99) | https://github.com/kyechan99/capsule-render | C: params `type/color/height/section/text/fontSize/animation/fontAlignY`, best-effort warning |
| S8 | komarev GHPVC — README (antonkomarev) | https://github.com/antonkomarev/github-profile-views-counter | C: syntax `https://komarev.com/ghpvc/?username=...&color=&style=&label=&base=&abbreviated=` |
| S9 | skill-icons — README (tandpfun) | https://github.com/tandpfun/skill-icons | C: syntax `https://skillicons.dev/icons?i=<ids>&theme=&perline=` |
| S10 | github-readme-stats — README (anuraghazra, ARCHIVED) | https://github.com/anuraghazra/github-readme-stats | C: cảnh báo archived, successor là stats-organization/github-stats-extended |
| S11 | Org live — ThanhNguyxnOrg profile | https://github.com/ThanhNguyxnOrg | B: tagline, Top langs, topics, popular repos |
| S12 | Repo live — .github | https://github.com/ThanhNguyxnOrg/.github | B+D: About text, verify URL đúng |
| S13 | URL sai — ThanhNguyxn-Org (404) | https://github.com/ThanhNguyxn-Org | D: confirm org sai không tồn tại |
| S14 | SimpleIcons slugs | https://github.com/simple-icons/simple-icons/blob/master/slugs.md | C+E: slug chuẩn cho shields `logo=` |

Local files đã đọc trước khi viết (2026-10-10): `profile/README.md` (152 dòng), `README.md` (56 dòng), `docs/migration.md`, `docs/philosophy.md`, `docs/projects.md`, `docs/stack.md`, `ISSUE_TEMPLATE/config.yml` (5 dòng), `bug_report.md`, `feature_request.md`, `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`, `PULL_REQUEST_TEMPLATE.md`.

---

## A) GitHub official — org profile + community health files

### A1. Org profile via `.github/profile/README.md`

- **Vị trí chuẩn:** tạo repo public tên `.github` trong org → tạo file `profile/README.md` → nội dung hiện ở tab Overview. Repo local đã làm đúng (`profile/README.md` tồn tại, `.github` public live). ([S1][org-profile])
- **Member-only (optional):** nếu muốn README riêng cho member thì tạo repo private `.github-private` + `profile/README.md`. Không bắt buộc cho org cá nhân hiện tại. ([S1][org-profile])
- **Pinned repos:** tối đa **6 repos public + 6 repos member**, chỉ organization owner mới pin được, thao tác trên UI profile (View as → Customize pins). Section "📌 Pinned Repositories" trong profile hiện tại chỉ là text mô tả — đúng theo docs thì pin thật phải làm trên UI, không phải viết list trong README. Nên sửa section này thành "Pinned strategy" (sẽ pin gì) thay vì liệt kê mơ hồ. ([S1][org-profile])
- **Syntax:** README hỗ trợ **GitHub Flavored Markdown** — emoji, images, GIFs đều OK. Nghĩa là `<div align="center">`, `<img>`, shields, capsule-render đều hợp lệ, không vi phạm policy. ([S1][org-profile])
- **Giới hạn:** docs không nêu hard limit ký tự cho org README; best practice từ docs là giữ "About + guidance for getting help" ngắn gọn. Profile hiện tại 152 dòng, 8 sections trùng ý (`Why Exists` ≈ `Migration Note` ≈ `docs/migration.md`) → nên rút gọn, link sang `docs/` thay vì lặp lại. ([S1][org-profile])

### A2. Community health files (default cho cả org)

- **Repo chứa:** phải là repo `.github` **public**. GitHub dùng file default cho mọi repo trong org **chưa có file riêng**. ([S2][default-health])
- **Thứ tự ưu tiên khi resolve:** `.github/` folder → root → `docs/` (trong từng repo, rồi mới sang `.github` repo). ([S2][default-health])
- **Danh sách được hỗ trợ (đối chiếu local):**

| File | Trạng thái local | Docs nói gì |
|------|------------------|-------------|
| `CODE_OF_CONDUCT.md` | ✅ có | hỗ trợ default ([S2][default-health]) |
| `CONTRIBUTING.md` | ✅ có | hỗ trợ default ([S2][default-health]) |
| `SECURITY.md` | ✅ có, thiếu contact point | hỗ trợ default; docs gợi ý dùng Security Advisories flow ([S2][default-health]) |
| `SUPPORT.md` | ✅ có | hỗ trợ default ([S2][default-health]) |
| `ISSUE_TEMPLATE/` + `config.yml` | ✅ có bug/feature + config (có lỗi URL, xem D) | hỗ trợ; `config.yml` custom template chooser ([S3][issue-tpl]) |
| `PULL_REQUEST_TEMPLATE.md` | ✅ có ở root | hỗ trợ; cho phép ở root / `docs/` / `.github/` ([S3][issue-tpl]) |
| `FUNDING.yml` | ❌ chưa có | hỗ trợ, **phải đặt trong `.github/`** (không phải root) ([S2][default-health]) |
| `CITATION.cff` | ❌ chưa có | **không phải default file** — chỉ có tác dụng khi đặt trong từng repo riêng; đặt trong `.github` repo không lan tỏa. Nếu muốn, thêm vào từng repo flagship (SkillGauge, awesome-cert-sherpa). Format `cff-version: 1.2.0` ([S4][citation]) |
| `ACCESSIBILITY.md` / `VULNERABILITY_REPORT.yml` | ❌ chưa có | hỗ trợ nhưng optional, chưa cần cho org cá nhân ([S2][default-health]) |
| `LICENSE` | ❌ (đúng) | **không được tạo default** — docs cấm, license phải ở từng repo ([S2][default-health]) |

- **Rule override quan trọng:** nếu 1 repo tự định nghĩa `ISSUE_TEMPLATE/` riêng thì **toàn bộ** default `ISSUE_TEMPLATE/` của `.github` bị bỏ qua (không merge). ([S2][default-health])
- **Rule labels:** nếu issue template set `labels: bug` thì label đó **phải tồn tại** trong `.github` repo **và** mọi repo áp dụng. Local đang dùng `labels: bug` / `labels: enhancement` — cần đảm bảo 16 repos đều có 2 labels này, nếu không template sẽ lỗi thầm lặng. ([S2][default-health])
- **Checklist community profile:** issue template `.md` cần frontmatter `name:` + `about:`; issue form `.yml` cần `name:` + `description:`; file phải nằm ở `.github/ISSUE_TEMPLATE` trên default branch. Local đã đúng (`name: "🐛 Bug report"`, `about: ...`). ([S3][issue-tpl])

---

## B) Live org thực tế (verify 2026-10-10)

Verify bằng fetch trực tiếp [org page][org] và [.github repo][github-meta]:

- **Tagline live (giữ nguyên khi viết profile mới):** `An independent technology practice focused on building, exploring, and evolving ideas.` ([S11][org])
- **About `.github` repo live:** `Organization profile and community health files for ThanhNguyxnOrg`. ([S12][github-meta])
- **Số lượng:** org page hiển thị `Showing 10 of 16 repositories` → khớp claim 16 repos (15 code + 1 `.github`). ([S11][org])
- **Top languages live:** TypeScript, JavaScript, Python, Go, PowerShell. ([S11][org])
- **Most used topics live:** `developer-tools`, `ai-agents`, `typescript`, `python`, `static-analysis`. ([S11][org])
- **Popular repos (có stars, nên ưu tiên pin/showcase):**
  - `blendops` — JavaScript, 3★ — "AI-native Blender workflow and skill pack…" ([S11][org])
  - `lumeo` — JavaScript, 2★ — bilingual captions + AI dubbing ([S11][org])
  - `apidex-hub` — TypeScript, 1★ — curated free APIs ([S11][org])
  - `awesome-cert-sherpa` — TypeScript, 1★ — IT cert prep, 1590+ questions ([S11][org])
  - `Snapbooth` — TypeScript, 1★ — browser photobooth ([S11][org])
  - `PurgeKit` — Rust, 1★ — Windows uninstaller/deep cleaner ([S11][org])
- **10 repos thấy ở trang 1:** SkillGauge (TS), apidex-hub (TS), lagvex (Go), awesome-cert-sherpa (TS), lumeo (JS), LayoutLingua (Python), PurgeKit (Rust), Locsight (TS), git-account-switcher (PowerShell), cogmint (Vue). 6 repos còn lại (theo task + pagination): judgeloom-core, StepDSA, ForgeHelm, Snapbooth, blendops, .github — cần mở tab `?tab=repositories` để verify full list khi implement, nhưng không blocker. ([S11][org])
- **Mismatch vs profile hiện tại:** profile đang khoe `C, C++, Java, C#, React, Next.js, Bootstrap, MySQL, MongoDB` — **không repo nào trong top-10 dùng stack này làm primary lang**. `docs/stack.md` cũng lặp lại list cũ. Đây là finding quan trọng nhất cho E: phải thay stack. ([S11][org] vs `profile/README.md:66-79`, `docs/stack.md:11-47`)

---

## C) Markdown decoration — primary sources, syntax chuẩn, giới hạn

### C1. shields.io (static badges) — NÊN DÙNG, core sticker

- **Syntax chuẩn:** `https://img.shields.io/badge/<label>-<message>-<color>` + query `?style=for-the-badge&logo=<slug>&logoColor=white`. Ví dụ docs: `https://img.shields.io/badge/with%20a%20logo-grey?style=for-the-badge&logo=javascript`. ([S5][shields-static])
- **Màu:** hex không `#` (ví dụ `3178C6`) hoặc tên CSS. Profile hiện tại đã đúng (`C%2B%2B-00599C`, `TypeScript-3178C6`). ([S5][shields-static])
- **Logo:** mọi logo lấy từ **SimpleIcons**, tham chiếu bằng **slug** (không phải tên hiển thị). Click icon title trên simpleicons.org để copy slug, hoặc tra `slugs.md`. Lưu ý docs: SimpleIcons site có thể có icon mới chưa sync sang shields. ([S6][shields-logos])
- **Slug dễ sai (tra trước khi dùng):** `c` → `logo=c`, `c++` → `logo=cplusplus` (local đang dùng `logo=c%2B%2B` vẫn render nhưng slug chuẩn là `cplusplus`), `c#` → `logo=csharp` (local `c-sharp` OK alias), `vscode`/`visual studio code`, `windows`, `linux`, `git`, `github`, `openjdk` cho Java. Cho stack mới: `rust`, `go`, `python`, `typescript`, `javascript`, `tauri`, `vuedotjs` (không phải `vue`), `svelte`, `powershell`, `docker`, `nodedotjs` (không phải `nodejs`). ([S6][shields-logos], [S14][slugs])
- **Style:** `flat` / `flat-square` / `plastic` / `for-the-badge` / `social`. Profile dùng `for-the-badge` cho stack + `flat-square` cho counter — hợp lý. ([S5][shields-static])
- **Rate/limit:** shields là free CDN, có metrics page; badge tĩnh không cần API key, cache vài phút — an toàn cho org profile. Không nhúng quá ~20 badges/dòng để tránh layout vỡ trên mobile.

### C2. capsule-render (header/footer) — NÊN DÙNG, giữ 2 cái

- **Syntax chuẩn:** `https://capsule-render.vercel.app/api?type=<type>&color=<color>&height=<n>&section=<header|footer>&text=<url-encoded>&fontSize=<n>&animation=<fadeIn|scaleIn|blink|blinking|twinkling>&fontAlignY=<0-100>` (+ `desc`, `fontColor`, `stroke`, `theme`, `reversal`). ([S7][capsule])
- **Types hợp lệ:** `wave egg shark slice rect soft rounded cylinder waving venom speech blur pulse checkered transparent`. Local đang dùng `waving` (profile) + `rect` (health files) + `soft` (docs) — phân biệt tốt, nên giữ convention này. ([S7][capsule])
- **Lưu ý ký tự:** không dùng `# & /` thô trong `text/desc`, chỉ dùng `%20` (space) và `-nl-` (newline). Local đã encode đúng (`ThanhNguyxn%20Workspace%20Meta%20Repo`). ([S7][capsule])
- **Giới hạn quan trọng (trích README gốc):** "This service is provided on a **best-effort basis and may be unstable due to usage limits or traffic spikes**. For reliable use, please **fork and deploy to your own Vercel instance**." → giữ ≤3 capsule/image động trên 1 README, luôn set `width="100%"` như local đang làm. ([S7][capsule])

### C3. komarev ghpvc (view counter) — NÊN GIỮ, sửa đúng canonical

- **Canonical repo:** `antonkomarev/github-profile-views-counter` (5k★, docs đầy đủ params). Không phải bản fork `arturssmirnovs` (archived 2023). ([S8][komarev])
- **Syntax chuẩn:** `https://komarev.com/ghpvc/?username=<org-or-user>&color=<hex|named>&style=<flat|flat-square|plastic|for-the-badge|pixel>&label=<TEXT+WITH+PLUS>&base=<n>&abbreviated=<true>`. ([S8][komarev])
- **Local hiện tại:** `https://komarev.com/ghpvc/?username=ThanhNguyxnOrg&label=Profile%20Views&color=0e75b6&style=flat-square` — đúng syntax (label encode `%20` OK, `+` cũng OK), `username=ThanhNguyxnOrg` đúng org. Giữ nguyên. ([S8][komarev] + `profile/README.md:6`)
- **Lưu ý đếm:** counter đếm **page hits qua GitHub Camo proxy**, không phải unique visitors; reload cũng +1. Đừng quảng cáo là "unique visitors". ([S8][komarev])

### C4. skillicons.dev — NÊN THÊM (thay dãy shields dài)

- **Syntax chuẩn:** `https://skillicons.dev/icons?i=<id1,id2,...>&theme=<dark|light>&perline=<1-50>`. Ví dụ: `https://skillicons.dev/icons?i=js,html,css,wasm`. Center bằng `<p align="center">`. ([S9][skillicons])
- **IDs đã verify tồn tại (từ icons list gốc):** `ts js py go rust c cpp cs java powershell vue svelte tauri nodejs express nextjs react tailwind docker git github githubactions vscode windows linux md` — đủ cover toàn bộ stack org (xem bảng E). Lưu ý: Vue là `vue`, TS là `ts`, Python là `py`, Go là `go`, C# là `cs`, PowerShell là `powershell`, Tauri là `tauri`. ([S9][skillicons])
- **Hạ tầng:** powered by Cloudflare Workers, default `perline=15`, theme dark. Nhẹ hơn 12 shields rời. Khuyến nghị: 1 strip skillicons (perline=9-10) + giữ shields `for-the-badge` chỉ cho 5-6 stack chính. ([S9][skillicons])

### C5. github-readme-stats — KHÔNG NÊN cho org profile

- **Repo gốc `anuraghazra/github-readme-stats` đã ARCHIVED**, banner: "no longer maintained, use successor **stats-organization/github-stats-extended**". ([S10][grs])
- **Lý do kỹ thuật:** stats card tính theo **user** (`?username=`), không có endpoint org tổng hợp 16 repos; self-host cần PAT + chịu GitHub API rate limit; public Vercel instance hay 429/timeout. Thêm vào org profile = sticker chết. Nếu vẫn muốn stats, chỉ dùng cho từng repo flagship riêng, dùng successor fork. ([S10][grs])

---

## D) Lỗi đã phát hiện — `ISSUE_TEMPLATE/config.yml` link sai org

- **File:** `ISSUE_TEMPLATE/config.yml:4` — `url: https://github.com/ThanhNguyxn-Org/.github/blob/main/SUPPORT.md`. ([local][config])
- **Verify:**
  - `https://github.com/ThanhNguyxn-Org` → **404** (org không tồn tại). ([S13][org-404])
  - `https://github.com/ThanhNguyxnOrg` → 200, tagline đúng. ([S11][org])
  - `https://github.com/ThanhNguyxnOrg/.github` → 200, đúng repo meta. ([S12][github-meta])
- **Kết luận:** typo thừa dấu `-` (`ThanhNguyxn-Org` vs `ThanhNguyxnOrg`). Mọi contact_link trong config trỏ 404 → user click "📘 Support Guidelines" khi tạo issue sẽ gặp trang lỗi. **Mức P0, sửa 1 dòng.**
- **URL đúng:** `https://github.com/ThanhNguyxnOrg/.github/blob/main/SUPPORT.md`.
- **Check thêm (không lỗi):** `bug_report.md` / `feature_request.md` không chứa URL cứng → không ảnh hưởng. `SUPPORT.md`/`SECURITY.md` không self-link sai.

---

## E) Đề xuất cấu trúc profile mới

### E1. Nguyên tắc (từ docs + live data)

1. Tagline = câu live trên org page, không sáng tác mới. ([S11][org])
2. Stack = Top langs + topics live, không show ngôn ngữ không có repo. ([S11][org])
3. Mỗi section dài >10 dòng phải có bản chi tiết ở `docs/` và profile chỉ giữ 3-5 bullets + link. ([S1][org-profile])
4. Tổng sticker động ≤4 (2 capsule + 1 ghpvc + 1 skillicons) để tránh best-effort outage. ([S7][capsule])

### E2. Sections: giữ / bỏ / gộp

| Section hiện tại (`profile/README.md`) | Quyết định | Lý do |
|----------------------------------------|-----------|-------|
| capsule header `Hi there, I'm Thanh!` | 🔁 SỬA text → `ThanhNguyxnOrg` + `desc=tagline live` | Text hiện tại là personal ("I'm Thanh"), org page là practice — dùng `text=ThanhNguyxnOrg&desc=An%20independent%20technology%20practice...` ([S11][org], [S7][capsule]) |
| ghpvc + 3 badges generic | 🔁 GIỮ ghpvc, THAY 3 badges → `16 repos` / `Top: TS·JS·Py·Go` / `developer-tools·ai-agents` | Badges hiện tại (Personal-Org, Rebuilding-Legacy, Student-Builder) không khớp tagline "practice" ([S11][org]) |
| 🚀 About This Personal Workspace (11 dòng) | 🔁 GIỮ nhưng rút còn 5 bullets | Giữ ý "structured place", bỏ liệt kê chung chung; thêm link org `https://github.com/ThanhNguyxnOrg` |
| ♻️ Why This Workspace Exists | ❌ BỎ khỏi profile, link `docs/philosophy.md` | Trùng 80% với Migration Note + docs/philosophy |
| 🌌 What You'll Find Here | ❌ BỎ, thay bằng Showcase table | Liệt kê loại repo chung chung không giá trị bằng table 16 repos thật |
| 🛠 Tech Stack & Tools (12 shields sai) | 🔁 THAY toàn bộ (xem E3) | Mismatch B — không repo nào primary C/Java/C# ([S11][org]) |
| 💭 Building Philosophy (13 dòng) | 🔁 RÚT còn 3 dòng + link `docs/philosophy.md` | Giữ quote "real growth should be visible, organized, and honest" |
| 📦 Migration Note | ❌ BỎ khỏi profile, link `docs/migration.md` | Đã có docs riêng, không lặp |
| 📌 Pinned Repositories (text mô tả) | 🔁 THÀNH "Pinned strategy" 2 dòng + pin thật 6 repos trên UI | Docs: pin làm trên UI, tối đa 6 ([S1][org-profile]); gợi ý pin: blendops, lumeo, apidex-hub, awesome-cert-sherpa, PurgeKit, SkillGauge |
| ❤️ Support My Journey | 🔁 GỘP thành 2 dòng cuối About | Không cần section riêng |
| 🌠 Final Note + footer badges + capsule footer | 🔁 GIỮ footer capsule, THAY 3 badges cuối → `Docs` / `Support` / `Security` link tới file thật | Tăng navigation, giảm "Made with 💜" generic |
| ➕ Showcase table (MỚI) | ✅ THÊM | Bảng 16 repos: Name \| One-line desc (lấy từ GitHub) \| Lang badge \| Topics — đây là "sticker md" có giá trị nhất vì là data thật |
| ➕ skillicons strip (MỚI) | ✅ THÊM | 1 dòng `?i=ts,js,py,go,rust,powershell,vue,svelte,tauri,docker&perline=10` ([S9][skillicons]) |

### E3. Sticker/badge cho từng stack (syntax copy-paste được)

**A. skillicons strip (1 dòng, đặt ngay dưới About):**
```md
<p align="center">
  <a href="https://skillicons.dev">
    <img src="https://skillicons.dev/icons?i=ts,js,py,go,rust,powershell,vue,svelte,tauri,docker,nodejs,express,git,githubactions,vscode&perline=8" />
  </a>
</p>
```
IDs verify từ [icons list gốc][skillicons]: `ts js py go rust powershell vue svelte tauri docker nodejs express git githubactions vscode` đều tồn tại.

**B. shields `for-the-badge` (chỉ 6 chính + 2 phụ, đúng màu brand):**

| Stack | Badge URL chuẩn | Logo slug ([S6][shields-logos]) |
|-------|-----------------|---------------------------------|
| TypeScript | `https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white` | `typescript` |
| JavaScript | `https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black` | `javascript` |
| Python | `https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white` | `python` |
| Go | `https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=go&logoColor=white` | `go` |
| Rust | `https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white` | `rust` |
| PowerShell | `https://img.shields.io/badge/PowerShell-5391FE?style=for-the-badge&logo=powershell&logoColor=white` | `powershell` |
| Vue (cogmint) | `https://img.shields.io/badge/Vue-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white` | `vuedotjs` ⚠️ không phải `vue` |
| Tauri (Locsight) | `https://img.shields.io/badge/Tauri-24C8DB?style=for-the-badge&logo=tauri&logoColor=white` | `tauri` |
| Svelte (nếu dùng) | `https://img.shields.io/badge/Svelte-FF3E00?style=for-the-badge&logo=svelte&logoColor=white` | `svelte` |
| Docker | `https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white` | `docker` |

**C. Header/footer capsule (giữ `waving`, thêm `desc`):**
```md
<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&height=200&section=header&text=ThanhNguyxnOrg&fontSize=42&animation=fadeIn&fontAlignY=38&desc=An%20independent%20technology%20practice&descSize=18&descAlignY=55" width="100%"/>
<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&height=100&section=footer" width="100%"/>
```
Params theo [README gốc][capsule]: `type/section/height/text/desc/fontSize/descSize/animation/fontAlignY/descAlignY` đều hợp lệ.

**D. Counter (giữ, không thêm base/abbreviated trừ khi cần):**
```md
<img src="https://komarev.com/ghpvc/?username=ThanhNguyxnOrg&label=Profile%20Views&color=0e75b6&style=flat-square" alt="ThanhNguyxnOrg views" />
```
([S8][komarev])

### E4. Pinned strategy (làm trên UI, không phải trong md)

Theo [docs][org-profile], owner pin tối đa 6. Đề xuất theo stars + đại diện stack:
1. `blendops` (JS, 3★ cao nhất) — AI workflow
2. `lumeo` (JS, 2★) — AI dubbing
3. `apidex-hub` (TS) — curated APIs
4. `awesome-cert-sherpa` (TS) — cert prep 1590+ Q
5. `PurgeKit` (Rust) — đại diện systems
6. `SkillGauge` (TS) — static auditing / ai-agents (khớp topic `ai-agents, static-analysis`)

---

## Recommended edits (theo file cụ thể)

| # | File | Edit | Ưu tiên |
|---|------|------|---------|
| 1 | `ISSUE_TEMPLATE/config.yml:4` | `ThanhNguyxn-Org` → `ThanhNguyxnOrg`: `url: https://github.com/ThanhNguyxnOrg/.github/blob/main/SUPPORT.md` | **P0 — làm ngay** |
| 2 | `profile/README.md` (rewrite) | Áp dụng cấu trúc E2: header mới + About 5 bullets + Showcase table 16 repos + skillicons strip + 6-8 shields đúng stack (E3) + Philosophy 3 dòng + Pinned strategy 2 dòng + footer capsule. Xóa `Why Exists / What You'll Find / Migration Note` dài, thay bằng link `docs/` | P1 |
| 3 | `docs/stack.md` | Thay list C/C++/Java/C#/React/Next.js/Bootstrap/MySQL/MongoDB → stack thật: TS/JS/Python/Go/Rust/PowerShell + Vue/Svelte/Tauri/Node/Express/Docker/GitHub Actions. Đồng bộ với E3 | P1 |
| 4 | `docs/projects.md` | Thêm Showcase table 16 repos (copy desc từ GitHub, kèm lang + topics `developer-tools, ai-agents, static-analysis`), để profile link sang thay vì liệt kê loại repo chung chung | P1 |
| 5 | `README.md` (repo meta) | Đổi capsule text `ThanhNguyxn Workspace Meta Repo` → `ThanhNguyxnOrg · .github` + thêm dòng tagline live; liệt kê `docs/research/` vào What's inside | P2 |
| 6 | `SECURITY.md` | Thêm contact point (issue private/security advisory hay email?) + scope "16 repos, support varies" đã có thì giữ; thêm link `https://github.com/ThanhNguyxnOrg/.github/security/advisories/new` nếu bật Private vulnerability reporting | P2 |
| 7 | `SUPPORT.md` | Thêm link đúng org + bảng "repo nào active (blendops/lumeo/…) vs archive" để set expectation (khớp SUPPORT.md:50-60 hiện tại) | P2 |
| 8 | (optional, từng repo flagship) | Thêm `CITATION.cff` (`cff-version: 1.2.0`) vào `SkillGauge`, `awesome-cert-sherpa`, `apidex-hub` — **không** thêm vào `.github` repo vì không lan tỏa ([S4][citation]) | P3 |
| 9 | (optional) | Thêm `.github/FUNDING.yml` nếu muốn sponsor button; verify labels `bug` + `enhancement` tồn tại ở cả 16 repos (do template đang set) | P3 |
| 10 | (không làm) | Không thêm `github-readme-stats` card vào org profile (archived + sai scope org) ([S10][grs]); không thêm `ACCESSIBILITY.md`/`VULNERABILITY_REPORT.yml` lúc này | — |

---

## Local ↔ Live cross-check (để implementer dùng ngay)

- Local `profile/README.md:2` capsule `text=Hi%20there,%20I'm%20Thanh!` → live org là practice → đổi (E2).
- Local `profile/README.md:6` ghpvc `username=ThanhNguyxnOrg` → đúng, giữ.
- Local `profile/README.md:7-9` badges Personal/Rebuilding/Student → thay (E2).
- Local `profile/README.md:66-79` stack C/Java/C#/React/Next → thay toàn bộ (E3).
- Local `ISSUE_TEMPLATE/config.yml:4` → sửa P0 (D).
- Local `docs/stack.md:11-47` → sync lại (edit #3).
- Live topics `developer-tools, ai-agents, static-analysis` → thêm làm badges/topics row trong Showcase.

---

[org-profile]: https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/customizing-your-organizations-profile
[default-health]: https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file
[issue-tpl]: https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates
[citation]: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-citation-files
[shields-static]: https://shields.io/docs/static-badges
[shields-logos]: https://shields.io/docs/logos
[slugs]: https://github.com/simple-icons/simple-icons/blob/master/slugs.md
[capsule]: https://github.com/kyechan99/capsule-render
[komarev]: https://github.com/antonkomarev/github-profile-views-counter
[skillicons]: https://github.com/tandpfun/skill-icons
[grs]: https://github.com/anuraghazra/github-readme-stats
[org]: https://github.com/ThanhNguyxnOrg
[github-meta]: https://github.com/ThanhNguyxnOrg/.github
[org-404]: https://github.com/ThanhNguyxn-Org
[config]: ../ISSUE_TEMPLATE/config.yml
