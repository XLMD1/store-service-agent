"""Elevated local installation and maintenance for the bundled Win10 runtime."""
from datetime import datetime
from getpass import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen
from uuid import uuid4
import winreg
from zipfile import ZipFile

RELEASE = Path(__file__).resolve().parent
ROOT = RELEASE.parents[1]
DATA = ROOT / "data"
CONFIG = DATA / "store.json"
PG = RELEASE / "pg/bin"
DB_SERVICE = "StoreAssistantDB"
WEB = "StoreAssistantWeb"
PORT = "55433"
URL = "http://127.0.0.1:8000"
UNINSTALL = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\StoreAssistant"
PS = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
SC = Path(os.environ["SystemRoot"]) / "System32/sc.exe"


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def powershell(script):
    return run(PS, "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; " + script)


def exists(service):
    return subprocess.run([SC, "query", service], stdout=subprocess.DEVNULL).returncode == 0


def control(action, service):
    powershell(f"{action}-Service -Name {service}; " +
               f"(Get-Service {service}).WaitForStatus('{ 'Running' if action == 'Start' else 'Stopped' }','00:01:00')")


def db_args(config):
    from sqlalchemy.engine import make_url
    url = make_url(config["database_url"])
    return ["-h", url.host, "-p", str(url.port), "-U", url.username, "-d", url.database], {
        **os.environ, "PGPASSWORD": url.password,
    }


