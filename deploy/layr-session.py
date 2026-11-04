#!/usr/bin/python3
"""Own the PAM session; supervise Cage as a child, never as the PAM main process."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

STOP_GRACE_SECONDS = 5.0


def checked(command):
    result = subprocess.run(command, text=True, capture_output=True, timeout=8)
    if result.returncode:
        raise RuntimeError(' '.join(command) + f' exited {result.returncode}: ' + result.stderr.strip())
    return result.stdout.strip()


def validate_session(env):
    uid = os.getuid()
    if uid == 0 or os.geteuid() == 0:
        raise RuntimeError('The kiosk session and browser must run as the configured normal user, not root')
    if not os.isatty(0) or os.ttyname(0) != '/dev/tty7':
        raise RuntimeError('A controlling /dev/tty7 is required; start through layr-kiosk.service, not an SSH shell')
    expected = dict(XDG_SESSION_TYPE='wayland', XDG_SESSION_CLASS='user', XDG_SEAT='seat0', XDG_VTNR='7')
    for key, value in expected.items():
        if env.get(key) != value:
            raise RuntimeError(f'{key} must be {value}; actual={env.get(key, "unset")}. Check the dedicated PAM/unit setup')
    session_id = env.get('XDG_SESSION_ID')
    if not session_id:
        raise RuntimeError('PAM did not provide XDG_SESSION_ID; verify libpam-systemd and the layr-kiosk PAM stack')
    runtime = Path(env.get('XDG_RUNTIME_DIR', '/nonexistent-layr-runtime'))
    info = runtime.stat()
    if not runtime.is_dir() or info.st_uid != uid or info.st_mode & 0o077:
        raise RuntimeError('XDG_RUNTIME_DIR must be a private directory owned by the kiosk user; do not chmod graphics devices')
    output = checked(['loginctl', 'show-session', session_id, '--no-pager', '-p', 'User', '-p', 'Seat', '-p', 'VTNr', '-p', 'Type', '-p', 'Class', '-p', 'Remote', '-p', 'Leader'])
    values = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
    required = dict(User=str(uid), Seat='seat0', VTNr='7', Type='wayland', Class='user', Remote='no', Leader=str(os.getpid()))
    for key, value in required.items():
        if values.get(key) != value:
            raise RuntimeError(f'Wrong logind session {session_id}: {key}={values.get(key, "unset")}, expected {value}. Refusing to borrow another login/SSH session')
    for unit in ('display-manager.service', 'KlipperScreen.service'):
        result = subprocess.run(['systemctl', 'is-active', '--quiet', unit], timeout=5)
        if result.returncode == 0:
            raise RuntimeError(f'{unit} is active. Refusing to take over its display')
    # Uses the stock login1.chvt Polkit policy for this local, non-remote session.
    # This is one explicit activation, not a rendering retry or a seatd fallback.
    checked(['loginctl', 'activate', session_id])
    print(f'LAYR local session: id={session_id} uid={uid} leader={os.getpid()} seat=seat0 VT=7 backend=logind', flush=True)
    return session_id


def group_signal(pid, signum):
    try:
        os.killpg(pid, signum)
    except ProcessLookupError:
        pass


def supervise(command, grace=STOP_GRACE_SECONDS):
    stopping = False
    deadline = None
    child = None
    old_foreground = None

    def stop(signum, frame):
        nonlocal stopping, deadline
        stopping = True
        if deadline is None:
            deadline = time.monotonic() + grace
        if child is not None:
            group_signal(child.pid, signal.SIGTERM)

    previous = {sig: signal.signal(sig, stop) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        # A new process group within the SAME controlling-terminal session.
        # Do not use setsid/start_new_session, which would detach the VT.
        child = subprocess.Popen(command, process_group=0)
        if os.isatty(0):
            old_foreground = os.tcgetpgrp(0)
            mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTTOU})
            try:
                os.tcsetpgrp(0, child.pid)
            finally:
                signal.pthread_sigmask(signal.SIG_SETMASK, mask)
        if stopping:
            group_signal(child.pid, signal.SIGTERM)
        while True:
            try:
                code = child.wait(timeout=0.1)
                break
            except subprocess.TimeoutExpired:
                if deadline is not None and time.monotonic() >= deadline:
                    print('LAYR kiosk stop grace expired; terminating the owned renderer process group', file=sys.stderr, flush=True)
                    group_signal(child.pid, signal.SIGKILL)
                    code = child.wait(timeout=1)
                    break
        if stopping:
            print(f'LAYR kiosk stopped; renderer exit={code}', flush=True)
            return 0
        print(f'LAYR renderer exited unexpectedly: exit={code}; graphical readiness was not established', file=sys.stderr, flush=True)
        return code if code > 0 else (128 - code if code < 0 else 1)
    finally:
        if child is not None:
            # Also clear remaining Chromium children after Cage exits. This group
            # excludes the supervisor and its separate (sd-pam) child.
            group_signal(child.pid, signal.SIGTERM)
            end = time.monotonic() + min(grace, 1.0)
            while time.monotonic() < end:
                try:
                    os.killpg(child.pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.05)
            group_signal(child.pid, signal.SIGKILL)
        if old_foreground is not None:
            mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTTOU})
            try:
                os.tcsetpgrp(0, old_foreground)
            except OSError:
                pass
            finally:
                signal.pthread_sigmask(signal.SIG_SETMASK, mask)
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def main():
    env_backend = os.environ.get('LIBSEAT_BACKEND', 'logind')
    if env_backend != 'logind':
        raise RuntimeError('Standalone kiosk requires LIBSEAT_BACKEND=logind; seatd fallback is not used')
    validate_session(os.environ)
    os.environ['LIBSEAT_BACKEND'] = 'logind'
    return supervise([str(Path(__file__).resolve().with_name('layr-kiosk.sh'))])


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'LAYR session startup failed: {error}', file=sys.stderr, flush=True)
        sys.exit(1)

# LAYR_SCRIPT_END
