"""Render the storefront preview from the plugin's real dictionary.

The screenshot shows the panel as it actually behaves: it runs the shipped
tokenizer over real phrases, so the identifiers in the image are the ones the
plugin produces rather than hand-written sample text. Layout follows the
composer popover's own metrics and palette.
"""

import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Windows consoles default to a legacy code page; report UTF-8 regardless so a
# Chinese phrase in the summary cannot fail the run.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

# The popover's own palette, matching the --dsw-* tokens in client.js.
BG = (255, 255, 255, 255)
CARD = (255, 255, 255, 255)
BORDER = (226, 229, 235, 255)
LABEL = (28, 32, 38, 255)
SECOND = (95, 104, 117, 255)
CAPTION = (140, 148, 160, 255)
ACCENT = (31, 111, 235, 255)
PALE_ACCENT = (232, 240, 254, 255)
GREEN = (22, 145, 106, 255)
FIELD = (246, 247, 249, 255)


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Pick a CJK-capable font, falling back to the default bitmap font."""
    candidates = [
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def mono_font(size: int) -> ImageFont.FreeTypeFont:
    for path in (r"C:\Windows\Fonts\consola.ttf", r"C:\Windows\Fonts\cour.ttf"):
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return load_font(size)


def preview_brace() -> list[tuple[float, float]]:
    """One brace in 64-unit space, sharing the geometry of make-assets.py.

    Kept in sync by hand: the preview draws the glyph the control renders, so a
    drifting shape here would misrepresent the plugin.
    """
    def quad(p0, p1, p2, steps=12):
        out = []
        for step in range(steps + 1):
            t = step / steps
            u = 1.0 - t
            out.append((
                u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
            ))
        return out

    segments = [
        quad((24.0, 18.0), (19.6, 19.4), (18.2, 24.0)),
        quad((18.2, 24.0), (17.4, 28.4), (16.4, 31.6), steps=8),
        quad((16.4, 31.6), (15.2, 34.2), (12.6, 34.8), steps=10),
        quad((12.6, 34.8), (15.2, 35.4), (16.4, 38.0), steps=10),
        quad((16.4, 38.0), (17.4, 41.2), (18.2, 45.6), steps=8),
        quad((18.2, 45.6), (19.6, 50.2), (24.0, 51.6)),
    ]
    points = [segments[0][0]]
    for part in segments:
        points += part[1:]
    return points


def run_tokenizer(phrases: list[str]) -> list[dict]:
    """Ask the shipped client bundle for the identifiers it really produces."""
    script = r"""
const fs = require('node:fs')
const path = require('node:path')
const registrations = []
globalThis.window = { __ModuleLoader__: { load: (r) => registrations.push(r) } }
const react = { createElement: () => null, useState: (v) => [v, () => {}], useEffect: () => {},
  useRef: () => ({ current: null }), useCallback: (f) => f }
