import base64
import ctypes
import json
import os
from pathlib import Path
import tempfile


def windows_protect(raw, decrypt=False):
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    buffer = ctypes.create_string_buffer(raw)
    incoming = Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    library = ctypes.WinDLL('crypt32', use_last_error=True)
    function = getattr(library, 'CryptUnprotectData' if decrypt else 'CryptProtectData')
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob),
                        ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    if not function(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        raise OSError('Local credential protection failed')
    free = ctypes.WinDLL('kernel32').LocalFree
    free.argtypes, free.restype = [ctypes.c_void_p], ctypes.c_void_p
    try:
        return ctypes.string_at(outgoing.data, outgoing.size)
    finally:
        ctypes.memset(outgoing.data, 0, outgoing.size)
        free(outgoing.data)


def read_key(path=None):
    if path is None or not Path(path).exists():
        return os.environ.get('DEEPSEEK_API_KEY', '')
    payload = json.loads(Path(path).read_text(encoding='utf-8'))
    if payload.get('disabled') is True:
        return ''
    raw = base64.b64decode(payload['secret'], validate=True)
    if payload['protection'] == 'dpapi':
        raw = windows_protect(raw, decrypt=True)
    elif payload['protection'] != 'file':
        raise ValueError('Unknown local credential protection')
    return raw.decode('utf-8')


def save_key(path, key):
    path = Path(path)
    payload = {'disabled':True}
    if key:
        raw = key.encode('utf-8')
        protection = 'file'
        if os.name == 'nt':
            raw, protection = windows_protect(raw), 'dpapi'
        payload = {'protection':protection, 'secret':base64.b64encode(raw).decode('ascii')}
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.deepseek-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            stream.write(json.dumps(payload))
        os.replace(temporary, path)
    finally:
        if Path(temporary).exists():
            Path(temporary).unlink()


def configuration(path):
    try:
        configured = bool(read_key(path))
        return {'configured':configured, 'readable':True,
                'source':('local' if configured else 'disabled') if Path(path).exists() else 'environment'}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {'configured':False, 'readable':False, 'source':'unreadable'}
