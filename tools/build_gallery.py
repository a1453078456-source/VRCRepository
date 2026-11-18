# -*- coding: utf-8 -*-
"""
lll 的小站 · 图集素材生成器
---------------------------
扫描 material-library/image/ 里的图片，生成：
  * thumbs/<slug>.webp   网格用缩略图（宽 720，体积约为原图 3%）
  * assets/data.js       图集清单（尺寸 / 日期 / 大小 / 主色 / 模糊占位图）
同时扫描 material-library/music/ 生成播放列表。
用法（在小站目录下）：
  python tools/build_gallery.py
新增图片后重跑一次即可；不跑也能用（网站会自动回退到原图，只是加载更慢）。
"""
import base64
import io
import json
import re
import sys
import warnings
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

warnings.filterwarnings('ignore', category=DeprecationWarning)

try:  # 让中文在 chcp 65001 的 cmd 窗口里正常显示
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
MATERIAL_DIR = ROOT / "material-library"
IMAGE_DIR = MATERIAL_DIR / "image"
MUSIC_DIR = MATERIAL_DIR / "music"
THUMB_DIR = ROOT / "thumbs"
DATA_FILE = ROOT / "assets" / "data.js"
EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
AUDIO_EXTS = {".mp3", ".flac", ".m4a", ".ogg", ".wav", ".aac"}
COVER_EXTS = (".jpg", ".jpeg", ".png", ".webp")
VRC_RE = re.compile(
    r"^VRChat_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:\.(\d+))?_(\d+)x(\d+)$"
)
LRC_TIME = re.compile(r"\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]")


