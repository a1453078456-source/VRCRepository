# -*- coding: utf-8 -*-
"""
lll个人网站 · 内容生成器
-----------------------
从 material-library/ 里的 Word 文档生成 assets/content.js：

  * 个人简介.docx   -> 头像（assets/avatar.jpg）+ 个人资料字段
  * essay/*.docx    -> 每一篇随笔的标题、日期、摘要、正文段落

用法（在 me 目录下）：
  python tools/build_content.py

以后改完 Word 文稿，重跑一次、刷新网页即可。不跑也能用（沿用上一次生成的 content.js）。
"""
import hashlib
import io
import json
import re
import sys
import zipfile
from datetime import datetime
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from PIL import Image

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
MATERIAL = ROOT / "material-library"
PROFILE_DOCX = MATERIAL / "个人简介.docx"
ESSAY_DIR = MATERIAL / "essay"
ASSETS = ROOT / "assets"
CONTENT_FILE = ASSETS / "content.js"
AVATAR_FILE = ASSETS / "avatar.jpg"

PROFILE_LABELS = ("姓名", "性别", "MBTI", "QQ", "喜欢的东西", "不喜欢的东西", "目前的状态", "简介")
READING_LABEL = "近段时间阅读的书籍"
DATE_RE = re.compile(r"(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})")
SECTION_RE = re.compile(r"^(\d{1,2})\s*[、.．]\s*\S")
LABEL_SPLIT_RE = re.compile(r"\s{2,}")


def clean(text: str) -> str:
    """去掉 Word 里排版用的首尾空白与制表符，正文内部的字符一个都不改。"""
    return text.replace("\t", "").strip()


def extract_avatar(docx_path: Path) -> bool:
    """把简介 docx 里唯一的插图取出来，压成网页用的头像。"""
    if not docx_path.exists():
        return False
    try:
        with zipfile.ZipFile(docx_path) as zf:
            media = [n for n in zf.namelist() if n.startswith("word/media/")]
            if not media:
                print(f"[avatar] {docx_path.name} 里没有图片，跳过")
                return False
            raw = zf.read(sorted(media)[0])
        with Image.open(io.BytesIO(raw)) as im:
            im = im.convert("RGB")
            im.thumbnail((900, 900), Image.LANCZOS)
            ASSETS.mkdir(exist_ok=True)
            im.save(AVATAR_FILE, "JPEG", quality=90, optimize=True)
        print(f"[avatar] {AVATAR_FILE.name}  {im.width}x{im.height}")
        return True
    except Exception as exc:  # 头像坏掉不该阻断整站
        print(f"[avatar] 提取失败：{exc}")
        return False


def read_profile(docx_path: Path) -> dict:
    """按「标签：值」整理简介。标签之间用两个以上空格分隔的情况也支持。"""
    if not docx_path.exists():
        print(f"[profile] 找不到 {docx_path}，使用空资料")
        return {}
    doc = Document(str(docx_path))
    fields = {}
    for para in doc.paragraphs:
        text = clean(para.text)
        if not text:
            continue
        for piece in LABEL_SPLIT_RE.split(text):
            piece = piece.strip()
            if not piece:
                continue
            hit = False
            for label in PROFILE_LABELS:
                if piece.startswith(label + "：") or piece.startswith(label + ":"):
                    fields[label] = piece[len(label) + 1:].strip()
                    hit = True
                    break
            if hit:
                continue
            if piece.startswith(READING_LABEL):
                fields[READING_LABEL] = piece[len(READING_LABEL):].lstrip("：: ").strip()

    likes = fields.get("喜欢的东西", "")
    tags = [t.strip() for t in re.split(r"[、,，/]", likes) if t.strip()]
    profile = {
        "name": fields.get("姓名") or "lll",
        "gender": fields.get("性别") or "",
        "mbti": fields.get("MBTI") or "",
        "qq": fields.get("QQ") or "",
        "likes": likes,
        "likeTags": tags,
        "dislikes": fields.get("不喜欢的东西") or "",
        "status": fields.get("目前的状态") or "",
        "readingLabel": READING_LABEL,
        "reading": fields.get(READING_LABEL) or "",
        "bio": fields.get("简介") or "",
        "avatar": "assets/avatar.jpg" if AVATAR_FILE.exists() else "",
    }
    missing = [k for k in ("name", "gender", "mbti", "qq", "likes", "dislikes", "status", "reading", "bio") if not profile.get(k)]
    print(f"[profile] 字段 {len(fields)} 个" + (f"，缺少：{'、'.join(missing)}" if missing else "，齐全"))
    return profile


