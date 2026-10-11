"""Sync org showcase tables and stack counts into marker-delimited blocks.

Usage:
    python scripts/sync-org.py [--org ThanhNguyxnOrg] [--check]

--check prints a diff summary and exits 1 without writing anything.
Stdlib only: no third-party dependencies.
"""

import argparse
import json
import os
import re
import sys
import urllib.request
from collections import Counter

API = "https://api.github.com"
TOP6_START = "<!-- AUTO-TOP6-START -->"
TOP6_END = "<!-- AUTO-TOP6-END -->"
FULL_START = "<!-- AUTO-FULL-START -->"
FULL_END = "<!-- AUTO-FULL-END -->"
STACK_START = "<!-- AUTO-STACK-START -->"
STACK_END = "<!-- AUTO-STACK-END -->"
SKIP_NAMES = {".github"}
MAX_DESC = 100
LANG_SHORT = {
    "TypeScript": "TS",
    "JavaScript": "JS",
    "Python": "Py",
    "Go": "Go",
    "Rust": "Rust",
    "PowerShell": "PS",
    "Vue": "Vue",
    "Markdown": "Md",
}


def api_get(url, token):
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    with urllib.request.urlopen(req) as res:
        data = json.load(res)
        links = res.headers.get("Link", "")
    nxt = None
    for part in links.split(","):
        if 'rel="next"' in part:
            nxt = part[part.index("<") + 1 : part.index(">")]
    return data, nxt


def fetch_repos(org, token):
    repos, url = [], f"{API}/orgs/{org}/repos?per_page=100&type=public"
    while url:
        data, url = api_get(url, token)
        repos.extend(data)
    return [r for r in repos if not r.get("archived", False) or True]


def clean(text, limit=MAX_DESC):
    text = (text or "").replace("|", "/").replace("\r", " ").replace("\n", " ")
    text = " ".join(text.split())
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0] + "..."
    return text


def top6(repos):
    ranked = sorted(repos, key=lambda r: (-r.get("stargazers_count", 0), r["name"].lower()))
    return [r for r in ranked if r["name"] not in SKIP_NAMES][:6]


def render_top6(repos):
    lines = ["| Project | What it is | Stack | Stars |", "|---|---|---|---|"]
    for r in top6(repos):
        lines.append(
            f"| [{r['name']}](https://github.com/ThanhNguyxnOrg/{r['name']})"
            f" | {clean(r.get('description'))} | {r.get('language') or '-'}"
            f" | \u2605 {r.get('stargazers_count', 0)} |"
        )
    return "\n".join(lines)


def render_full(repos):
    lines = ["| Project | Description | Stack | Topics |", "|---|---|---|---|"]
    for r in sorted(repos, key=lambda r: (-r.get("stargazers_count", 0), r["name"].lower())):
        topics = ", ".join((r.get("topics") or [])[:3]) or "-"
        lines.append(
            f"| [{r['name']}](https://github.com/ThanhNguyxnOrg/{r['name']})"
            f" | {clean(r.get('description'))} | {r.get('language') or '-'} | {topics} |"
        )
    return "\n".join(lines)


def render_stack(repos):
    langs = Counter(r.get("language") or "Other" for r in repos)
    topics = Counter(t for r in repos for t in (r.get("topics") or []))
    lang_line = " \u00b7 ".join(f"{lang}: {langs[lang]}" for lang in sorted(langs, key=lambda l: (-langs[l], l)))
    top_topics = ", ".join(t for t, _ in topics.most_common(5)) or "-"
    return (
        "## By the numbers (live)\n\n"
        f"- Repositories tracked: {len(repos)}\n"
        f"- {lang_line}\n"
        f"- Top topics: {top_topics}"
    )


def update_file(path, start, end, block):
    with open(path, encoding="utf-8") as f:
        content = f.read()
    new_block = f"{start}\n{block}\n{end}"
    old_start, old_end = content.index(start), content.index(end) + len(end)
    old_block = content[old_start:old_end]
    if old_block == new_block:
        return False
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content[:old_start] + new_block + content[old_end:])
    return True


