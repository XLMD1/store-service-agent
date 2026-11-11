from dataclasses import dataclass, field
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy.engine import make_url


@dataclass(frozen=True)
class Settings:
    database_url: str = field(repr=False)
    origin: str
    cookie_secure: bool = True
    deepseek_settings_file: str = '.local/deepseek-settings.json'
    source_text_max_chars: int = 12_000
    source_files_dir: str = '.local/service-sources'
    source_photo_max_bytes: int = 5 * 1024 * 1024

    def __post_init__(self):
        web_root = Path(__file__).resolve().parent / 'web'
        if not self.source_files_dir or Path(self.source_files_dir).resolve().is_relative_to(web_root):
            raise ValueError('Store service originals outside the public web directory')
        if type(self.source_photo_max_bytes) is not int or not 1 <= self.source_photo_max_bytes <= 10 * 1024 * 1024:
            raise ValueError('source_photo_max_bytes must be an integer between 1 and 10485760')
        if type(self.source_text_max_chars) is not int or not 1 <= self.source_text_max_chars <= 100_000:
            raise ValueError('source_text_max_chars must be an integer between 1 and 100000')
        if make_url(self.database_url).drivername != 'postgresql+psycopg':
            raise ValueError('Use an explicit postgresql+psycopg database URL')
        url = urlsplit(self.origin)
        if url.scheme not in ('http', 'https') or not url.hostname or url.path or url.query or url.fragment or url.username:
            raise ValueError('origin must be an exact HTTP(S) origin without a path')
        if not isinstance(self.cookie_secure, bool):
            raise ValueError('cookie_secure must be a boolean')
        if url.scheme == 'https' and not self.cookie_secure:
            raise ValueError('HTTPS requires Secure cookies')
        if url.scheme == 'http' and (url.hostname not in ('127.0.0.1', 'localhost', '::1') or self.cookie_secure):
            raise ValueError('HTTP is only allowed for explicit loopback development with non-Secure cookies')

    @classmethod
    def load(cls, path: Path | None = None):
        if path is not None:
            return cls(**json.loads(path.read_text(encoding='utf-8')))
        if os.environ.get('APP_CONFIG_FILE'):
            return cls.load(Path(os.environ['APP_CONFIG_FILE']))
        return cls(database_url=os.environ['APP_DATABASE_URL'], origin=os.environ['APP_ORIGIN'])
