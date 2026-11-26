"""Build on 64-bit Windows with the project venv and PostgreSQL 18 installed."""
import argparse
from datetime import date
import hashlib
import json
from importlib import metadata
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "deploy/offline"
OUT = ROOT / ".local/packages"


def build(manual, notes):
    sys.path.insert(0, str(ROOT))
    from app.updates import VERSION, RELEASES, INSTALLER
    if sys.version_info[:2] != (3, 12) or sys.maxsize <= 2**32 or sys.platform != "win32":
        raise SystemExit("Use the Windows x64 Python 3.12 project venv")
    base = Path(sys.base_prefix)
    pg = Path(os.environ.get("PG_BIN", "C:/Program Files/PostgreSQL/18/bin")).parent
    csc = Path(os.environ["SystemRoot"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=OUT) as tmp:
        temp = Path(tmp)
        def compile_cs(name, *options):
            subprocess.run([csc, "/nologo", "/platform:x64", "/codepage:65001",
                            f"/out:{temp / (name + '.exe')}", *options, SOURCE / (name + ".cs")], check=True)

        compile_cs("Workbench", "/r:System.ServiceProcess.dll")
        compile_cs("Maintenance", f"/win32manifest:{SOURCE / 'admin.manifest'}")
        files = {}
        def tree(source, target, skip=()):
            for file in source.rglob("*"):
                rel = file.relative_to(source)
                if file.is_file() and not set(rel.parts).intersection(skip) and file.suffix != ".pyc":
                    files[target / rel] = file

        project_files = subprocess.check_output(
            ["git", "ls-files", "-z", "app", "migrations"], cwd=ROOT).decode().split("\0")
        for name in filter(None, project_files + ["app/updates.py", "app/web/store.webmanifest", "app/web/assets/store-192.png",
                                                  "app/web/assets/store-512.png", "alembic.ini"]):
            path = Path(name)
            if path.name.startswith("mock") or path.suffix not in {
                ".py", ".js", ".ps1", ".css", ".png", ".svg", ".html", ".webmanifest", ".ini",
            }:
                continue
            files[path] = ROOT / path
        for name in ("manage.py", "manual.py"):
            files[Path(name)] = SOURCE / name
        files[Path("Workbench.exe")] = temp / "Workbench.exe"
        files[Path("Maintenance.exe")] = temp / "Maintenance.exe"
        if manual:
            files[Path("GB1S.zip")] = manual
        py = Path("python")
        for name in ("python.exe", "python3.dll", "python312.dll", "vcruntime140.dll", "vcruntime140_1.dll", "LICENSE.txt"):
            files[py / name] = base / name
        tree(base / "DLLs", py / "DLLs", {"_testinternalcapi.pyd", "_testcapi.pyd"})
        tree(base / "Lib", py / "Lib", {"site-packages", "__pycache__", "test", "tests", "idlelib", "ensurepip"})
        for line in (ROOT / "requirements.lock").read_text().splitlines():
            if line.startswith((" ", "#")) or "==" not in line:
                continue
            name, version = line.split("==")
            if name in {"pytest", "pluggy", "iniconfig", "pygments"}:
                continue
            dist = metadata.distribution(name)
            if dist.version != version:
                raise ValueError(f"Install locked version of {name} before building")
            for entry in dist.files:
                rel = Path(entry)
                if (".." in rel.parts or rel.is_absolute() or rel.suffix == ".pyc" or
                    rel.name in {"direct_url.json", "uv_cache.json"} or
                    {"tests", "__pycache__"}.intersection(rel.parts)):
                    continue
                files[py / "Lib/site-packages" / rel] = Path(dist.locate_file(entry))
        # Isolate imports from PYTHONPATH, user site and host Python installations.
        paths = temp / "python312._pth"
        paths.write_text("..\n.\nDLLs\nLib\nLib/site-packages\n", encoding="ascii")
        files[py / paths.name] = paths
        for name in ("initdb", "pg_ctl", "pg_dump", "pg_restore", "postgres", "psql"):
            files[Path("pg/bin", name + ".exe")] = pg / "bin" / (name + ".exe")
        for dll in (pg / "bin").glob("*.dll"):
            if not dll.name.startswith(("wx", "test")):
                files[Path("pg/bin") / dll.name] = dll
        for dll in (pg / "lib").glob("*.dll"):
            files[Path("pg/lib") / dll.name] = dll
        tree(pg / "share", Path("pg/share"), {"doc"})
        for name in ("server_license.txt", "commandlinetools_3rd_party_licenses.txt"):
            files[Path("pg") / name] = pg / name
        files[Path("vcredist_x64.exe")] = pg / "installer/vcredist_x64.exe"
        payload = temp / "runtime.zip"
        with ZipFile(payload, "w", ZIP_DEFLATED, compresslevel=3) as archive:
            for name, file in sorted(files.items()):
                archive.write(file, name)
        version_source = temp / "Version.cs"
        version_source.write_text(f'[assembly: System.Reflection.AssemblyFileVersion("{VERSION}.0")]')
        compile_cs("Setup", str(version_source), "/r:System.IO.Compression.dll", "/r:System.IO.Compression.FileSystem.dll",
                   f"/win32manifest:{SOURCE / 'admin.manifest'}", f"/resource:{payload},runtime.zip")
        dest = OUT / "StoreAssistant-Win10-x64-Setup.exe"
        (temp / "Setup.exe").replace(dest)
        with dest.open("rb") as exe:
            manifest = dict(version=VERSION, notes=notes, date=date.today().isoformat(),
                            url=f"{RELEASES}/download/v{VERSION}/{INSTALLER}",
                            sha256=hashlib.file_digest(exe, "sha256").hexdigest())
        (OUT / "update.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        print(dest, dest.stat().st_size, "bytes;", len(files), "payload entries")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--manual", type=Path)
    parser.add_argument("--notes", required=True)
    args = parser.parse_args()
    build(args.manual, args.notes)