def is_section(text: str) -> bool:
    return bool(SECTION_RE.match(text)) and len(text) <= 40


def parse_essay(path: Path) -> dict:
    doc = Document(str(path))
    title = ""
    blocks = []
    note = ""
    for para in doc.paragraphs:
        text = clean(para.text)
        if not text:
            continue
        style = para.style.name if para.style is not None else ""
        if style.lower().startswith("heading"):
            if not title:
                title = text
            else:
                blocks.append({"t": "h3", "text": text})
            continue
        if text.startswith("写于") or text.startswith("作于"):
            note = text
            continue
        if text.startswith("一些理论上的备注") or text.startswith("一些理论上的标注"):
            blocks.append({"t": "h3", "text": text})
            continue
        if style == "List Paragraph":
            blocks.append({"t": "li", "text": text})
            continue
        if is_section(text):
            blocks.append({"t": "h3", "text": text})
            continue
        if text in ("引言：", "引言:", "前言：", "前言:"):
            blocks.append({"t": "kicker", "text": text})
            continue
        blocks.append({"t": "p", "text": text})

    if not title:
        title = path.stem

    # 日期：优先用「写于 YYYY/M/D」，否则用文档修改时间
    date = None
    m = DATE_RE.search(note)
    if m:
        try:
            date = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            date = None
    if date is None:
        modified = doc.core_properties.modified
        date = datetime(modified.year, modified.month, modified.day) if modified else datetime.fromtimestamp(path.stat().st_mtime)

    # 摘要：第一段正文（跳过小标签）
    excerpt = ""
    for block in blocks:
        if block["t"] == "p":
            excerpt = re.sub(r"^(引言|前言)\s*[：:]\s*", "", block["text"])
            break
    if len(excerpt) > 120:
        excerpt = excerpt[:120].rstrip("，。、；：") + "……"

    chars = sum(len(b["text"]) for b in blocks)
    slug = "essay-" + hashlib.sha1(path.stem.encode("utf-8")).hexdigest()[:6]

    print(f"[essay] {path.name}  ->  {title}  {date:%Y.%m.%d}  {chars} 字  {len(blocks)} 段")
    return {
        "slug": slug,
        "title": title,
        "source": path.name,
        "date": date.strftime("%Y-%m-%d"),
        "dateText": f"{date.year}.{date.month:02d}.{date.day:02d}",
        "chars": chars,
        "readMin": max(1, round(chars / 380)),
        "excerpt": excerpt,
        "note": note,
        "blocks": blocks,
    }


def main():
    if not MATERIAL.is_dir():
        sys.exit(f"找不到素材目录: {MATERIAL}")
    ASSETS.mkdir(exist_ok=True)

    extract_avatar(PROFILE_DOCX)
    profile = read_profile(PROFILE_DOCX)

    essays = []
    if ESSAY_DIR.is_dir():
        for path in sorted(ESSAY_DIR.glob("*.docx")):
            if path.name.startswith("~$"):
                continue
            try:
                essays.append(parse_essay(path))
            except Exception as exc:
                print(f"[skip] {path.name}: {exc}")
    essays.sort(key=lambda e: e["date"], reverse=True)

    payload = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "profile": profile,
        "essays": essays,
        "imageBase": "material-library/image/",
        "musicBase": "material-library/music/",
    }
    body = (
        "/* lll个人网站 · 内容清单 —— 由 tools/build_content.py 从 material-library 的 Word 文档自动生成，请勿手改。\n"
        f"   最后生成：{payload['generatedAt']} · {len(essays)} 篇文章 */\n"
        "window.CUTE_CONTENT = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n"
    )
    CONTENT_FILE.write_text(body, encoding="utf-8")
    print(f"\n简介资料与 {len(essays)} 篇文章已写入 {CONTENT_FILE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
