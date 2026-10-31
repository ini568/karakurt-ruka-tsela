"""Package only a previously checked static release, not the source project."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import subprocess

root = Path(__file__).resolve().parent.parent
subprocess.run(['node', str(root / 'tests/regression/publish/artifact.mjs')], cwd=root, check=True)
source = root / 'dist'
output = root / 'release' / 'karakurt-ruka-tsela.zip'
output.parent.mkdir(exist_ok=True)
files = sorted(p for p in source.rglob('*') if p.is_file())
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for file in files:
        archive.write(file, file.relative_to(source).as_posix())
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'index.html' in archive.namelist()
    assert len(archive.namelist()) == 11
    for file in files:
        assert archive.read(file.relative_to(source).as_posix()) == file.read_bytes()
print(f'PACKAGE OK: release/{output.name} ({len(files)} files; index.html at ZIP root; byte comparison passed)')
