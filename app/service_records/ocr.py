import os
import subprocess
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps


def recognize_photo(data):
    system_root = os.environ.get('SystemRoot')
    if os.name != 'nt' or not system_root:
        raise OSError('Windows OCR unavailable')
    powershell = Path(system_root) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    script = Path(__file__).with_suffix('.ps1')
    try:
        with BytesIO() as photo, Image.open(BytesIO(data)) as original:
            with ImageOps.exif_transpose(original) as bitmap:
                bitmap.thumbnail((3200, 3200))
                bitmap.save(photo, format='PNG')
            result = subprocess.run(
                [str(powershell), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned',
                 '-File', str(script)],
                input=photo.getvalue(), capture_output=True, check=True, timeout=20,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        return result.stdout.decode('utf-8')
    except (subprocess.SubprocessError, UnicodeError) as error:
        raise OSError('Windows OCR failed') from error
