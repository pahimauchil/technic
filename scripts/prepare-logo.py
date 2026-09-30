"""
Technic Technologies logo pipeline (source: user-provided paste PNG, 480x134).

1. Converts the white background to transparency so the logo sits cleanly on
   any surface (sidebar, dark login, PDF header).
2. Writes public/logo.png — the UI asset.
3. Writes public/logo-pdf.png — the same logo at print resolution for PDFKit.
4. Writes docs/logo-preview.png for visual inspection.
"""
from PIL import Image

src = Image.open("public/logo-src.png").convert("RGBA")

data = src.getdata()
cleaned = []
for r, g, b, a in data:
    # Near-white pixels become fully transparent; near-white halos are softened
    # so antialiased edges don't leave a white box on dark backgrounds.
    if r > 245 and g > 245 and b > 245:
        cleaned.append((255, 255, 255, 0))
    elif r > 230 and g > 230 and b > 230:
        alpha = int((255 - r) * 4.2)
        cleaned.append((r, g, b, min(255, max(0, alpha))))
    else:
        cleaned.append((r, g, b, 255))

transparent = Image.new("RGBA", src.size)
transparent.putdata(cleaned)
transparent.save("public/logo.png", optimize=True)

# PDF copy: 3x the display height (~52pt) keeps documents sharp.
target_w = 960
ratio = target_w / transparent.width
pdf_img = transparent.resize((target_w, int(transparent.height * ratio)), Image.LANCZOS)
pdf_img.save("public/logo-pdf.png", optimize=True)

# Preview for inspection.
preview = Image.new("RGBA", transparent.size, (18, 53, 36, 255))
preview.alpha_composite(transparent)
preview.convert("RGB").save("docs/logo-preview.png", optimize=True)

print("ui:", transparent.size, "pdf:", pdf_img.size)
