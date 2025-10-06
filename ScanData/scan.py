#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Crawl study4.com flashcards list 1835 -> JSON + CSV + STATS(JSON)
- Có hỗ trợ đăng nhập bằng cookie (sessionid, csrftoken, ...).
- Điền COOKIE_STR bên dưới (chuỗi "key=value; key2=value2; ...").
"""
import csv
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import urljoin
from collections import Counter, defaultdict

import requests
from bs4 import BeautifulSoup
from requests.utils import cookiejar_from_dict

BASE = "https://study4.com"
LIST_ID = 354
LIST_URL = f"https://study4.com/flashcards/lists/{LIST_ID}/"
PAGES_COUNT = 16

# ==== NHẬP COOKIE Ở ĐÂY (hoặc để trống và đặt qua biến môi trường COOKIE_STR) ====
COOKIE_STR = os.getenv("COOKIE_STR", "").strip() or (
    "_ym_uid=1759729229214189281; _ym_d=1759729229; _ym_isad=1; "
    "csrftoken=FCLVFvQcutLIxsNKOQ3XTYf9ahpSIfTzvlZ4wGqoFyKRbqiWcYekRqnrXzZscMsW; "
    "sessionid=3e9cndx9lp9i6dgava6ylbn7ol0fj0k7"
)
# ================================================================================

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "vi,en;q=0.9",
    "Referer": LIST_URL,
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)

def apply_cookie_string(cookie_str: str, domain="study4.com"):
    """Parse "k=v; k2=v2" -> CookieJar gán vào SESSION.cookies"""
    cookie_dict = {}
    for part in cookie_str.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            k = k.strip()
            v = v.strip()
            if k:
                cookie_dict[k] = v
    jar = cookiejar_from_dict(cookie_dict, cookiejar=None, overwrite=True)
    SESSION.cookies.update(jar)

def get_soup(url: str) -> BeautifulSoup:
    for attempt in range(3):
        r = SESSION.get(url, timeout=20, allow_redirects=True)
        if r.status_code == 200:
            html = r.text
            try:
                return BeautifulSoup(html, "lxml")
            except Exception:
                return BeautifulSoup(html, "html.parser")
        time.sleep(1.2 * (attempt + 1))
    r.raise_for_status()

def extract_text(el) -> str:
    return re.sub(r"\s+", " ", (el.get_text(" ", strip=True) if el else "")).strip()

def parse_item(block, page_num: int) -> dict:
    h2 = block.select_one("h2.h3")
    word = pos = ipa = audio_url = ""
    if h2:
        direct_text_nodes = [t for t in h2.contents if isinstance(t, str)]
        if direct_text_nodes:
            word = direct_text_nodes[0].strip()

        for sp in h2.find_all("span"):
            txt = sp.get_text(strip=True)
            if re.fullmatch(r"\(.*\)", txt):
                pos = txt.strip("()")
                break

        for sp in h2.find_all("span"):
            txt = sp.get_text(strip=True)
            if re.match(r"^/.+/$", txt):
                ipa = txt
                break

        audio = h2.select_one(".jq-audio-player audio source[src], .jq-audio-player audio[src]")
        if audio and audio.get("src"):
            audio_url = urljoin(BASE, audio["src"])

    definition_vi = ""
    for label in block.select("div.font-500"):
        if "Định nghĩa" in extract_text(label):
            nxt = label.find_next_sibling()
            if nxt and nxt.name == "div":
                definition_vi = extract_text(nxt)
            break

    examples_vi = [extract_text(li) for li in block.select("ul.termlist-item-examples li")]

    img_url = ""
    img = block.select_one(".termlist-item-images img")
    if img:
        src = img.get("src") or img.get("data-src") or img.get("data-lazy") or img.get("data-original")
        if src:
            img_url = urljoin(BASE, src)

    return {
        "word": word,
        "part_of_speech": pos,
        "ipa": ipa,
        "definition_vi": definition_vi,
        "examples_vi": examples_vi,
        "image_url": img_url,
        "audio_url": audio_url,
        "page": page_num,
    }

def get_last_page(soup: BeautifulSoup) -> int:
    pages = []
    for a in soup.select(".pagination .page-item a.page-link"):
        txt = (a.get_text(strip=True) or "").strip()
        if txt.isdigit():
            pages.append(int(txt))
    return max(pages) if pages else 1

def assert_logged_in(soup: BeautifulSoup):
    items = soup.select(".termlist-item.contentblock")
    if not items:
        body_text = extract_text(soup)
        if "Đăng nhập" in body_text or "Đăng ký" in body_text or "login" in body_text.lower():
            raise RuntimeError("Có vẻ chưa đăng nhập: kiểm tra lại COOKIE_STR (sessionid/csrftoken).")

def crawl_list(list_url: str = LIST_URL) -> list:
    data = []
    soup = get_soup(list_url)
    assert_logged_in(soup)
    last = PAGES_COUNT
    def parse_page(s, pnum):
        for block in s.select(".termlist-item.contentblock"):
            item = parse_item(block, pnum)
            if item["word"]:
                data.append(item)

    parse_page(soup, 1)
    print(f"[+] Parsed page 1 / {last} -> {len(data)} items")
    time.sleep(0.5)

    for p in range(2, last + 1):
        url = f"{list_url}?page={p}"
        s = get_soup(url)
        parse_page(s, p)
        print(f"[+] Parsed page {p} / {last} -> {len(data)} items")
        time.sleep(0.5)

    return data

def save_json_csv(items: list, out_dir: Path = Path("./output")):
    out_dir.mkdir(parents=True, exist_ok=True)

    json_path = out_dir / "study4_list_1835.json"
    with json_path.open("w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"[✓] Saved JSON -> {json_path.resolve()}")

    csv_path = out_dir / "study4_list_1835.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "word", "part_of_speech", "ipa", "definition_vi",
            "examples_vi (| separated)", "image_url", "audio_url", "page"
        ])
        for it in items:
            writer.writerow([
                it.get("word", ""),
                it.get("part_of_speech", ""),
                it.get("ipa", ""),
                it.get("definition_vi", ""),
                " | ".join(it.get("examples_vi", [])),
                it.get("image_url", ""),
                it.get("audio_url", ""),
                it.get("page", ""),
            ])
    # print(f"[✓] Saved CSV  -> {csv_path.resolve()}")

def save_stats(items: list, out_dir: Path = Path("./output")):
    """
    Xuất thống kê ra JSON: study4_list_1835_stats.json
    - total_items, unique_words
    - counts_by_part_of_speech
    - has_image / has_audio
    - avg_examples_per_word
    - pages_count + items_by_page
    - duplicated_words (top 20)
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    total_items = len(items)
    words = [it.get("word", "") for it in items]
    unique_words = len(set(words))
    dup_counter = Counter(words)
    duplicated_words = [{"word": w, "count": c} for w, c in dup_counter.items() if c > 1]
    duplicated_words.sort(key=lambda x: x["count"], reverse=True)
    duplicated_words = duplicated_words[:20]

    pos_counter = Counter((it.get("part_of_speech") or "").strip().lower() for it in items)
    if "" in pos_counter:
        # Quy ước hiển thị "unknown" cho rỗng
        pos_counter["unknown"] = pos_counter.pop("")

    has_image = sum(1 for it in items if it.get("image_url"))
    has_audio = sum(1 for it in items if it.get("audio_url"))

    total_examples = sum(len(it.get("examples_vi", []) or []) for it in items)
    avg_examples = (total_examples / total_items) if total_items else 0.0

    items_by_page = defaultdict(int)
    for it in items:
        items_by_page[int(it.get("page") or 0)] += 1

    stats = {
        "list_id": 1835,
        "source_url": LIST_URL,
        "total_items": total_items,
        "unique_words": unique_words,
        "counts_by_part_of_speech": dict(pos_counter),
        "has_image_count": has_image,
        "has_audio_count": has_audio,
        "avg_examples_per_word": round(avg_examples, 3),
        "pages_count": len(items_by_page),
        "items_by_page": dict(sorted(items_by_page.items())),
        "duplicated_words_top20": duplicated_words
    }

    stats_path = out_dir / "study4_list_1835_stats.json"
    with stats_path.open("w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
    print(f"[✓] Saved STATS -> {stats_path.resolve()}")

if __name__ == "__main__":
    if COOKIE_STR:
        apply_cookie_string(COOKIE_STR)
    else:
        print("[!] COOKIE_STR đang trống. Hãy dán cookie đăng nhập vào biến COOKIE_STR.")

    items = crawl_list(LIST_URL)
    save_json_csv(items)
    # save_stats(items)
    print(f"[=] Total words: {len(items)}")
