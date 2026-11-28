import json
import re
from datetime import datetime, timezone
from threading import Lock
from time import monotonic
from urllib.request import urlopen

from fastapi import APIRouter, Depends
from app.auth.router import current_user, database
from app.auth.service import ensure_permission

VERSION = "1.0.1"
RELEASES = "https://github.com/XLMD1/store-service-agent/releases"
INSTALLER = "StoreAssistant-Win10-x64-Setup.exe"
router = APIRouter(prefix="/api/version")
lock = Lock()
attempt = None
last_success = None
latest = None
status = "unchecked"


@router.get("")
def installed(user=Depends(current_user)):
    return {"version": VERSION}


@router.get("/updates")
def updates(force: bool = False, user=Depends(current_user), db=Depends(database, scope="function")):
    global attempt, last_success, latest, status
    ensure_permission(db, user, "knowledge.publish")
    with lock:
        interval = 5 if force else 86400
        if attempt is None or monotonic() - attempt >= interval:
            attempt = monotonic()
            try:
                with urlopen(RELEASES + "/latest/download/update.json", timeout=5) as response:
                    data = json.loads(response.read(16385))
                version = data["version"]
                if not re.fullmatch(r"[0-9]{1,4}(\.[0-9]{1,4}){2}", version):
                    raise ValueError("Invalid version")
                url = f"{RELEASES}/download/v{version}/{INSTALLER}"
                if data["url"] != url or not re.fullmatch("[a-f0-9]{64}", data["sha256"]):
                    raise ValueError("Invalid release")
                latest = {key: str(data[key]) for key in ("version", "url", "notes", "date", "sha256")}
                newer = tuple(map(int, version.split("."))) > tuple(map(int, VERSION.split(".")))
                status = "available" if newer else "current"
                last_success = datetime.now(timezone.utc).isoformat()
            except (OSError, ValueError, KeyError, TypeError):
                status = "unavailable"
        return {"version": VERSION, "status": status, "latest": latest, "last_success": last_success}
