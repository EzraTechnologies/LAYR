#!/usr/bin/env python3
"""Build/verify the immutable BT26 beta; no installation or host service changes."""
import argparse
import ast
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import subprocess
import tarfile
import tempfile

VERSION = '0.2.0-20261104.2'
TAG = 'v' + VERSION + '-bt26'
NAME = 'layr-bt26-test-' + VERSION
ROOT = Path(__file__).resolve().parents[1]


def run(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()


def safe_name(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or str(path) != name or '\\' in name or '\n' in name:
        raise ValueError('Unsafe archive path: ' + name)
    return path


def verify(archive):
    """Independently extract regular files into a clean private directory."""
    with tempfile.TemporaryDirectory(prefix='layr-bt26-verify-') as temporary:
        folder = Path(temporary)
        names = set()
        with tarfile.open(archive, 'r:gz') as handle:
            for member in handle:
                path = safe_name(member.name)
                if path.parts[0] != NAME or not member.isfile() or member.name in names:
                    raise ValueError('Unexpected/duplicate/non-regular archive member: ' + member.name)
                names.add(member.name)
                target = folder / member.name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(handle.extractfile(member).read())
                target.chmod(member.mode)
        extracted = folder / NAME
        checksums = {}
        for line in (extracted / 'SHA256SUMS').read_text().splitlines():
            sha, name = line.split('  ', 1)
            safe_name(name)
            if not re.fullmatch('[a-f0-9]{64}', sha) or name in checksums:
                raise ValueError('Invalid/duplicate manifest entry')
            checksums[name] = sha
        actual = {str(p.relative_to(extracted)): digest(p.read_bytes()) for p in extracted.rglob('*') if p.is_file() and p.name != 'SHA256SUMS'}
        if actual != checksums:
            raise ValueError('Internal checksums or file inventory do not match')
        metadata = json.loads((extracted / 'BUILD.json').read_text())
        for name in ('deploy/bt26-build.json', 'dist/bt26-build.json'):
            if (extracted / name).read_bytes() != (extracted / 'BUILD.json').read_bytes():
                raise ValueError('Installer/frontend build identity differs')
        if metadata['version'] != VERSION or metadata['tag'] != TAG or not re.fullmatch('[a-f0-9]{40}', metadata['source_commit']):
            raise ValueError('Invalid build identity')
        source = json.loads((extracted / 'SOURCE-MANIFEST.json').read_text())
        if source['source_commit'] != metadata['source_commit'] or source['source_tree'] != metadata['source_tree']:
            raise ValueError('Source provenance differs')
        for name, value in source['files'].items():
            data = (extracted / safe_name(name)).read_bytes()
            blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            if digest(data) != value['sha256'] or blob != value['git_blob']:
                raise ValueError('Source content differs: ' + name)
        frontend = json.loads((extracted / 'DIST-MANIFEST.json').read_text())
        dist = {str(p.relative_to(extracted / 'dist')): digest(p.read_bytes()) for p in (extracted / 'dist').rglob('*') if p.is_file() and p.name != 'bt26-build.json'}
        if dist != frontend:
            raise ValueError('Frontend inventory differs')
        required = ['deploy/layr', 'deploy/bootstrap.sh', 'deploy/install.sh', 'deploy/uninstall.sh',
                    'deploy/layr-display-power.py', 'deploy/layr-session.py', 'deploy/pam/layr-kiosk',
                    'deploy/systemd/layr-kiosk.service.in', 'deploy/systemd/layr-web.service.in',
                    'docs/bt26-beta-2.md', 'docs/display-power.md', 'docs/compatibility.md',
                    'src/assets/printer-illustrations/compact.png', 'src/assets/printer-illustrations/enclosed.png',
                    'src/assets/printer-illustrations/open-frame.png', 'package-lock.json', 'dist/index.html']
        if any(not (extracted / name).is_file() for name in required):
            raise ValueError('Required release component missing')
        for name in ('deploy/layr', 'deploy/layr-display-power.py', 'deploy/layr-session.py'):
            if not os.access(extracted / name, os.X_OK):
                raise ValueError('Required executable permission missing: ' + name)
            ast.parse((extracted / name).read_text(), feature_version=(3, 11))
        helper = (extracted / 'deploy/layr-display-power.py').read_text()
        if 'def service_unit(' not in helper or 'ExecStopPost=' not in helper or "enabled=False" not in helper:
            raise ValueError('Power controller/service definition missing or default changed')
        for name in re.findall(r'(?:src|href)="(/assets/[^"?#]+)', (extracted / 'dist/index.html').read_text()):
            if not (extracted / 'dist' / name.lstrip('/')).is_file():
                raise ValueError('Missing frontend asset: ' + name)
        if any(b'layr-playwright-fixture-key' in p.read_bytes() for p in (extracted / 'dist').rglob('*') if p.is_file()):
            raise ValueError('Authenticated test build must not be shipped')
        print('Clean extraction, complete inventory, internal checksums, source blobs, executable modes and shared build metadata verified')
        print('source_commit=' + metadata['source_commit'])


def build(output):
    if run('git', 'status', '--porcelain', '--untracked-files=no'):
        raise RuntimeError('Commit all source changes before building the release')
    commit, tree = run('git', 'rev-parse', 'HEAD'), run('git', 'rev-parse', 'HEAD^{tree}')
    epoch = int(run('git', 'show', '-s', '--format=%ct', 'HEAD'))
    destination = output.resolve() / (NAME + '.tar.gz')
    output.mkdir(parents=True, exist_ok=True)
    if destination.exists() or Path(str(destination) + '.sha256').exists():
        raise RuntimeError('Refusing to overwrite existing release output')
    # Build now, from this clean revision; never package a stale/authenticated dist.
    subprocess.run(['npm', 'run', 'build'], cwd=ROOT, check=True)
    metadata = json_bytes(dict(version=VERSION, tag=TAG, build_id=NAME, source_commit=commit,
                               source_tree=tree, source_date_epoch=epoch, working_tree_dirty=False))
    files, manifest = {}, {}
    for line in run('git', 'ls-tree', '-r', 'HEAD').splitlines():
        header, name = line.split('\t', 1)
        mode, kind, blob = header.split()
        if kind != 'blob' or (name.startswith('docs/screenshots/') or name.startswith('native-qt/')):
            continue
        if mode not in ('100644', '100755'):
            raise ValueError('Unsupported source file mode: ' + name)
        data = subprocess.check_output(['git', 'cat-file', 'blob', blob], cwd=ROOT)
        safe_name(name)
        manifest[name] = dict(sha256=digest(data), git_blob=blob, mode=mode)
        files[name] = (data, int(mode[-3:], 8))
    frontend = {}
    for path in sorted((ROOT / 'dist').rglob('*')):
        if path.is_file():
            name = str(path.relative_to(ROOT))
            if path.is_symlink() or path.name == 'bt26-build.json':
                raise ValueError('Unexpected/stale frontend file: ' + name)
            files[name] = (path.read_bytes(), 0o644)
            frontend[str(path.relative_to(ROOT / 'dist'))] = digest(path.read_bytes())
    for name in ('BUILD.json', 'deploy/bt26-build.json', 'dist/bt26-build.json'):
        files[name] = (metadata, 0o644)
    files['SOURCE-MANIFEST.json'] = (json_bytes(dict(source_commit=commit, source_tree=tree, files=manifest)), 0o644)
    files['DIST-MANIFEST.json'] = (json_bytes(frontend), 0o644)
    files['INSTALL-BT26.md'] = (files['docs/bt26-beta-2.md'][0], 0o644)
    files['SHA256SUMS'] = (''.join(digest(data) + '  ' + name + '\n' for name, (data, _) in sorted(files.items())).encode(), 0o644)
    with destination.open('xb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=epoch) as compressed:
            with tarfile.open(fileobj=compressed, mode='w', format=tarfile.GNU_FORMAT) as archive:
                for name, (data, mode) in sorted(files.items()):
                    info = tarfile.TarInfo(NAME + '/' + name)
                    info.size, info.mode, info.mtime = len(data), mode, epoch
                    info.uid = info.gid = 0
                    info.uname = info.gname = ''
                    archive.addfile(info, io.BytesIO(data))
    sha = digest(destination.read_bytes())
    Path(str(destination) + '.sha256').write_text(sha + '  ' + destination.name + '\n')
    verify(destination)
    print(sha + '  ' + destination.name)


def units():
    spec = importlib.util.spec_from_file_location('power', ROOT / 'deploy/layr-display-power.py')
    power = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(power)
    with tempfile.TemporaryDirectory(prefix='layr-unit-verify-') as directory:
        folder = Path(directory)
        # Syntax/dependency-graph validation only: the cloud host has no Polkit.
        # Target preflight separately requires the real Bookworm polkitd package.
        (folder / 'polkit.service').write_text('[Service]\nExecStart=/usr/bin/true\n')
        values = {'USER': pwd.getpwuid(os.getuid()).pw_name, 'LAYR_HOME': str(Path.home() / 'layr'), 'PORT': '8080', 'WEB_UNIT': 'layr-web.service'}
        paths = []
        for name in ('layr-kiosk', 'layr-web'):
            text = (ROOT / ('deploy/systemd/' + name + '.service.in')).read_text()
            for key, value in values.items():
                text = text.replace('@' + key + '@', value)
            path = folder / (name + '.service')
            path.write_text(text)
            paths.append(str(path))
        path = folder / 'layr-display-power.service'
        path.write_text(power.service_unit(dict(path='/sys/devices/pci0000:00/0000:00:02.0/backlight/example')))
        paths.append(str(path))
        subprocess.run(['systemd-analyze', 'verify', *paths], check=True)
        print('All rendered service definitions verified with private Polkit stub; no service installed or started')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('build', 'verify', 'units'))
    parser.add_argument('archive', nargs='?', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT.parent / 'artifacts' / VERSION)
    args = parser.parse_args()
    if args.action == 'build':
        build(args.output)
    elif args.action == 'units':
        units()
    elif args.archive:
        verify(args.archive)
    else:
        parser.error('verify requires an archive path')