const source = fs.readFileSync(path.join(process.argv[2], 'client.js'), 'utf8')
new Function('window', source)(globalThis.window)
const bundle = registrations[0].factory((n) => n === 'react' ? react : { createPortal: () => null })
const phrases = JSON.parse(process.argv[3])
const out = phrases.map((text) => {
  const local = bundle.translateLocally(text, bundle.SEED_GLOSSARY)
  return { text, identifier: local.identifier, words: local.words, unknown: local.unknown }
})
console.log(JSON.stringify(out))
"""
    script_path = ASSETS / "_tokenize.cjs"
    script_path.write_text(script, encoding="utf-8")
    try:
        result = subprocess.run(
            ["node", str(script_path), str(ROOT), json.dumps(phrases, ensure_ascii=False)],
            capture_output=True, text=True, encoding="utf-8", check=True,
        )
        return json.loads(result.stdout)
    finally:
        script_path.unlink(missing_ok=True)


def rounded(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def main() -> None:
    phrase = "订单分页查询"
    rows = run_tokenizer([phrase, "用户信息", "网关限流"])
    current = rows[0]
    others = rows[1:]

    W, H = 1200, 760
    # Draw on a transparent canvas so the trim below can find real content;
    # the white page background is composited afterwards.
    image = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # ── the composer tool row the control lives in ────────────────────────────
    row_y = 96
    rounded(draw, (96, row_y, W - 96, row_y + 44), radius=10, fill=FIELD)
    trigger = (116, row_y + 8, 116 + 104, row_y + 36)
    rounded(draw, trigger, radius=8, fill=PALE_ACCENT)
    # The same brace-and-dot glyph the control renders, drawn from its geometry.
    gx, gy, gs = 126.0, row_y + 12.0, 20.0 / 64.0
    for mirror in (False, True):
        pts = [(gx + (x if not mirror else 64 - x) * gs, gy + y * gs) for x, y in preview_brace()]
        draw.line(pts, fill=ACCENT, width=2, joint="curve")
    draw.ellipse((gx + 32 * gs - 1.6, gy + 31 * gs - 1.6, gx + 32 * gs + 1.6, gy + 31 * gs + 1.6), fill=ACCENT)
    draw.line([(gx + 23 * gs, gy + 42 * gs), (gx + 41 * gs, gy + 42 * gs)], fill=ACCENT, width=2)
    draw.text((158, row_y + 22), "命名", font=load_font(15), fill=LABEL, anchor="lm")
    # Placeholder text standing in for the draft.
    draw.text((W - 116, row_y + 22), "给作者发消息…", font=load_font(14), fill=CAPTION, anchor="rm")

    # ── the popover ───────────────────────────────────────────────────────────
    px, py, pw, ph = 96, row_y + 64, 432, 328
    draw.rounded_rectangle((px + 2, py + 4, px + pw + 2, py + ph + 4), radius=14, fill=(0, 0, 0, 18))
    rounded(draw, (px, py, px + pw, py + ph), radius=14, fill=CARD, outline=BORDER)

    draw.text((px + 18, py + 24), "变量名翻译", font=load_font(16, bold=True), fill=LABEL, anchor="lm")
    draw.line([(px + pw - 30, py + 18), (px + pw - 22, py + 26)], fill=CAPTION, width=2)
    draw.line([(px + pw - 22, py + 18), (px + pw - 30, py + 26)], fill=CAPTION, width=2)

    # Input field holding the Chinese phrase.
    field = (px + 18, py + 44, px + pw - 18, py + 88)
    rounded(draw, field, radius=8, fill=(255, 255, 255), outline=ACCENT)
    draw.text((px + 30, py + 66), phrase, font=load_font(16), fill=LABEL, anchor="lm")
    caret_x = px + 34 + draw.textlength(phrase, font=load_font(16))
    draw.line([(caret_x, py + 54), (caret_x, py + 78)], fill=LABEL, width=2)

    # Result box: the identifier plus its provenance badge.
    out_box = (px + 18, py + 98, px + pw - 18, py + 142)
    rounded(draw, out_box, radius=8, fill=FIELD, outline=BORDER)
    draw.text((px + 30, py + 120), current["identifier"], font=mono_font(17), fill=LABEL, anchor="lm")
    badge = "词典"
    badge_w = draw.textlength(badge, font=load_font(13)) + 18
    rounded(draw, (px + pw - 30 - badge_w, py + 111, px + pw - 30, py + 131), radius=10, fill=ACCENT)
    draw.text((px + pw - 30 - badge_w / 2, py + 121), badge, font=load_font(13), fill=(255, 255, 255), anchor="mm")

    # The words behind the identifier.
    if current["words"]:
        draw.text((px + 30, py + 160), " + ".join(current["words"]), font=load_font(13), fill=CAPTION, anchor="lm")

    # Actions.
    actions = [("复制", True), ("插入到输入框", False), ("自定义词典", False)]
    ax = px + 18
    for text, primary in actions:
        w = draw.textlength(text, font=load_font(14)) + 26
        box = (ax, py + 178, ax + w, py + 208)
        if primary:
            rounded(draw, box, radius=7, fill=ACCENT)
            draw.text((ax + w / 2, py + 193), text, font=load_font(14), fill=(255, 255, 255), anchor="mm")
        else:
            rounded(draw, box, radius=7, fill=None, outline=BORDER)
            draw.text((ax + w / 2, py + 193), text, font=load_font(14), fill=SECOND, anchor="mm")
        ax += w + 8

    # Recent identifiers.
    draw.text((px + 30, py + 228), "近几条结果", font=load_font(13), fill=CAPTION, anchor="lm")
    cx = px + 18
    for row in others:
        label = row["identifier"]
        w = draw.textlength(label, font=load_font(13)) + 22
        rounded(draw, (cx, py + 240, cx + w, py + 264), radius=12, fill=PALE_ACCENT)
        draw.text((cx + w / 2, py + 252), label, font=load_font(13), fill=ACCENT, anchor="mm")
        cx += w + 8

    # ── the three-layer order, spelled out beside the panel ───────────────────
    lx = px + pw + 56
    draw.text((lx, py + 26), "翻译顺序", font=load_font(16, bold=True), fill=LABEL, anchor="lm")
    layers = [
        ("1", "自定义词典", "预置 143 条领域词，可自行增删", GREEN),
        ("2", "内置词典", "约 400 条开发词汇，本地即时", ACCENT),
        ("3", "模型兜底", "覆盖不到时才发一次请求", SECOND),
    ]
    ly = py + 54
    for index, title, note, color in layers:
        draw.ellipse((lx, ly, lx + 24, ly + 24), fill=color)
        draw.text((lx + 12, ly + 12), index, font=load_font(13, bold=True), fill=(255, 255, 255), anchor="mm")
        draw.text((lx + 36, ly + 6), title, font=load_font(14, bold=True), fill=LABEL, anchor="lm")
        draw.text((lx + 36, ly + 22), note, font=load_font(12), fill=SECOND, anchor="lm")
        ly += 52

    draw.line([(lx, ly + 8), (lx + 300, ly + 8)], fill=BORDER)
    draw.text((lx, ly + 26), "标识符由 Host 折成 camelCase，", font=load_font(12), fill=CAPTION, anchor="lm")
    draw.text((lx, ly + 46), "模型啰嗦也不会污染变量名。", font=load_font(12), fill=CAPTION, anchor="lm")

    # Crop to the content, then pad it evenly and composite the page background.
    bbox = image.getbbox()
    cropped = image.crop(bbox)
    pad = 40
    final = Image.new("RGBA", (cropped.width + pad * 2, cropped.height + pad * 2), BG)
    final.alpha_composite(cropped, (pad, pad))

    target = ASSETS / "preview.png"
    final.convert("RGB").save(target, "PNG", optimize=True)
    print(f"wrote {target} ({final.width}x{final.height})")
    for row in rows:
        print(f"  {row['text']} -> {row['identifier']}  (unknown={len(row['unknown'])})")


if __name__ == "__main__":
    main()
