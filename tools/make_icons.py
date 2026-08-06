"""Generate Breezy's app icons as PNGs using only the Python standard library.

Draws a sky-gradient tile with a sun behind a cloud, supersampled for smooth
edges, then writes true-colour PNGs at the sizes iOS and the manifest need.

    python tools/make_icons.py
"""

import math
import os
import struct
import zlib

SS = 3  # supersampling factor
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

SKY_TOP = (0x16, 0x2C, 0x5C)
SKY_MID = (0x2E, 0x6F, 0xD4)
SKY_BOT = (0x6F, 0xB2, 0xEE)
SUN = (0xFF, 0xC4, 0x4D)
SUN_GLOW = (0xFF, 0xDE, 0x8A)
CLOUD = (0xF2, 0xF6, 0xFB)
CLOUD_SHADE = (0xCF, 0xDA, 0xE7)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(lerp(c1[i], c2[i], t) for i in range(3))


def sky_at(v):
    """Vertical gradient: top -> mid -> bottom."""
    if v < 0.55:
        return mix(SKY_TOP, SKY_MID, v / 0.55)
    return mix(SKY_MID, SKY_BOT, (v - 0.55) / 0.45)


# cloud = union of three discs plus a slab, in unit coordinates
DISCS = [(0.375, 0.660, 0.130), (0.530, 0.605, 0.170), (0.685, 0.665, 0.122)]
SLAB = (0.375, 0.660, 0.685, 0.782)  # x0, y0, x1, y1

SUN_C = (0.355, 0.360, 0.150)


def in_cloud(x, y):
    for cx, cy, r in DISCS:
        if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
            return True
    x0, y0, x1, y1 = SLAB
    return x0 <= x <= x1 and y0 <= y <= y1


def sample(x, y):
    """Colour of the unit-square point (x, y)."""
    r, g, b = sky_at(y)

    # soft vignette so the icon reads well on a light home screen
    dx, dy = x - 0.5, y - 0.5
    vig = 1.0 - 0.20 * min(1.0, (dx * dx + dy * dy) * 2.6)
    r, g, b = r * vig, g * vig, b * vig

    cx, cy, cr = SUN_C
    d = math.hypot(x - cx, y - cy)
    if d <= cr * 1.85:  # glow
        t = max(0.0, 1.0 - (d / (cr * 1.85))) ** 2
        r, g, b = mix((r, g, b), SUN_GLOW, t * 0.55)
    if d <= cr:
        r, g, b = SUN

    if in_cloud(x, y):
        # gentle top-lit shading across the cloud body
        t = min(1.0, max(0.0, (y - 0.55) / 0.26))
        r, g, b = mix(CLOUD, CLOUD_SHADE, t)

    return r, g, b


def render(size):
    n = size * SS
    inv = 1.0 / n
    inv_ss2 = 1.0 / (SS * SS)
    rows = []
    # accumulate supersampled rows into final pixels
    for py in range(size):
        acc = [0.0] * (size * 3)
        for sy in range(SS):
            y = (py * SS + sy + 0.5) * inv
            for px in range(size):
                base = px * 3
                ar = ag = ab = 0.0
                for sx in range(SS):
                    x = (px * SS + sx + 0.5) * inv
                    r, g, b = sample(x, y)
                    ar += r
                    ag += g
                    ab += b
                acc[base] += ar
                acc[base + 1] += ag
                acc[base + 2] += ab
        row = bytearray(size * 3 + 1)
        row[0] = 0  # filter type: none
        for i in range(size * 3):
            v = int(acc[i] * inv_ss2 + 0.5)
            row[i + 1] = 0 if v < 0 else (255 if v > 255 else v)
        rows.append(bytes(row))
    return b"".join(rows)


def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_png(path, size, raw):
    hdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit truecolour
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", hdr)
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in (180, 192, 512):
        raw = render(size)
        path = os.path.join(OUT, f"icon-{size}.png")
        write_png(path, size, raw)
        print(f"wrote {path} ({os.path.getsize(path):,} bytes)")


if __name__ == "__main__":
    main()
