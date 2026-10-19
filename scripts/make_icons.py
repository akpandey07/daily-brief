"""Draw the app icon (indigo tile, white page with headline bars, amber sun) as PNGs, no dependencies."""
import os, struct, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def rr(x, y, x0, y0, x1, y1, r):
    """Inside a rounded rectangle?"""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r); cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def pixel(u, v, full_bleed):
    # background
    if not full_bleed and not rr(u, v, 0, 0, 1, 1, 0.22):
        return (0, 0, 0, 0)
    t = (u + v) / 2
    bg = (int(79 + (124 - 79) * t), int(70 + (58 - 70) * t), int(229 + (237 - 229) * t))
    col = bg
    # page
    if rr(u, v, 0.22, 0.2, 0.78, 0.82, 0.05):
        col = (255, 255, 255)
        # headline bars
        bars = [(0.29, 0.30, 0.62, 0.37), (0.29, 0.45, 0.71, 0.49), (0.29, 0.55, 0.71, 0.59), (0.29, 0.65, 0.58, 0.69)]
        for x0, y0, x1, y1 in bars:
            if rr(u, v, x0, y0, x1, y1, 0.018):
                col = (79, 70, 229) if y0 < 0.4 else (199, 205, 230)
    # sun badge
    if (u - 0.74) ** 2 + (v - 0.24) ** 2 <= 0.105 ** 2:
        col = (251, 191, 36)
    return col + (255,)

def png(size, path, full_bleed=False, ss=3):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    p = pixel((x + (sx + .5) / ss) / size, (y + (sy + .5) / ss) / size, full_bleed)
                    for i in range(4): acc[i] += p[i]
            row += bytes(int(a / (ss * ss)) for a in acc)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b""))

os.makedirs(os.path.join(ROOT, "icons"), exist_ok=True)
png(192, os.path.join(ROOT, "icons/icon-192.png"))
png(512, os.path.join(ROOT, "icons/icon-512.png"), full_bleed=True, ss=2)
png(180, os.path.join(ROOT, "icons/apple-touch-icon.png"), full_bleed=True)
print("icons written")
