#!/usr/bin/python3
# LAYR-managed display power controller v1. Root copy only; never run from HOME as root.
"""Optional display-only idle control. No frontend, GPU, network or suspend privileges."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import platform
import pwd
import re
import selectors
import signal
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import time

UNIT = 'layr-display-power.service'
KIOSK = 'layr-kiosk.service'
HELPER = Path('/usr/local/lib/layr-display-power/controller.py')
MARKER = 'layr-display-power-v1'
ROOT_UID = 0
DEFAULTS = dict(enabled=False, timeout_minutes=5, dim=True, dim_percent=20, wake_method='power-button')
EV_SYN, EV_KEY, EV_REL, EV_ABS = 0, 1, 2, 3
KEY_POWER, BTN_TOUCH = 116, 330
ABS_MT_SLOT, ABS_MT_TRACKING_ID = 47, 57


def command(args, check=True):
    result = subprocess.run(args, capture_output=True, text=True, timeout=12)
    if check and result.returncode:
        raise RuntimeError(' '.join(args) + ': ' + (result.stderr.strip() or result.stdout.strip() or f'exit {result.returncode}'))
    return result


def integer(path, minimum=0, maximum=2**31 - 1):
    value = int(path.read_text().strip())
    if not minimum <= value <= maximum:
        raise RuntimeError(f'Invalid numeric backlight value at {path}')
    return value


def bitmap(path, word_bits):
    value = 0
    try:
        for word in path.read_text().split():
            value = (value << word_bits) | int(word, 16)
    except (OSError, ValueError):
        return 0
    return value


def inputs(root=Path('/'), probe=command):
    """Kernel capabilities/udev seat, never a fixed event number or an input grab."""
    word_bits = 64 if platform.machine() in ('x86_64', 'aarch64', 'arm64') else 32
    result = []
    for event in sorted((root / 'sys/class/input').glob('event*')):
        if not re.fullmatch(r'event[0-9]+', event.name):
            continue
        device = event / 'device'
        keys = bitmap(device / 'capabilities/key', word_bits)
        absolute = bitmap(device / 'capabilities/abs', word_bits)
        relative = bitmap(device / 'capabilities/rel', word_bits)
        props = bitmap(device / 'properties', word_bits)
        udev = probe(['udevadm', 'info', '--query=property', '--path', str(event)], False)
        if udev.returncode:
            raise RuntimeError('Cannot determine input seat via udev: ' + event.name)
        tags = dict(line.split('=', 1) for line in udev.stdout.splitlines() if '=' in line)
        if tags.get('ID_SEAT', 'seat0') != 'seat0' or tags.get('ID_INPUT_ACCELEROMETER') == '1':
            continue
        power = bool(keys & (1 << KEY_POWER))
        touch = bool(tags.get('ID_INPUT_TOUCHSCREEN') == '1' or tags.get('ID_INPUT_TOUCHPAD') == '1' or (props & 2 and (absolute & ((1 << 53) | (1 << 54)) or keys & (1 << BTN_TOUCH))))
        keyboard = bool(keys & (1 << 30) and keys & (1 << 28))
        pointer = bool(relative & 3 and keys & (1 << 272))
        absolute_pointer = bool(absolute & 3 == 3 and keys & (1 << 272) and not touch)
        if not (power or touch or keyboard or pointer or absolute_pointer):
            continue
        name = (device / 'name').read_text().strip()
        result.append(dict(event=event.name, node='/dev/input/' + event.name, name=name,
                           power=power, touch=touch, absolute_pointer=absolute_pointer, multitouch=bool(absolute & (1 << ABS_MT_TRACKING_ID)),
                           btn_touch=bool(keys & (1 << BTN_TOUCH))))
    return result


def backlights(root=Path('/')):
    candidates = []
    for entry in sorted((root / 'sys/class/backlight').glob('*')):
        if not re.fullmatch(r'[A-Za-z0-9_.:-]+', entry.name):
            continue
        target = entry.resolve()
        try:
            relative = target.relative_to((root / 'sys/devices').resolve())
            if not any((parent / 'driver').resolve().name == 'i915' for parent in (target, *target.parents) if parent != root):
                continue
            canonical = '/sys/devices/' + relative.as_posix()
            if not re.fullmatch(r'/sys/devices/[A-Za-z0-9_.:/+-]+', canonical):
                continue
            maximum = integer(entry / 'max_brightness', 1)
            current = integer(entry / 'brightness', 0, maximum)
            power = integer(entry / 'bl_power', 0, 4)
            candidates.append(dict(name=entry.name, path=canonical, maximum=maximum, brightness=current, bl_power=power))
        except (OSError, ValueError, RuntimeError):
            continue
    return candidates


def discover(root=Path('/'), probe=command, selected=None):
    fields = {}
    try:
        fields = dict(line.split('=', 1) for line in (root / 'etc/os-release').read_text().splitlines() if '=' in line)
        fields = {key: value.strip('"\'') for key, value in fields.items()}
        cpu = (root / 'proc/cpuinfo').read_text()
        arch = probe(['dpkg', '--print-architecture'], False).stdout.strip()
    except OSError as error:
        return dict(supported=False, reasons=[str(error)], backlights=[], inputs=[])
    reasons = []
    if fields.get('ID') != 'debian' or fields.get('VERSION_ID') != '12' or arch not in ('i386', 'amd64'):
        reasons.append('Requires Debian 12 i386/amd64; Raspberry Pi/ARM display power is not supported')
    if not re.search(r'^vendor_id\s*:\s*GenuineIntel\s*$', cpu, re.M):
        reasons.append('An Intel CPU is required')
    found = backlights(root)
    if selected:
        choices = [item for item in found if item['name'] == selected]
    else:
        choices = found
    if len(choices) != 1:
        reasons.append('Select exactly one i915 backlight with brightness, max_brightness and bl_power' if len(choices) != 1 else '')
    internal = any(p.read_text().strip() == 'connected' for p in (root / 'sys/class/drm').glob('card*-*/status') if re.search(r'-(eDP|LVDS|DSI)-', p.parent.name))
    if not internal:
        reasons.append('No connected internal DRM panel (eDP/LVDS/DSI)')
    try:
        devices = inputs(root, probe)
    except (OSError, RuntimeError) as error:
        devices = []
        reasons.append(str(error))
    if not any(item['power'] for item in devices):
        reasons.append('No seat0 input device advertising KEY_POWER; refusing automatic blanking without a wake button')
    return dict(supported=not reasons, reasons=reasons, architecture=arch, backlights=found,
                selected=choices[0] if len(choices) == 1 else None, inputs=devices,
                physical_validation='BT26 hardware API/wake owner-tested; this daemon requires physical validation')


def settings(values):
    if not isinstance(values, dict) or set(values) - set(DEFAULTS) - {'backlight'}:
        raise RuntimeError('Unknown display-power setting')
    result = dict(DEFAULTS, **values)
    if type(result['enabled']) is not bool or type(result['dim']) is not bool:
        raise RuntimeError('enabled/dim must be booleans')
    if result['timeout_minutes'] is not None and (type(result['timeout_minutes']) is not int or result['timeout_minutes'] not in (1, 5, 10)):
        raise RuntimeError('Timeout must be 1, 5, 10 minutes or Never')
    if type(result['dim_percent']) is not int or not 1 <= result['dim_percent'] <= 100:
        raise RuntimeError('Dim percentage must be between 1 and 100')
    if result['wake_method'] != 'power-button':
        raise RuntimeError('Only power-button wake is supported')
    if 'backlight' in result and (not isinstance(result['backlight'], str) or not re.fullmatch(r'[A-Za-z0-9_.:-]+', result['backlight'])):
        raise RuntimeError('Backlight must be a discovered class name, not a path')
    return result


class Paths:
    def __init__(self, root=Path('/')):
        self.root = root
        self.config = root / 'etc/layr/display-power.json'
        self.state = root / 'var/lib/layr-display-power/original.json'
        self.status = root / 'run/layr-display-power/status.json'
        self.socket = root / 'run/layr-display-power/control.sock'
        self.unit = root / 'etc/systemd/system/layr-display-power.service'


def owned_json(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != ROOT_UID or info.st_mode & 0o022:
        raise RuntimeError(f'Refusing untrusted/symlinked root state: {path}')
    value = json.loads(path.read_text())
    if not isinstance(value, dict) or value.get('managed_by') != MARKER:
        raise RuntimeError(f'Not LAYR-managed: {path}')
    return value


def owned_unit(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != ROOT_UID or info.st_mode & 0o022 or not path.read_text().startswith('# LAYR-managed display power v1\n'):
        raise RuntimeError('Refusing an unrelated, symlinked or writable power-management unit')


def secure_directory(path, mode=0o755):
    created = not path.exists()
    if not path.exists():
        path.mkdir(parents=True, mode=mode)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != ROOT_UID or info.st_mode & 0o022:
        raise RuntimeError(f'Refusing untrusted root directory: {path}')
    if created:
        path.chmod(mode)


def save_json(path, value, mode=0o600):
    secure_directory(path.parent, 0o700 if '/var/lib/' in str(path) else 0o755)
    fd, temporary = tempfile.mkstemp(prefix='.layr-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(dict(value, managed_by=MARKER), handle)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class Backlight:
    def __init__(self, device, root=Path('/')):
        self.device = device
        self.path = root / device['path'].lstrip('/')

    def write(self, name, value):
        path = self.path / name
        # Kernel files remain root-only; no chmod, shell redirection or arbitrary path.
        if integer(path) != value:
            path.write_text(str(value) + '\n')

    def active(self, brightness):
        self.write('brightness', brightness)
        self.write('bl_power', 0)

    def dim(self, brightness):
        self.write('brightness', brightness)

    def off(self):
        self.write('bl_power', 4)


def machine_id(root):
    return (root / 'etc/machine-id').read_text().strip()


def restore_saved(paths, force=False):
    if not paths.state.exists() and not paths.state.is_symlink():
        return False
    record = owned_json(paths.state)
    if record.get('needs_restore') is not True and not force:
        return False
    if record.get('machine_id') != machine_id(paths.root):
        raise RuntimeError('Saved backlight state belongs to another machine')
    matches = [item for item in backlights(paths.root) if item['name'] == record.get('name') and item['path'] == record.get('path') and item['maximum'] == record.get('maximum')]
    if len(matches) != 1 or type(record.get('brightness')) is not int or not 1 <= record['brightness'] <= matches[0]['maximum'] or record.get('bl_power') != 0:
        raise RuntimeError('Saved backlight identity/values no longer match; no other device was written')
    Backlight(matches[0], paths.root).active(record['brightness'])
    record['needs_restore'] = False
    save_json(paths.state, record)
    return True


class IdlePolicy:
    """Monotonic, one-way idle stages. Power presses wake, never toggle off."""
    def __init__(self, config, now):
        self.config = settings({key: config[key] for key in DEFAULTS if key in config})
        self.last_activity = now
        self.state = 'active'
        self.last_power = float('-inf')
        self.pending_off = None

    def activity(self, now, power=False):
        if power:
            if now - self.last_power < 0.25:
                return self.state
            self.last_power = now
        if self.state == 'off' and not power:
            return self.state
        self.last_activity = now
        self.pending_off = None
        self.state = 'active'
        return self.state

    def tick(self, now, held=False, session_active=True):
        minutes = self.config['timeout_minutes']
        if not session_active:
            self.last_activity = now
            self.pending_off = None
            self.state = 'active'
        elif self.state != 'off' and (held or minutes is None):
            self.last_activity = now
            self.pending_off = None
            self.state = 'active'
        elif self.state != 'off':
            idle = max(0, now - self.last_activity)
            if idle >= minutes * 60:
                # Recheck input after a settling interval; no rapid off/on retries.
                if self.pending_off is None:
                    self.pending_off = now
                elif now - self.pending_off >= 0.25:
                    self.state = 'off'
            elif self.config['dim'] and idle >= minutes * 48:
                self.state = 'dimmed'
        return self.state


class InputState:
    def __init__(self, spec):
        self.spec = spec
        self.keys = set()
        self.contacts = set()
        self.slot = 0

    @property
    def held(self):
        return bool(self.keys or self.contacts)

    def event(self, event_type, code, value):
        if event_type == EV_SYN and code == 3:
            raise RuntimeError('Input events were dropped; restore the display rather than guessing idle state')
        if event_type == EV_KEY:
            if value not in (0, 1, 2):
                return False, False
            rising = value == 1 and code not in self.keys
            if value == 0:
                self.keys.discard(code)
            else:
                self.keys.add(code)
            if code == KEY_POWER:
                return rising, rising
            return True, False
        if event_type == EV_REL:
            return value != 0, False
        if event_type == EV_ABS and (self.spec['touch'] or self.spec.get('absolute_pointer')):
            if code == ABS_MT_SLOT:
                if not 0 <= value < 64:
                    raise RuntimeError('Unsupported multitouch slot; restoring the display')
                self.slot = value
                return False, False
            if code == ABS_MT_TRACKING_ID:
                if value >= 0:
                    self.contacts.add(self.slot)
                else:
                    self.contacts.discard(self.slot)
                return True, False
            return code in (0, 1, 53, 54) and bool(self.held or self.spec.get('absolute_pointer')), False
        return False, False


class EventDecoder:
    def __init__(self, event_struct=None):
        # Native long sizes match evdev's compat ABI: 16 bytes on i386, 24 on amd64.
        self.struct = event_struct or struct.Struct('@llHHi')
        self.buffer = b''

    def feed(self, data):
        self.buffer += data
        if len(self.buffer) > 65536:
            raise RuntimeError('Input queue exceeded its bound')
        events = []
        while len(self.buffer) >= self.struct.size:
            _, _, kind, code, value = self.struct.unpack_from(self.buffer)
            self.buffer = self.buffer[self.struct.size:]
            events.append((kind, code, value))
        return events


def initial_input_state(fd, state):
    # Snapshot already-held keys/contacts; starting mid-touch must not look idle.
    keys = bytearray(96)
    fcntl.ioctl(fd, 0x80000000 | (len(keys) << 16) | (ord('E') << 8) | 0x18, keys, True)
    state.keys = {bit for bit in range(len(keys) * 8) if keys[bit // 8] & (1 << (bit % 8))}
    if state.spec['multitouch']:
        try:
            info = bytearray(24)
            fcntl.ioctl(fd, 0x80000000 | (24 << 16) | (ord('E') << 8) | (0x40 + ABS_MT_SLOT), info, True)
            current, minimum, maximum, _, _, _ = struct.unpack('=6i', info)
            if minimum != 0 or not 0 <= current <= maximum < 64:
                raise RuntimeError('Unsupported multitouch slot range')
            values = bytearray(struct.pack('=i', ABS_MT_TRACKING_ID) + bytes(4 * (maximum + 1)))
            fcntl.ioctl(fd, 0x80000000 | (len(values) << 16) | (ord('E') << 8) | 0x0a, values, True)
            state.slot = current
            state.contacts = {index for index, value in enumerate(struct.unpack('=' + 'i' * (maximum + 1), values[4:])) if value >= 0}
        except OSError:
            if not state.spec['btn_touch']:
                raise RuntimeError('Cannot snapshot multitouch state; refusing to guess inactivity')


def kiosk_session(probe=command):
    info = probe(['systemctl', 'show', KIOSK, '-p', 'ActiveState', '-p', 'MainPID', '-p', 'User'], False)
    values = dict(line.split('=', 1) for line in info.stdout.splitlines() if '=' in line)
    if info.returncode or values.get('ActiveState') != 'active' or not values.get('MainPID', '').isdigit() or int(values['MainPID']) <= 0:
        return None
    owner = values.get('User')
    if not owner or owner == 'root' or pwd.getpwnam(owner).pw_uid == 0:
        raise RuntimeError('Kiosk must run as a normal user')
    # Read logind's public metadata; no CAP_SYS_PTRACE or access to the user's
    # /proc/environ, profile or HOME is needed by this root service.
    listing = probe(['loginctl', 'list-sessions', '--no-legend', '--no-pager'], False)
    if listing.returncode:
        raise RuntimeError('Cannot inspect kiosk session through logind')
    for line in listing.stdout.splitlines():
        parts = line.split()
        if not parts or not re.fullmatch(r'[A-Za-z0-9_-]+', parts[0]):
            continue
        output = probe(['loginctl', 'show-session', parts[0], '-p', 'Leader', '-p', 'Active', '-p', 'Seat', '-p', 'VTNr', '-p', 'Remote', '-p', 'User'], False)
        actual = dict(line.split('=', 1) for line in output.stdout.splitlines() if '=' in line)
        if actual.get('Leader') != values['MainPID']:
            continue
        if output.returncode or actual.get('Seat') != 'seat0' or actual.get('VTNr') != '7' or actual.get('Remote') != 'no' or actual.get('User') != str(pwd.getpwnam(owner).pw_uid):
            raise RuntimeError('Power management requires the kiosk own local seat0/VT7 session')
        return actual.get('Active') == 'yes'
    return None


def desktop_guard(probe=command):
    for name in ('display-manager.service', 'KlipperScreen.service'):
        if probe(['systemctl', 'is-active', '--quiet', name], False).returncode == 0:
            raise RuntimeError(name + ' is active; restore display power without taking over its session')


def service_unit(device):
    path = device['path']
    if not re.fullmatch(r'/sys/devices/[A-Za-z0-9_.:/+-]+', path):
        raise RuntimeError('Unsupported backlight path for systemd sandbox')
    return f'''# LAYR-managed display power v1
[Unit]
Description=LAYR optional display backlight power management
After=systemd-logind.service {KIOSK}
Requires=systemd-logind.service
BindsTo={KIOSK} systemd-logind.service
ConditionPathExists=/etc/layr/display-power.json
[Service]
Type=simple
User=root
WorkingDirectory=/
ExecStart=/usr/bin/systemd-inhibit --what=handle-power-key --mode=block --who=LAYR-display-power --why=Display-only-wake /usr/bin/python3 -I {HELPER} run
ExecStopPost=/usr/bin/python3 -I {HELPER} restore
KillMode=control-group
TimeoutStopSec=5s
Restart=no
NoNewPrivileges=yes
CapabilityBoundingSet=
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectKernelLogs=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
RestrictAddressFamilies=AF_UNIX
DevicePolicy=closed
DeviceAllow=char-input r
ReadWritePaths={path}/brightness {path}/bl_power
RuntimeDirectory=layr-display-power
RuntimeDirectoryMode=0755
StateDirectory=layr-display-power
StateDirectoryMode=0700
UMask=0077
[Install]
WantedBy={KIOSK}
'''


class Manager:
    def __init__(self, paths=None, probe=command):
        self.paths = paths or Paths()
        self.probe = probe

    def config(self):
        if not self.paths.config.exists() and not self.paths.config.is_symlink():
            return dict(DEFAULTS)
        return owned_json(self.paths.config)

    def stop(self):
        # The unit has a bounded stop and ExecStopPost, including after SIGKILL.
        try:
            self.probe(['systemctl', 'stop', UNIT])
        finally:
            restore_saved(self.paths)

    def configure(self, changes, enable=False):
        old = self.config()
        chosen = settings(dict({key: old[key] for key in (*DEFAULTS, 'backlight') if key in old}, **changes))
        support = discover(self.paths.root, self.probe, chosen.get('backlight'))
        if not support['supported']:
            raise RuntimeError('; '.join(support['reasons']))
        desktop_guard(self.probe)
        active = self.probe(['systemctl', 'is-active', '--quiet', KIOSK], False).returncode == 0
        if enable and not active:
            raise RuntimeError('Start and physically validate a service-based LAYR kiosk preview first')
        if self.paths.unit.exists() or self.paths.unit.is_symlink():
            owned_unit(self.paths.unit)
        if self.paths.unit.exists():
            self.stop()
        device = next(item for item in backlights(self.paths.root) if item['name'] == support['selected']['name'])
        if device['brightness'] <= 0 or device['bl_power'] != 0:
            raise RuntimeError('Restore the display to its normal nonzero brightness before enabling/configuring power management')
        chosen['enabled'] = enable or old.get('enabled', False)
        config = dict(chosen, backlight=device['name'], path=device['path'], maximum=device['maximum'], normal_brightness=device['brightness'])
        save_json(self.paths.config, config, 0o644)
        secure_directory(self.paths.unit.parent)
        self.paths.unit.write_text(service_unit(device))
        self.paths.unit.chmod(0o644)
        self.probe(['systemctl', 'daemon-reload'])
        if config['enabled']:
            self.probe(['systemctl', 'enable', UNIT])
            if active:
                try:
                    self.probe(['systemctl', 'start', UNIT])
                except (RuntimeError, OSError, subprocess.SubprocessError):
                    self.disable()
                    raise
        else:
            self.probe(['systemctl', 'disable', UNIT])
        return config

    def disable(self):
        config = self.config()
        if self.paths.unit.exists() or self.paths.unit.is_symlink():
            owned_unit(self.paths.unit)
        config['enabled'] = False
        if self.paths.config.exists():
            save_json(self.paths.config, config, 0o644)
        try:
            if self.paths.unit.exists():
                self.probe(['systemctl', 'disable', '--now', UNIT])
        finally:
            restore_saved(self.paths)

    def wake(self):
        if self.paths.socket.exists():
            try:
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(3)
                    client.connect(str(self.paths.socket))
                    client.sendall(b'wake\n')
                    response = b''
                    while not response.endswith(b'\n') and len(response) < 256:
                        part = client.recv(256 - len(response))
                        if not part:
                            break
                        response += part
                    if response != b'ok\n':
                        raise RuntimeError('Display controller did not confirm wake')
                return
            except OSError:
                if restore_saved(self.paths, force=True):
                    print('Controller socket unavailable; restored the original backlight. Inspect the service journal.', flush=True)
                    return
                raise
        if not restore_saved(self.paths, force=True):
            raise RuntimeError('No saved controlled backlight to restore; display power is not installed/enabled')

    def uninstall(self):
        self.disable()
        for path in (self.paths.config, self.paths.state):
            if path.exists():
                owned_json(path)
                path.unlink()
        if self.paths.unit.exists():
            self.paths.unit.unlink()
        self.probe(['systemctl', 'daemon-reload'])
        # Root-owned helper is independent of user releases; remove only its known file.
        HELPER.unlink(missing_ok=True)
        try:
            HELPER.parent.rmdir()
        except OSError:
            pass


class Daemon:
    def __init__(self, paths=None, clock=time.monotonic, session=kiosk_session, scan=None, guard=None):
        self.paths = paths or Paths()
        self.clock, self.session = clock, session
        self.stopping = False
        self.policy = None
        self.backlight = None
        self.normal = None
        self.applied = None
        self.scan = scan or (lambda: inputs(self.paths.root))
        self.guard = guard or desktop_guard

    def apply(self, state):
        if state == self.applied:
            return
        if state == 'active':
            self.backlight.active(self.normal)
        elif state == 'dimmed':
            self.backlight.dim(max(1, round(self.normal * self.policy.config['dim_percent'] / 100)))
        elif state == 'off':
            self.backlight.off()
        self.applied = state
        print('LAYR display state:', state, flush=True)

    def stop_signal(self, signum, frame):
        self.stopping = True

    def run(self):
        config = owned_json(self.paths.config)
        if not config.get('enabled'):
            return
        support = discover(self.paths.root, selected=config.get('backlight'))
        if not support['supported'] or support['selected']['path'] != config.get('path') or support['selected']['maximum'] != config.get('maximum'):
            raise RuntimeError('Hardware changed; reconfigure display power before use: ' + '; '.join(support['reasons']))
        restore_saved(self.paths)
        device = support['selected']
        current = next(item for item in backlights(self.paths.root) if item['name'] == device['name'])
        if current['brightness'] <= 0 or current['bl_power'] != 0:
            raise RuntimeError('Cannot capture an already dark display as normal brightness')
        if type(config.get('normal_brightness')) is not int or not 1 <= config['normal_brightness'] <= device['maximum']:
            raise RuntimeError('Configured normal brightness is outside current hardware limits')
        self.backlight = Backlight(device, self.paths.root)
        self.normal = config['normal_brightness']
        self.policy = IdlePolicy(config, self.clock())
        selector = selectors.DefaultSelector()
        opened = {}
        server = None
        old_signals = {sig: signal.signal(sig, self.stop_signal) for sig in (signal.SIGTERM, signal.SIGINT)}
        def add_input(spec):
            fd = os.open(str(self.paths.root / spec['node'].lstrip('/')), os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC)
            state = InputState(spec)
            try:
                initial_input_state(fd, state)
            except Exception:
                os.close(fd)
                raise
            opened[fd] = (state, EventDecoder())
            selector.register(fd, selectors.EVENT_READ, 'input')
        try:
            # Durable journal BEFORE the first brightness/power write.
            save_json(self.paths.state, dict(machine_id=machine_id(self.paths.root), name=device['name'], path=device['path'], maximum=device['maximum'], brightness=current['brightness'], bl_power=0, needs_restore=True))
            for spec in support['inputs']:
                add_input(spec)
            known_input_names = tuple(sorted(p.name for p in (self.paths.root / 'sys/class/input').glob('event*')))
            secure_directory(self.paths.socket.parent)
            self.paths.socket.unlink(missing_ok=True)
            server = socket.socket(socket.AF_UNIX)
            server.bind(str(self.paths.socket))
            self.paths.socket.chmod(0o600)
            server.listen(4)
            server.setblocking(False)
            selector.register(server, selectors.EVENT_READ, 'wake')
            started = self.clock()
            last_check = float('-inf')
            session_active = False
            ready = False
            last_status = float('-inf')
            self.apply('active')
            while not self.stopping:
                # Drain all queued input before evaluating idle deadlines.
                for key, _ in selector.select(0.1):
                    if key.data == 'wake':
                        connection, _ = server.accept()
                        with connection:
                            connection.settimeout(0.2)
                            uid = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1]
                            try:
                                request = b''
                                while not request.endswith(b'\n') and len(request) < 16:
                                    part = connection.recv(16 - len(request))
                                    if not part:
                                        break
                                    request += part
                                if uid == ROOT_UID and request == b'wake\n':
                                    self.policy.activity(self.clock(), power=True)
                                    self.apply('active')
                                    connection.sendall(b'ok\n')
                                else:
                                    connection.sendall(b'error\n')
                            except OSError:
                                # A cancelled SSH client must not kill the controller.
                                pass
                        continue
                    state, decoder = opened[key.fd]
                    for _ in range(32):
                        try:
                            data = os.read(key.fd, decoder.struct.size * 64)
                        except BlockingIOError:
                            break
                        if not data:
                            raise RuntimeError('Input device disconnected; restore display instead of leaving it dark')
                        for event in decoder.feed(data):
                            activity, power = state.event(*event)
                            if activity:
                                self.policy.activity(self.clock(), power)
                now = self.clock()
                if not owned_json(self.paths.config).get('enabled'):
                    break
                if now - last_check >= 2:
                    self.guard()
                    current_names = tuple(sorted(p.name for p in (self.paths.root / 'sys/class/input').glob('event*')))
                    if current_names != known_input_names:
                        found = self.scan()
                        current_nodes = {state.spec['node'] for state, _ in opened.values()}
                        if not any(item['power'] for item in found) or not current_nodes.issubset({item['node'] for item in found}):
                            raise RuntimeError('An input/wake device disappeared; restoring the display')
                        for spec in found:
                            if spec['node'] not in current_nodes:
                                add_input(spec)
                                self.policy.activity(now, power=True)
                        known_input_names = current_names
                    value = self.session()
                    if value is None:
                        if ready or now - started > 15:
                            raise RuntimeError('Kiosk exited or did not register its local session; restoring display')
                        session_active = False
                    else:
                        session_active = value
                        ready = True
                    last_check = now
                held = any(state.held for state, _ in opened.values())
                self.apply(self.policy.tick(now, held, session_active))
                if now - last_status >= 1:
                    save_json(self.paths.status, dict(state=self.applied, session_active=session_active, session_ready=ready, idle_seconds=max(0, int(now - self.policy.last_activity)), normal_brightness=self.normal, dim_brightness=max(1, round(self.normal * self.policy.config['dim_percent'] / 100)), inhibitor='handle-power-key only; held by systemd-inhibit'), 0o644)
                    last_status = now
        finally:
            for fd in opened:
                os.close(fd)
            if server:
                server.close()
            selector.close()
            self.paths.socket.unlink(missing_ok=True)
            for sig, handler in old_signals.items():
                signal.signal(sig, handler)
            restore_saved(self.paths)
            save_json(self.paths.status, dict(state='restored', reason='controller stopped; original logind policy resumes'), 0o644)


def diagnostics(root=Path('/'), probe=command, selected=None):
    paths = Paths(root)
    config = dict(DEFAULTS)
    if paths.config.exists():
        config = owned_json(paths.config)
    status = owned_json(paths.status) if paths.status.exists() else dict(state='not running')
    service = probe(['systemctl', 'show', UNIT, '-p', 'ActiveState', '-p', 'SubState', '-p', 'Result', '-p', 'ExecMainStatus'], False)
    inhibitors = probe(['systemd-inhibit', '--list', '--no-pager'], False)
    return dict(settings=config, support=discover(root, probe, selected or config.get('backlight')), runtime=status,
                service=dict(returncode=service.returncode, stdout=service.stdout.strip(), stderr=service.stderr.strip()),
                inhibitors=dict(returncode=inhibitors.returncode, stdout=inhibitors.stdout.strip(), stderr=inhibitors.stderr.strip()),
                logind_policy='No config files edited. Runtime handle-power-key inhibitor only; CLI poweroff/shutdown remains available.',
                note='Backlight only: Linux/Moonraker stay running. Input is never grabbed or disabled. Wake with power button before touching a dark UI.')


def trusted_root_copy():
    if os.geteuid() != 0:
        raise RuntimeError('Use layr display-power; privileged operations require validated sudo')
    if Path(__file__).resolve() != HELPER:
        raise RuntimeError('Root execution is allowed only from the installed root-owned helper')
    for path in (HELPER, *HELPER.parents):
        info = path.stat()
        if info.st_uid != 0 or info.st_mode & 0o022 or path.is_symlink():
            raise RuntimeError('Root helper and its parent directories must be root-owned and not writable by other users')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['enable', 'configure', 'disable', 'wake', 'uninstall', 'restore', 'run'])
    parser.add_argument('--settings', default='{}')
    args = parser.parse_args()
    trusted_root_copy()
    values = json.loads(args.settings)
    settings(values)  # validate a partial update without replacing other settings
    manager = Manager()
    if args.action in ('enable', 'configure'):
        manager.configure(values, args.action == 'enable')
    elif args.action == 'run':
        parent = Path('/proc') / str(os.getppid()) / 'cmdline'
        words = parent.read_bytes().split(b'\0')
        if not words or Path(os.fsdecode(words[0])).name != 'systemd-inhibit' or b'--what=handle-power-key' not in words or b'--mode=block' not in words:
            raise RuntimeError('Run through the unit/systemd-inhibit; never blank without the power-key inhibitor')
        Daemon().run()
    elif args.action == 'restore':
        restore_saved(manager.paths)
    else:
        getattr(manager, args.action)()


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        print('LAYR display power:', error, file=sys.stderr, flush=True)
        sys.exit(1)

# LAYR_SCRIPT_END