def store_config():
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def checksum(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def create_backup(config, destination):
    args, env = db_args(config)
    originals = Path(config["source_files_dir"])
    if not originals.is_dir():
        raise ValueError("找不到原件目录，已停止备份。")
    with tempfile.TemporaryDirectory(dir=DATA) as scratch:
        dump = Path(scratch) / "database.dump"
        run(PG / "pg_dump.exe", *args, "-Fc", "-f", dump, env=env)
        run(PG / "pg_restore.exe", "-l", dump, stdout=subprocess.DEVNULL)
        files = {"database.dump": dump}
        files.update({"originals/" + p.name: p for p in originals.glob("*.original")})
        manifest = {name: checksum(path) for name, path in files.items()}
        temp = destination.with_name(destination.name + "." + uuid4().hex + ".tmp")
        try:
            with ZipFile(temp, "x") as archive:
                for name, path in files.items():
                    archive.write(path, name)
                archive.writestr("manifest.json", json.dumps({"format": 1, "files": manifest}))
            with ZipFile(temp) as archive:
                if archive.testzip() is not None:
                    raise ValueError("备份校验失败")
            temp.rename(destination)
        finally:
            temp.unlink(missing_ok=True)


def restore(config, source):
    args, env = db_args(config)
    with tempfile.TemporaryDirectory(dir=DATA) as scratch, ZipFile(source) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        files = manifest["files"]
        if (manifest["format"] != 1 or "database.dump" not in files or
                sorted(archive.namelist()) != sorted([*files, "manifest.json"])):
            raise ValueError("备份清单不完整")
        for name, expected in files.items():
            if name != "database.dump" and not re.fullmatch(r"originals/[a-f0-9-]{36}\.original", name):
                raise ValueError("备份含有无法识别的文件")
            path = Path(scratch) / name
            path.parent.mkdir(exist_ok=True)
            with archive.open(name) as src, path.open("xb") as dst:
                shutil.copyfileobj(src, dst)
            if checksum(path) != expected:
                raise ValueError("备份文件校验失败")
        run(PG / "pg_restore.exe", *args, "--no-owner", "--no-acl", "--exit-on-error",
            "--single-transaction", Path(scratch) / "database.dump", env=env)
        for path in (Path(scratch) / "originals").glob("*"):
            shutil.copyfile(path, Path(config["source_files_dir"]) / path.name)


def setup_cluster():
    cluster = DATA / "postgres"
    credentials = DATA / "cluster.json"
    if not credentials.exists():
        credentials.write_text(json.dumps({"admin": secrets.token_hex(32), "app": secrets.token_hex(32)}))
    passwords = json.loads(credentials.read_text())
    if not (cluster / "PG_VERSION").exists():
        with tempfile.NamedTemporaryFile(dir=DATA, delete=False) as stream:
            stream.write(passwords["admin"].encode())
        try:
            run(PG / "initdb.exe", "-D", cluster, "-U", "store_admin", "--auth=scram-sha-256",
                "--locale=C", "--encoding=UTF8", "--pwfile", stream.name)
        finally:
            Path(stream.name).unlink(missing_ok=True)
    # Passed to postgres on every service start, including resuming a previous installation.
    if not exists(DB_SERVICE):
        run(PG / "pg_ctl.exe", "register", "-N", DB_SERVICE, "-D", cluster,
            "-U", r"NT AUTHORITY\LocalService", "-S", "auto", "-o", f"-p {PORT} -h 127.0.0.1")
    control("Start", DB_SERVICE)
    import psycopg
    for attempt in range(30):
        try:
            connection = psycopg.connect(host="127.0.0.1", port=PORT, user="store_admin",
                                         dbname="postgres", password=passwords["admin"], autocommit=True)
            break
        except psycopg.OperationalError:
            if attempt == 29:
                raise
            time.sleep(1)
    with connection as db:
        if not db.execute("SELECT 1 FROM pg_roles WHERE rolname='store_app'").fetchone():
            from psycopg import sql
            db.execute(sql.SQL("CREATE ROLE store_app LOGIN PASSWORD {}").format(sql.Literal(passwords["app"])))
        if CONFIG.exists():
            return store_config()
        # Use a fresh database on every first-install attempt. A failed restore is never activated.
        name = "store_" + uuid4().hex
        db.execute(f"CREATE DATABASE {name} OWNER store_app")
    originals = DATA / name / "originals"
    originals.mkdir(parents=True)
    return {"database_url": f"postgresql+psycopg://store_app:{passwords['app']}@127.0.0.1:{PORT}/{name}",
            "origin": URL, "cookie_secure": False, "source_files_dir": str(originals),
            "deepseek_settings_file": str(DATA / "deepseek.json")}


def migrate(config):
    from alembic import command
    from alembic.config import Config
    settings = Config(str(RELEASE / "alembic.ini"))
    settings.attributes["database_url"] = config["database_url"]
    command.upgrade(settings, "head")


def owner_setup(config, username, password, manual):
    from app.auth.service import initialize_owner
    from app.config import Settings
    from app.db import create_database
    engine, sessions = create_database(Settings(**config))
    try:
        with sessions.begin() as db:
            owner = initialize_owner(db, username, password, confirmed=True)
            if manual:
                import manual as manuals
                manuals.install(db, owner, RELEASE / "GB1S.zip")
    finally:
        engine.dispose()


def stop_web():
    if exists(WEB):
        control("Stop", WEB)


def verified_start():
    control("Start", WEB)
    for attempt in range(30):
        try:
            with urlopen(URL + "/", timeout=2) as response:
                if b"/web/app.js" in response.read():
                    return
        except OSError:
            pass
        time.sleep(1)
    raise RuntimeError("工作台启动检查失败")


def install():
    existing = CONFIG.exists()
    source = None
    username = password = None
    manual = False
    if existing:
        if input("已找到门店数据。输入 1 备份并升级或恢复运行，回车取消：") != "1":
            return
    else:
        choice = input("门店助手安装：1 新建门店，2 从本产品备份恢复，回车取消：").strip()
        if choice == "2":
            source = Path(input("备份文件的完整路径：").strip().strip('"')).resolve(strict=True)
        elif choice == "1":
            username = input("老板账号：").strip()
            password = getpass("老板密码（至少 12 位）：")
            if not username or len(password) < 12 or password != getpass("再输入一次密码："):
                raise ValueError("账号为空、密码太短或两次输入不同")
            manual = (RELEASE / "GB1S.zip").exists() and input("安装 GB1S 离线资料包？输入 1 确认：") == "1"
        else:
            return
    result = subprocess.run([RELEASE / "vcredist_x64.exe", "/install", "/quiet", "/norestart"])
    if result.returncode not in (0, 1638):
        raise RuntimeError(f"运行库安装结果 {result.returncode}，如提示重启，请重启后再次安装。")
    DATA.mkdir(exist_ok=True)
    run("icacls.exe", DATA, "/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F",
        "*S-1-5-32-544:(OI)(CI)F", "*S-1-5-19:(OI)(CI)M", stdout=subprocess.DEVNULL)
    config = setup_cluster()
    had_web = exists(WEB)
    stop_web()
    if existing:
        try:
            create_backup(config, DATA / ("upgrade-" + uuid4().hex + ".zip"))
        except Exception:
            if had_web:
                verified_start()
            raise
    if source:
        restore(config, source)
    migrate(config)
    if not existing and not source:
        owner_setup(config, username, password, manual)
    if not CONFIG.exists():
        pending = CONFIG.with_suffix(".tmp")
        pending.write_text(json.dumps(config), encoding="utf-8")
        pending.replace(CONFIG)
        (DATA / "deepseek.json").write_text('{"disabled":true}')
    run(SC, "config" if had_web else "create", WEB, "binPath=", f'"{RELEASE / "Workbench.exe"}"',
        "obj=", r"NT AUTHORITY\LocalService", "start=", "auto", "depend=", DB_SERVICE)
    verified_start()
    shutil.copyfile(RELEASE / "Maintenance.exe", ROOT / "Maintenance.exe")
    (ROOT / "active").write_text(RELEASE.name, encoding="ascii")
    desktop = Path(os.environ["PUBLIC"]) / "Desktop/门店助手.url"
    desktop.write_text("[InternetShortcut]\nURL=" + URL + "/#home\n", encoding="ascii")
    with winreg.CreateKey(winreg.HKEY_LOCAL_MACHINE, UNINSTALL) as key:
        for name, value in {"DisplayName": "门店助手", "InstallLocation": str(ROOT),
                            "UninstallString": f'"{ROOT / "Maintenance.exe"}" uninstall'}.items():
            winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
    menu = Path(os.environ["ProgramData"]) / "Microsoft/Windows/Start Menu/Programs/门店助手"
    menu.mkdir(exist_ok=True)
    os.environ.update(STORE_MENU=str(menu / "导出门店备份.lnk"), STORE_MAINT=str(ROOT / "Maintenance.exe"))
    powershell("$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:STORE_MENU); "
               "$s.TargetPath=$env:STORE_MAINT; $s.Arguments='backup'; $s.Save()")
    powershell("if (-not ([Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]"
               "::AvailableRecognizerLanguages | Where-Object LanguageTag -like 'zh*')) "
               "{ Write-Output '本机缺少中文 OCR。可保存新原件，装好中文 OCR 后再识别。' }")
    print("安装完成，可双击桌面的门店助手。")


def export_backup():
    from app.config import Settings
    from app.db import create_database
    from app.auth.models import User, UserRole
    from app.auth.service import verify_password
    from sqlalchemy import select
    config = store_config()
    engine, sessions = create_database(Settings(**config))
    try:
        username = input("老板账号：").strip()
        password = getpass("门店账号密码：")
        with sessions() as db:
            owner = db.scalar(select(User).join(UserRole).where(User.username == username,
                              User.enabled.is_(True), UserRole.role == "owner"))
            if not owner or not verify_password(password, owner.password_hash):
                raise ValueError("老板身份校验失败")
    finally:
        engine.dispose()
    folder = Path(input("保存备份的目录（例如 E:\\）：").strip().strip('"')).resolve(strict=True)
    path = folder / ("门店备份-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".zip")
    stop_web()
    try:
        create_backup(config, path)
    finally:
        verified_start()
    print("备份已保存", path)


def uninstall():
    if input("卸载服务和程序，保留门店数据。输入 1 确认：") != "1":
        return
    for service in (WEB, DB_SERVICE):
        if exists(service):
            control("Stop", service)
            run(SC, "delete", service)
    (Path(os.environ["PUBLIC"]) / "Desktop/门店助手.url").unlink(missing_ok=True)
    (Path(os.environ["ProgramData"]) / "Microsoft/Windows/Start Menu/Programs/门店助手/导出门店备份.lnk").unlink(missing_ok=True)
    winreg.DeleteKey(winreg.HKEY_LOCAL_MACHINE, UNINSTALL)
    print("已保留门店数据。")
    # Maintenance.exe removes the verified releases directory after Python exits.
    return 10


if __name__ == "__main__":
    os.chdir(RELEASE)
    try:
        sys.exit({"install": install, "backup": export_backup, "uninstall": uninstall}[sys.argv[1]]() or 0)
    except Exception as error:
        print("操作未完成。", type(error).__name__)
        if isinstance(error, (ValueError, RuntimeError)) and type(error).__module__ == "builtins":
            print(error)
        sys.exit(1)
