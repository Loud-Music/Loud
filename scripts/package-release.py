import hashlib
import json
import shutil
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
release = root / "releases"
release.mkdir(exist_ok=True)
binary = root / "src-tauri/target/release/loud-platform.exe"
installers = list((root / "src-tauri/target/release/bundle/nsis").glob(f"*{version}*x64*setup.exe"))
if len(installers) != 1:
    raise RuntimeError("Build the Windows x64 NSIS installer before packaging")
installer = release / f"Loud-{version}-windows-x64-setup.exe"
shutil.copyfile(installers[0], installer)
archive = release / "Loud.zip"
with ZipFile(archive, "w", ZIP_DEFLATED, compresslevel=9) as bundle:
    bundle.write(binary, "Loud/Loud.exe")
    bundle.write(root / "LICENSE.txt", "Loud/LICENSE.txt")
    for path in sorted((root / "licenses").iterdir()):
        if path.is_file():
            bundle.write(path, "Loud/licenses/" + path.name)
with ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert hashlib.sha256(bundle.read("Loud/Loud.exe")).digest() == hashlib.sha256(binary.read_bytes()).digest()
    assert not any("/source/" in name or name.endswith((".tsx", ".ts", ".rs", ".py", ".env")) for name in bundle.namelist())
checksums = "".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n" for path in [installer, archive])
(release / "SHA256SUMS.txt").write_text(checksums, encoding="utf-8")
for path in [installer, archive]:
    print(f"{path}: {path.stat().st_size} bytes")