def slugify(stem: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", stem)[:80] or "image"


def parse_meta(stem: str):
    """从 VRChat 文件名里解析时间；解析不到就用文件修改时间。"""
    m = VRC_RE.match(stem)
    if not m:
        return None, None
    y, mo, d, hh, mm, ss = (int(m.group(i)) for i in range(1, 7))
    ms = int((m.group(7) or "0").ljust(3, "0")[:3])
    try:
        return datetime(y, mo, d, hh, mm, ss, ms * 1000), "VRChat"
    except ValueError:
        return None, None


def hex_of(rgb):
    return "#%02X%02X%02X" % tuple(int(max(0, min(255, c))) for c in rgb[:3])


def parse_lrc(path: Path):
    """解析 LRC 歌词，跳过网易云 JSON 头信息行。"""
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = []
    for raw in text.splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("{"):
            continue
        m = LRC_TIME.match(raw)
        if not m:
            continue
        minutes, seconds, frac = int(m.group(1)), int(m.group(2)), m.group(3) or "0"
        ms = int(frac.ljust(3, "0")[:3])
        body = raw[m.end():].strip()
        if not body:
            continue
        lines.append({"t": round(minutes * 60 + seconds + ms / 1000, 2), "s": body})
    lines.sort(key=lambda item: item["t"])
    return lines


def scan_music():
    """扫描 music/：音频、可选同名封面、可选同名 LRC。"""
    if not MUSIC_DIR.is_dir():
        return []
    tracks = []
    for path in sorted(p for p in MUSIC_DIR.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_EXTS):
        stem = path.stem
        title, artist = stem, ""
        if " - " in stem:
            artist, title = (part.strip() for part in stem.split(" - ", 1))

        cover = None
        for ext in COVER_EXTS:
            candidate = MUSIC_DIR / (stem + ext)
            if candidate.exists():
                with Image.open(candidate) as im:
                    im = im.convert("RGB")
                    im.thumbnail((160, 160), Image.LANCZOS)
                    side = min(im.size)
                    im = im.crop(((im.width - side) // 2, (im.height - side) // 2,
                                  (im.width + side) // 2, (im.height + side) // 2))
                    cover_name = f"music-{slugify(stem)}.jpg"
                    im.save(THUMB_DIR / cover_name, "JPEG", quality=84, optimize=True)
                    cover = f"thumbs/{cover_name}"
                break

        tracks.append({
            "file": path.name,
            "title": title,
            "artist": artist,
            "bytes": path.stat().st_size,
            "cover": cover,
            "lrc": parse_lrc(MUSIC_DIR / (stem + ".lrc")),
        })
        print(f"[music] {path.name}  cover={'yes' if cover else 'no'}  lrc={len(tracks[-1]['lrc'])} 行")
    return tracks


def analyze(img: Image.Image):
    """取主色 + 一个「可爱辉光色」。辉光色由画面里最抢眼的高饱和色相调制而来。"""
    small = img.convert("RGB").resize((64, 36), Image.LANCZOS)
    q = small.quantize(colors=8, method=Image.MEDIANCUT).convert("RGB")
    counts = {}
    for r, g, b in q.getdata():
        counts[(r, g, b)] = counts.get((r, g, b), 0) + 1
    dominant = max(counts, key=counts.get)

    # HSV 里按「饱和度 × 明度」给色相打分，找出画面的招牌色
    px = np.asarray(small, dtype=np.float32) / 255.0
    mx = px.max(axis=2)
    mn = px.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    d = np.maximum(mx - mn, 1e-6)
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4))
    hue = (hue * 60.0) % 360.0

    vivid = (sat > 0.22) & (mx > 0.22)
    if vivid.sum() < 20:
        vivid = sat > 0.08
    score = (sat * (0.4 + 0.6 * mx))[vivid]
    h = hue[vivid]
    bins = np.floor(h / 30.0).astype(int) % 12
    weights = np.bincount(bins, weights=score, minlength=12)
    best = int(weights.argmax())
    if weights.sum() <= 0:
        hue_deg = 330.0
    else:
        sel = bins == best
        hue_deg = float(np.average(h[sel], weights=np.maximum(score[sel], 1e-6)))
    glow = hsl_to_hex(hue_deg, 0.72, 0.62)

    lum = float((0.2126 * px[..., 0] + 0.7152 * px[..., 1] + 0.0722 * px[..., 2]).mean() * 255)
    return {
        "dominant": hex_of(dominant),
        "accent": glow,
        "luma": round(lum, 1),
    }


def hsl_to_hex(h, s, l):
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60.0) % 2 - 1))
    m = l - c / 2
    seg = int(h // 60) % 6
    r, g, b = [
        (c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x)
    ][seg]
    return hex_of(((r + m) * 255, (g + m) * 255, (b + m) * 255))


def main():
    if not IMAGE_DIR.is_dir():
        sys.exit(f"找不到图片目录: {IMAGE_DIR}")
    THUMB_DIR.mkdir(exist_ok=True)
    DATA_FILE.parent.mkdir(exist_ok=True)

    items = []
    for path in sorted(p for p in IMAGE_DIR.iterdir() if p.is_file() and p.suffix.lower() in EXTS):
        stem = path.stem
        try:
            with Image.open(path) as im:
                im.load()
                width, height = im.size
                has_alpha = im.mode in ("RGBA", "LA", "P") and (
                    "transparency" in im.info or im.mode in ("RGBA", "LA")
                )
                bg = (245, 238, 245)
                frame = im.convert("RGB") if not has_alpha else Image.alpha_composite(
                    Image.new("RGBA", im.size, bg + (255,)), im.convert("RGBA")
                ).convert("RGB")

                slug = slugify(stem)
                thumb_path = THUMB_DIR / f"{slug}.webp"
                thumb = frame.copy()
                if thumb.width > 720:
                    thumb = thumb.resize((720, round(720 * height / width)), Image.LANCZOS)
                thumb.save(thumb_path, "WEBP", quality=82, method=6)

                lq = frame.copy()
                lq.thumbnail((28, 28), Image.LANCZOS)
                lq = lq.filter(ImageFilter.GaussianBlur(0.6))
                buf = io.BytesIO()
                lq.save(buf, "WEBP", quality=55, method=6)
                lqip = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()

                colors = analyze(frame)
        except Exception as exc:  # 坏图不阻断整体构建
            print(f"[skip] {path.name}: {exc}")
            continue

        dt, source = parse_meta(stem)
        if dt is None:
            dt = datetime.fromtimestamp(path.stat().st_mtime)
            source = "本地图片"

        items.append(
            {
                "file": path.name,
                "stem": stem,
                "title": stem,
                "source": source,
                "date": dt.isoformat(timespec="seconds"),
                "timestamp": int(dt.timestamp() * 1000),
                "width": width,
                "height": height,
                "bytes": path.stat().st_size,
                "thumb": f"thumbs/{thumb_path.name}",
                "lqip": lqip,
                "colors": colors,
            }
        )
        print(f"[ok] {path.name}  ->  {thumb_path.name}  ({thumb_path.stat().st_size // 1024} KB)")

    items.sort(key=lambda i: i["timestamp"], reverse=True)
    music = scan_music()
    payload = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "count": len(items),
        "totalBytes": sum(i["bytes"] for i in items),
        "imageBase": "material-library/image/",
        "musicBase": "material-library/music/",
        "images": items,
        "music": music,
    }
    body = (
        "/* lll 的小站 · 图集清单 —— 由 tools/build_gallery.py 自动生成，请勿手改。\n"
        f"   最后生成：{payload['generatedAt']} · 共 {payload['count']} 张图 · {len(music)} 首音乐 */\n"
        "window.CUTE_IMAGES = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n"
    )
    DATA_FILE.write_text(body, encoding="utf-8")
    print(f"\n共 {len(items)} 张图、{len(music)} 首音乐，清单已写入 {DATA_FILE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
