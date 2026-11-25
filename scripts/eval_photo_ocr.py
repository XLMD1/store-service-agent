"""Time Windows OCR on three synthetic service notes, without database access."""

import json
from io import BytesIO
from pathlib import Path
from time import perf_counter
import os

from PIL import Image, ImageDraw, ImageFont

from app.service_records.ocr import recognize_photo


def main():
    font_path = Path(os.environ["SystemRoot"]) / "Fonts/msyh.ttc"
    cases = [
        ("large", 42, "样例甲区\n热水器不点火"),
        ("small", 22, "样例乙区\n回访安排在周五"),
        ("mixed", 32, "样例丙区\n设备型号 DEMO-12"),
    ]
    for name, size, expected in cases:
        bitmap = Image.new("RGB", (720, 180), "white")
        ImageDraw.Draw(bitmap).multiline_text(
            (15, 15), expected, fill="black", font=ImageFont.truetype(str(font_path), size)
        )
        photo = BytesIO()
        bitmap.save(photo, format="PNG")
        started = perf_counter()
        actual = recognize_photo(photo.getvalue())
        elapsed = round(1000 * (perf_counter() - started))
        print(json.dumps({
            "case": name, "expected": expected, "actual": actual.strip(),
            "exact_without_whitespace": "".join(actual.split()) == "".join(expected.split()),
            "elapsed_ms": elapsed,
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
