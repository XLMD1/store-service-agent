import pytest

from app.config import Settings


@pytest.mark.parametrize('overrides', [
    {'database_url': 'sqlite://'},
    {'origin': 'https://example.test/path'},
    {'origin': 'http://example.test', 'cookie_secure': False},
    {'origin': 'https://example.test', 'cookie_secure': False},
    {'origin': 'https://example.test', 'cookie_secure': 'false'},
])
def test_invalid_database_or_unsafe_cookie_configuration_is_rejected(overrides):
    with pytest.raises(ValueError):
        Settings(**{'database_url': 'postgresql+psycopg://user@127.0.0.1/example',
                    'origin': 'https://example.test', **overrides})
