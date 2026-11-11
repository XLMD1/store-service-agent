from hashlib import sha256
from io import BytesIO
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import HTTPException
from PIL import Image


FORMATS = {'JPEG': 'image/jpeg', 'PNG': 'image/png'}
MAX_PIXELS = 24_000_000


def image_type(data):
    try:
        with Image.open(BytesIO(data), formats=list(FORMATS)) as image:
            if image.width * image.height > MAX_PIXELS or getattr(image, 'n_frames', 1) != 1:
                raise ValueError('Unsupported dimensions or frame count')
            mime = FORMATS[image.format]
            image.verify()
        with Image.open(BytesIO(data), formats=list(FORMATS)) as image:
            image.load()
        return mime
    except (OSError, SyntaxError, ValueError, Image.DecompressionBombError) as error:
        raise HTTPException(422, 'Use a readable single-frame JPEG or PNG within the pixel limit') from error


def original_path(settings, source):
    return Path(settings.source_files_dir) / (source.id + '.original')


def read_original(settings, source):
    with original_path(settings, source).open('rb') as file:
        data = file.read(source.photo_size + 1)
    if len(data) != source.photo_size or sha256(data).hexdigest() != source.photo_sha256:
        raise OSError('Original failed integrity check')
    return data


def persist_original(settings, source, data):
    try:
        read_original(settings, source)
        return
    except OSError:
        pass
    path = original_path(settings, source)
    temporary = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with NamedTemporaryFile(dir=path.parent, prefix='.upload-', delete=False) as file:
            temporary = Path(file.name)
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
        temporary = None
        read_original(settings, source)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
