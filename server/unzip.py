import json
import os
import shutil
import sys
import zipfile

archive = sys.argv[1]
out_dir = sys.argv[2]
root = os.path.realpath(out_dir)
os.makedirs(root, exist_ok=True)
total = 0
files = []
with zipfile.ZipFile(archive) as zf:
    for info in zf.infolist():
        if info.is_dir():
            continue
        name = info.filename.replace('\\', '/')
        if name.startswith('__MACOSX/') or '/__MACOSX/' in name:
            continue
        target = os.path.realpath(os.path.join(root, name))
        if target != root and not target.startswith(root + os.sep):
            raise RuntimeError('Unsafe path in zip: ' + info.filename)
        total += info.file_size
        if total > 100 * 1024 * 1024 * 1024:
            raise RuntimeError('Zip archive expands beyond 100 GB')
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with zf.open(info) as src, open(target, 'wb') as dst:
            shutil.copyfileobj(src, dst)
        files.append(os.path.relpath(target, root))
print(json.dumps(files))
