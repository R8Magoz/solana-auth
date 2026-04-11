"""Composite logo.png centered on #3C0A37 → icon-192.png, icon-512.png (no Node required)."""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "logo.png"
BRAND = (60, 10, 55)  # #3C0A37


def build(size: int) -> None:
    pad = round(size * 0.16)
    inner = size - pad * 2
    logo = Image.open(LOGO).convert("RGBA")
    logo.thumbnail((inner, inner), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (*BRAND, 255))
    x = (size - logo.width) // 2
    y = (size - logo.height) // 2
    if logo.mode == "RGBA":
        canvas.paste(logo, (x, y), logo)
    else:
        canvas.paste(logo, (x, y))
    out = ROOT / f"icon-{size}.png"
    canvas.save(out, "PNG")
    print("Wrote", out.name)


if __name__ == "__main__":
    build(192)
    build(512)
