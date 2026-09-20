"""Generate a 1024x1024 PNG app icon using only the standard library."""
import os
import struct
import zlib

SIZE = 1024
OUT = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons", "icon-source.png")


def make_png(path: str) -> None:
    # Background: dark navy. Foreground: a centered accent-blue rounded disc.
    bg = (15, 17, 23)
    accent = (91, 140, 255)
    white = (230, 233, 239)

    cx = cy = SIZE // 2
    disc_r = SIZE * 0.34
    inner_r = SIZE * 0.20

    rows = bytearray()
    for y in range(SIZE):
        rows.append(0)  # filter type 0
        for x in range(SIZE):
            dx, dy = x - cx, y - cy
            d = (dx * dx + dy * dy) ** 0.5
            if d <= disc_r:
                if d >= inner_r:
                    r, g, b = accent
                else:
                    r, g, b = white
            else:
                r, g, b = bg
            rows += bytes((r, g, b, 255))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(rows), 9))
    png += chunk(b"IEND", b"")

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)
    print(f"wrote {os.path.abspath(path)}")


if __name__ == "__main__":
    make_png(os.path.abspath(OUT))