def update_count_badges(path, count):
    with open(path, encoding="utf-8") as f:
        content = f.read()
    new_content, n = re.subn(r"badge/\d+-Repositories", f"badge/{count}-Repositories", content)
    if n == 0 or new_content == content:
        return False
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(new_content)
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--org", default="ThanhNguyxnOrg")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN", "")
    repos = fetch_repos(args.org, token)
    count = len(repos)
    langs, topics = count_langs_topics(repos)
    targets = [
        ("profile/README.md", TOP6_START, TOP6_END, render_top6(repos)),
        ("docs/projects.md", FULL_START, FULL_END, render_full(repos)),
        ("docs/stack.md", STACK_START, STACK_END, render_stack(repos)),
    ]
    badge_targets = ["profile/README.md", "docs/projects.md"]

    if args.check:
        changed = [p for p, s, e, b in targets if would_change(p, s, e, b)]
        changed += [p for p in badge_targets if would_change_badges(p, count)]
        if would_change_top("profile/README.md", langs, topics):
            changed.append("profile/README.md (badges)")
        changed = sorted(set(changed))
        print("would update: " + (", ".join(changed) if changed else "nothing"))
        return 1 if changed else 0

    changed = [p for p, s, e, b in targets if update_file(p, s, e, b)]
    changed += [p for p in badge_targets if update_count_badges(p, count)]
    if update_top_badges("profile/README.md", langs, topics):
        changed.append("profile/README.md (badges)")
    changed = sorted(set(changed))
    print("updated: " + (", ".join(changed) if changed else "nothing"))


def would_change(path, start, end, block):
    with open(path, encoding="utf-8") as f:
        content = f.read()
    old_start, old_end = content.index(start), content.index(end) + len(end)
    return content[old_start:old_end] != f"{start}\n{block}\n{end}"


def would_change_badges(path, count):
    with open(path, encoding="utf-8") as f:
        content = f.read()
    new_content, n = re.subn(r"badge/\d+-Repositories", f"badge/{count}-Repositories", content)
    return n > 0 and new_content != content


def count_langs_topics(repos):
    langs = Counter(r.get("language") or "Other" for r in repos)
    topics = Counter(t for r in repos for t in (r.get("topics") or []))
    return langs, topics


def update_top_badges(path, langs, topics):
    with open(path, encoding="utf-8") as f:
        content = f.read()
    top4 = [LANG_SHORT.get(l, l) for l in sorted(langs, key=lambda l: (-langs[l], l))[:4]]
    content, n1 = re.subn(r"badge/Top-[^\"?]+", "badge/Top-" + "%20%C2%B7%20".join(top4), content)
    top2 = sorted(topics, key=lambda t: (-topics[t], t))[:2]
    focus = "%20%C2%B7%20".join(t.replace("-", "--") for t in top2)
    content, n2 = re.subn(r"badge/Focus-[^\"?]+", f"badge/Focus-{focus}", content)
    if n1 + n2 == 0:
        return False
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    return True


def would_change_top(path, langs, topics):
    with open(path, encoding="utf-8") as f:
        content = f.read()
    top4 = [LANG_SHORT.get(l, l) for l in sorted(langs, key=lambda l: (-langs[l], l))[:4]]
    new_content, n1 = re.subn(r"badge/Top-[^\"?]+", "badge/Top-" + "%20%C2%B7%20".join(top4), content)
    top2 = sorted(topics, key=lambda t: (-topics[t], t))[:2]
    focus = "%20%C2%B7%20".join(t.replace("-", "--") for t in top2)
    new_content, n2 = re.subn(r"badge/Focus-[^\"?]+", f"badge/Focus-{focus}", new_content)
    return n1 + n2 > 0 and new_content != content


if __name__ == "__main__":
    sys.exit(main())
