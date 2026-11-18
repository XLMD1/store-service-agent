from base64 import b64decode
from binascii import Error as Base64Error
from io import BytesIO

from fastapi import HTTPException
from PIL import Image

from app.sources.photos import FORMATS


IMPORT_MAX_BYTES = 20 * 1024 * 1024
SCAN_MAX_BYTES = 8 * 1024 * 1024
SCAN_MAX_PIXELS = 40_000_000
IMPORT_BODY_LIMIT = 4 * ((IMPORT_MAX_BYTES + 2) // 3) + 64_000


def decode_bundle(scans):
    originals = []
    remaining = IMPORT_MAX_BYTES
    for scan in scans:
        try:
            data = b64decode(scan.image_base64, validate=True)
        except (Base64Error, ValueError) as error:
            raise HTTPException(422, 'Invalid scan encoding') from error
        if len(data) > min(remaining, SCAN_MAX_BYTES):
            raise HTTPException(413, 'Manual scans exceed the upload limit')
        remaining -= len(data)
        try:
            with Image.open(BytesIO(data), formats=list(FORMATS)) as image:
                if image.width * image.height > SCAN_MAX_PIXELS or getattr(image, 'n_frames', 1) != 1:
                    raise ValueError('Unsupported scan dimensions')
                mime = FORMATS[image.format]
                count = scan.last_page - scan.first_page + 1 + scan.leading_pages + scan.trailing_pages
                page_height, extra = divmod(image.height, count)
                if page_height == 0 or extra:
                    raise ValueError('Scan height does not match the declared number of equal-height pages')
                image.verify()
            with Image.open(BytesIO(data), formats=list(FORMATS)) as image:
                image.load()
        except (ValueError, OSError, SyntaxError, Image.DecompressionBombError) as error:
            raise HTTPException(422, 'Use readable PNG/JPEG scans with matching, equal-height pages') from error
        originals.append({
            **scan.model_dump(exclude={'image_base64'}),
            'data': data, 'mime_type': mime, 'page_height': page_height,
        })
    return originals


def render_page(scan, number):
    top = (number - scan.first_page + scan.leading_pages) * scan.page_height
    with Image.open(BytesIO(scan.data), formats=list(FORMATS)) as image, BytesIO() as output:
        image.crop((0, top, image.width, top + scan.page_height)).save(output, format='PNG')
        return output.getvalue()
