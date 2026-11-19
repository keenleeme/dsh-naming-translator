"""Render the plugin's storefront assets from the same mark as icon.svg.

The registry requires a GitHub-hosted raster icon (SVG is refused) and accepts
up to eight screenshots. Both are drawn here so the storefront tile matches the
glyph the plugin renders in the composer tool row.

Run with the bundled Python: tools/make-assets.py
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

# Same palette as icon.svg.
BLUE = (31, 111, 235, 255)
WHITE = (255, 255, 255, 255)
PALE = (158, 203, 255, 255)

# Sub-pixel scale factor: draw big, downsample once, get clean edges.
SUPERSAMPLE = 8


def _quad(p0, p1, p2, steps=12):
    """Sample a quadratic Bezier from p0 to p2 with control point p1."""
    out = []
    for step in range(steps + 1):
        t = step / steps
        u = 1.0 - t
        out.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))
    return out


def _brace(mirror: bool) -> list[tuple[float, float]]:
    """One brace in 64-unit space, flowing from the top tip to the bottom tip.

    Six segments: outer arm in, waist corner, waist tip, waist tip back out,
    inner arm down. Each corner is a quadratic fillet, which is what makes the
    downsample read as a brace instead of a zigzag.
    """
    # Canonical left brace; x is mirrored for the right one.
    seg = [
        _quad((24.0, 18.0), (19.6, 19.4), (18.2, 24.0)),
        _quad((18.2, 24.0), (17.4, 28.4), (16.4, 31.6), steps=8),
        _quad((16.4, 31.6), (15.2, 34.2), (12.6, 34.8), steps=10),
        _quad((12.6, 34.8), (15.2, 35.4), (16.4, 38.0), steps=10),
        _quad((16.4, 38.0), (17.4, 41.2), (18.2, 45.6), steps=8),
        _quad((18.2, 45.6), (19.6, 50.2), (24.0, 51.6)),
    ]
    points = [seg[0][0]]
    for part in seg:
        points += part[1:]
    if mirror:
        points = [(64.0 - x, y) for x, y in points]
    return points


def draw_mark(size: int, background: bool = True) -> Image.Image:
    """Draw the mark on a transparent (or blue) square canvas."""
    canvas = size * SUPERSAMPLE
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    if background:
        draw.rounded_rectangle(
            (0, 0, canvas - 1, canvas - 1),
            radius=int(canvas * 0.22),
            fill=BLUE,
        )

    unit = canvas / 64.0
    stroke = max(1, round(3.6 * unit))

    for mirror in (False, True):
        pts = [(x * unit, y * unit) for x, y in _brace(mirror)]
        draw.line(pts, fill=WHITE, width=stroke, joint="curve")
        radius = stroke / 2.0
        for tip in (pts[0], pts[-1]):
            draw.ellipse(
                (tip[0] - radius, tip[1] - radius, tip[0] + radius, tip[1] + radius),
                fill=WHITE,
            )

    # The dot between the braces.
    cx, cy, dot = 32 * unit, 31 * unit, 4.6 * unit
    draw.ellipse((cx - dot, cy - dot, cx + dot, cy + dot), fill=WHITE)

    # The pale underscore beneath it.
    bar = max(1, round(3.4 * unit))
    y = 42 * unit
    draw.line([(23 * unit, y), (41 * unit, y)], fill=PALE, width=bar)
    for x in (23 * unit, 41 * unit):
        r = bar / 2.0
        draw.ellipse((x - r, y - r, x + r, y + r), fill=PALE)

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    for size in (180, 64):
        target = ASSETS / f"icon-{size}.png"
        draw_mark(size).save(target, "PNG", optimize=True)
        print(f"wrote {target} ({size}x{size})")


if __name__ == "__main__":
    main()
