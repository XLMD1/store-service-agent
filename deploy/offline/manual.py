"""Transfer only the published GB1S manual and confirmed page indexes."""
import hashlib
import json
from uuid import uuid4
from zipfile import ZipFile

from sqlalchemy import select

from app.auth.service import digest
from app.knowledge.lookup import normalized
from app.knowledge.models import KnowledgeEvent, KnowledgePageIndex, KnowledgeScan, KnowledgeVersion


MODELS = {"L1PB20-G18B1S", "L1PB26-G24B1S", "L1PB30-G28B1S"}
SCAN = ("position", "first_page", "last_page", "leading_pages", "trailing_pages", "page_height", "mime_type")


def export(db, version_id, target):
    version = db.get(KnowledgeVersion, version_id)
    if not version or version.state != "published" or version.edition != "B" or set(version.models) != MODELS:
        raise ValueError("Expected a published GB1S B edition")
    info = {key: getattr(version, key) for key in ("title", "edition", "document_code", "models")}
    info.update(scans=[], pages=[])
    with ZipFile(target, "w") as pack:
        for scan in db.scalars(select(KnowledgeScan).where(KnowledgeScan.version_id == version.id)):
            info["scans"].append({key: getattr(scan, key) for key in SCAN})
            pack.writestr(f"{scan.position}.scan", scan.data)
        for page in db.scalars(select(KnowledgePageIndex).where(
                KnowledgePageIndex.version_id == version.id, KnowledgePageIndex.page.in_([19, 20, 21]))):
            info["pages"].append({key: getattr(page, key) for key in ("page", "title", "keywords", "source_excerpt")})
        if not any(p["page"] == 19 and all(code in p["source_excerpt"].upper() for code in ("E3", "E4"))
                   for p in info["pages"]):
            raise ValueError("Missing reviewed E3/E4 excerpts")
        pack.writestr("manual.json", json.dumps(info, ensure_ascii=False).encode())


def install(db, owner, source):
    with ZipFile(source) as pack:
        info = json.loads(pack.read("manual.json"))
        request_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        version = KnowledgeVersion(**{key: info[key] for key in ("title", "edition", "document_code", "models")},
                                   request_id=str(uuid4()), request_digest=request_hash, state="published",
                                   created_by=owner.id, version=1)
        db.add(version)
        db.flush()
        for scan in info["scans"]:
            db.add(KnowledgeScan(**scan, version_id=version.id, data=pack.read(f"{scan['position']}.scan")))
        for page in info["pages"]:
            searchable = normalized("\n".join(page[key] for key in ("title", "keywords", "source_excerpt")))
            db.add(KnowledgePageIndex(**page, version_id=version.id, updated_by=owner.id,
                                      revision=1, search_text=searchable))
        db.add(KnowledgeEvent(version_id=version.id, actor_id=owner.id, operation_id=str(uuid4()),
                              request_digest=digest(request_hash), action="publish", state="published",
                              version=1, note="老板在首次安装时选用了已核对的 GB1S 资料包。"))
