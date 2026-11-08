import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bootstrap = path.join(repo, 'deploy/layr-installer.sh');

type RunResult = { status: number; stdout: string; stderr: string };

function writeExe(file: string, body: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body.endsWith('\n') ? body : `${body}\n`);
  chmodSync(file, 0o755);
}

function run(command: string, env: NodeJS.ProcessEnv, cwd = repo): RunResult {
  try {
    const stdout = execFileSync('bash', ['-c', command], {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const err = error as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return { status: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
}

function textOf(result: RunResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

const PRESENT = 'ca-certificates curl python3 git tar gzip coreutils cage chromium sha256sum';

function osFile(root: string, fields: Record<string, string>): string {
  const file = path.join(root, 'os-release');
  writeFileSync(file, `${Object.entries(fields).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n')}\n`);
  return file;
}

interface Sandbox {
  root: string;
  home: string;
  dist: string;
  env: NodeJS.ProcessEnv;
  aptLog: string;
  httpLog: string;
  systemctlLog: string;
  objects: string;
  query: string;
}

function makeSandbox(options: { os?: Record<string, string>; arch?: string; present?: string } = {}): Sandbox {
  const root = mkdtempSync(path.join(tmpdir(), 'layr-bootstrap-'));
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const dist = path.join(root, 'dist');
  const drm = path.join(root, 'drm', 'card0-HDMI-A-1');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(dist, { recursive: true });
  mkdirSync(drm, { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>LAYR</title>');
  writeFileSync(path.join(drm, 'status'), 'connected\n');
  writeFileSync(path.join(drm, 'modes'), '800x480\n1920x1080\n');
  const touch = path.join(root, 'inputs');
  writeFileSync(
    touch,
    [
      'N: Name="Goodix Capacitive TouchScreen"',
      'H: Handlers=event0',
      '',
      'N: Name="Logitech USB Optical Mouse"',
      'H: Handlers=mouse0 event1',
      '',
    ].join('\n'),
  );
  const conf = path.join(root, 'moonraker.conf');
  writeFileSync(conf, '# fixture\n[authorization]\ntrusted_clients:\n  127.0.0.1\n');
  const objects = path.join(root, 'objects.json');
  const query = path.join(root, 'query.json');
  writeFileSync(objects, `${JSON.stringify({ result: { objects: ['webhooks'] } })}\n`);
  writeFileSync(query, `${JSON.stringify({ result: { status: {} } })}\n`);
  const httpLog = path.join(root, 'http.log');
  const aptLog = path.join(root, 'apt.log');
  const systemctlLog = path.join(root, 'systemctl.log');
  writeExe(
    path.join(bin, 'layr-http'),
    `#!/bin/bash
url="$1"
dest="$2"
printf '%s\\n' "$url" >> "$LAYR_HTTP_LOG"
if [ "\${LAYR_HTTP_MODE:-ok}" = "fail" ]; then
  exit 1
fi
case "$url" in
  */server/info)
    printf '%s' '{"result":{"klippy_state":"ready","moonraker_version":"test"}}' > "$dest"
    ;;
  */printer/objects/list)
    cat "$LAYR_OBJECTS_JSON" > "$dest"
    ;;
  */printer/objects/query*)
    cat "$LAYR_QUERY_JSON" > "$dest"
    ;;
  */releases/latest)
    if [ ! -s "$LAYR_RELEASE_JSON" ]; then
      printf '%s' 'Not Found' > "$dest"
      exit 0
    fi
    cat "$LAYR_RELEASE_JSON" > "$dest"
    ;;
  */layr-dist.tar.gz.sha256)
    cat "$LAYR_SHA_FILE" > "$dest"
    ;;
  */layr-dist.tar.gz)
    cat "$LAYR_TARBALL" > "$dest"
    ;;
  */commits/*)
    cat "$LAYR_COMMIT_JSON" > "$dest"
    ;;
  http://127.0.0.1:*/* | http://127.0.0.1:*)
    if [ "\${LAYR_PAGE_EMPTY:-0}" = 1 ]; then
      : > "$dest"
    else
      printf '%s' '<!doctype html><title>LAYR</title>' > "$dest"
    fi
    ;;
  *)
    printf 'unexpected %s\\n' "$url" >> "$LAYR_HTTP_LOG"
    exit 1
    ;;
esac
`,
  );
  writeExe(
    path.join(bin, 'layr-apt'),
    `#!/bin/bash
printf '%s\\n' "$*" >> "$LAYR_APT_LOG"
exit "\${LAYR_APT_RC:-0}"
`,
  );
  writeExe(path.join(bin, 'layr-sudo'), '#!/bin/bash\nexec "$@"\n');
  writeExe(
    path.join(bin, 'systemctl'),
    `#!/bin/bash
printf '%s\\n' "$*" >> "$LAYR_SYSTEMCTL_LOG"
verb=$1
shift
unit=
for arg in "$@"; do
  case "$arg" in
    --*) ;;
    *) unit=$arg ;;
  esac
done
case "$verb" in
  is-active)
    case " \${LAYR_FAILED_UNITS:-} " in
      *" $unit "*) printf 'failed\\n'; exit 3 ;;
    esac
    case " \${LAYR_ACTIVE_UNITS:-} " in
      *" $unit "*) printf 'active\\n'; exit 0 ;;
    esac
    printf 'inactive\\n'
    exit 3
    ;;
  is-enabled)
    case " \${LAYR_ENABLED_UNITS:-} " in
      *" $unit "*) printf 'enabled\\n'; exit 0 ;;
    esac
    case " \${LAYR_UNITS:-} " in
      *" $unit "*) printf 'disabled\\n'; exit 1 ;;
    esac
    printf 'not-found\\n'
    exit 1
    ;;
  list-unit-files)
    case " \${LAYR_UNITS:-} " in
      *" $unit "*) printf '%s enabled enabled\\n' "$unit"; exit 0 ;;
    esac
    exit 1
    ;;
esac
exit 0
`,
  );
  const os = options.os ?? {
    ID: 'raspbian',
    ID_LIKE: 'debian',
    NAME: 'Raspbian GNU/Linux',
    VERSION_ID: '12',
    VERSION_CODENAME: 'bookworm',
    PRETTY_NAME: 'Raspbian GNU/Linux 12 (bookworm)',
  };
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    HOME: home,
    LAYR_HOME: path.join(home, 'layr'),
    LAYR_OS_RELEASE: osFile(root, os),
    LAYR_ARCH: options.arch ?? 'aarch64',
    LAYR_DEVICE_TREE: path.join(root, 'missing-model'),
    LAYR_RPI_ISSUE: path.join(root, 'missing-rpi-issue'),
    LAYR_MAINSAIL_FILES: '',
    LAYR_FAKE_PRESENT: options.present ?? PRESENT,
    LAYR_MEM_MB: '2048',
    LAYR_DISK_FREE_MB: '8000',
    LAYR_SUDO_OK: '1',
    LAYR_SUDO_CMD: path.join(bin, 'layr-sudo'),
    LAYR_APT_GET: path.join(bin, 'layr-apt'),
    LAYR_APT_LOG: aptLog,
    LAYR_APT_RETRY_SLEEP: '0',
    LAYR_HTTP_GET: path.join(bin, 'layr-http'),
    LAYR_HTTP_LOG: httpLog,
    LAYR_HTTP_MODE: 'ok',
    LAYR_OBJECTS_JSON: objects,
    LAYR_QUERY_JSON: query,
    LAYR_RELEASE_JSON: path.join(root, 'release.json'),
    LAYR_COMMIT_JSON: path.join(root, 'commit.json'),
    LAYR_SYSTEMCTL_LOG: systemctlLog,
    LAYR_DRM_ROOT: path.join(root, 'drm'),
    LAYR_INPUT_DEVICES: touch,
    LAYR_MOONRAKER_CONF: conf,
    LAYR_GROUPS: 'video render input',
    LAYR_KIOSK_ACTIVE: '0',
    LAYR_REF: '',
    LAYR_UNITS: '',
    LAYR_ACTIVE_UNITS: '',
    LAYR_FAILED_UNITS: '',
    LAYR_ENABLED_UNITS: '',
  };
  return { root, home, dist, env, aptLog, httpLog, systemctlLog, objects, query };
}

function invoke(box: Sandbox, args: string[], extra: NodeJS.ProcessEnv = {}): RunResult {
  const command = `bash ${JSON.stringify(bootstrap)} ${args.map((arg) => JSON.stringify(arg)).join(' ')}`;
  return run(command, { ...box.env, ...extra });
}

function cleanup(box: Sandbox) {
  rmSync(box.root, { recursive: true, force: true });
}

const releaseAsset = {
  tag_name: 'v0.2.0',
  assets: [
    {
      name: 'layr-dist.tar.gz',
      browser_download_url: 'https://github.com/EzraTechnologies/LAYR/releases/download/v0.2.0/layr-dist.tar.gz',
    },
    {
      name: 'layr-dist.tar.gz.sha256',
      browser_download_url: 'https://github.com/EzraTechnologies/LAYR/releases/download/v0.2.0/layr-dist.tar.gz.sha256',
    },
  ],
};

function objects(names: string[]) {
  return `${JSON.stringify({ result: { objects: names } })}\n`;
}

describe('bootstrap platform preflight', () => {
  it('accepts Raspberry Pi OS Bookworm arm64 and leaves KlipperScreen alone', () => {
    const box = makeSandbox();
    try {
      const result = invoke(box, ['diagnose', '--dist', box.dist]);
      const output = textOf(result);
      expect(result.status).toBe(0);
      expect(output).toContain('support=yes');
      expect(output).toContain('kind=raspberry-pi-os');
      expect(output).toContain('preflight=ok');
      expect(output).toContain('changed=no');
      expect(output).toContain('panel-800x480: listed');
      expect(output).toContain('hdmi-mode: not set');
      expect(output).toContain('touch: Goodix Capacitive TouchScreen');
      expect(output).not.toContain('touch: Logitech');
      expect(output).toContain('udev: not modified');
      expect(output).toContain('install-state: not-installed');
      expect(output).toContain('display-switch: no');
      expect(output).toContain('klipperscreen: left as it is until you confirm a switch');
      expect(output).toContain('to-klipperscreen');
      expect(output).toContain('panel-check:');
      expect(output).toContain('does not force 800x480');
      expect(existsSync(box.aptLog)).toBe(false);
      expect(readFileSync(box.systemctlLog, 'utf8')).toContain('is-active');
      expect(readFileSync(box.systemctlLog, 'utf8')).not.toContain('disable');
      const before = statSync(box.env.LAYR_MOONRAKER_CONF as string).mtimeMs;
      expect(statSync(box.env.LAYR_MOONRAKER_CONF as string).mtimeMs).toBe(before);
      expect(existsSync(path.join(box.home, 'layr'))).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('treats MainsailOS Bookworm and armhf as supported', () => {
    const box = makeSandbox({
      os: {
        ID: 'debian',
        ID_LIKE: 'debian',
        NAME: 'Debian GNU/Linux',
        VERSION_ID: '12',
        VERSION_CODENAME: 'bookworm',
        PRETTY_NAME: 'Debian GNU/Linux 12 (bookworm)',
      },
      arch: 'armv7l',
    });
    const marker = path.join(box.root, 'mainsailos-release');
    writeFileSync(marker, 'fixture\n');
    try {
      const result = invoke(box, ['diagnose', '--dist', box.dist], { LAYR_MAINSAIL_FILES: marker });
      expect(result.status).toBe(0);
      expect(textOf(result)).toContain('kind=mainsailos');
      expect(textOf(result)).toContain('support=yes');
      expect(textOf(result)).toContain('arch=armv7l');
    } finally {
      cleanup(box);
    }
  });

  it.each([
    ['Ubuntu', { ID: 'ubuntu', ID_LIKE: 'debian', NAME: 'Ubuntu', VERSION_ID: '24.04', VERSION_CODENAME: 'noble', PRETTY_NAME: 'Ubuntu 24.04' }, 'x86_64'],
    ['generic Debian Bookworm', { ID: 'debian', ID_LIKE: 'debian', NAME: 'Debian GNU/Linux', VERSION_ID: '12', VERSION_CODENAME: 'bookworm', PRETTY_NAME: 'Debian GNU/Linux 12 (bookworm)' }, 'aarch64'],
    ['trixie', { ID: 'raspbian', ID_LIKE: 'debian', NAME: 'Raspbian', VERSION_ID: '13', VERSION_CODENAME: 'trixie', PRETTY_NAME: 'Raspbian 13' }, 'aarch64'],
    ['bullseye', { ID: 'raspbian', ID_LIKE: 'debian', NAME: 'Raspbian', VERSION_ID: '11', VERSION_CODENAME: 'bullseye', PRETTY_NAME: 'Raspbian 11' }, 'aarch64'],
    ['armv6', { ID: 'raspbian', ID_LIKE: 'debian', NAME: 'Raspbian', VERSION_ID: '12', VERSION_CODENAME: 'bookworm', PRETTY_NAME: 'Raspbian GNU/Linux 12 (bookworm)' }, 'armv6l'],
  ])('rejects %s without apt', (_name, os, arch) => {
    const box = makeSandbox({ os, arch });
    try {
      const result = invoke(box, ['diagnose', '--dist', box.dist]);
      const output = textOf(result);
      expect(result.status).not.toBe(0);
      expect(output).toContain('support=no');
      expect(output).toContain('changed=no');
      expect(output).toContain('KlipperScreen was not stopped');
      expect(existsSync(box.aptLog)).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('stops before apt when sudo is missing', () => {
    const box = makeSandbox();
    try {
      const result = invoke(box, ['--yes', '--dist', box.dist], { LAYR_SUDO_OK: '0' });
      expect(result.status).not.toBe(0);
      expect(textOf(result)).toContain('changed=no');
      expect(textOf(result)).toContain('sudo is required');
      expect(existsSync(box.aptLog)).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('stops before apt when GitHub cannot be reached', () => {
    const box = makeSandbox();
    try {
      const result = invoke(box, ['--yes'], { LAYR_HTTP_MODE: 'fail' });
      expect(result.status).not.toBe(0);
      expect(textOf(result)).toContain('changed=no');
      expect(textOf(result)).toContain('Could not reach GitHub');
      expect(existsSync(box.aptLog)).toBe(false);
      expect(existsSync(path.join(box.home, 'layr'))).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('reports an unreachable Moonraker without editing its config', () => {
    const box = makeSandbox();
    const before = statSync(box.env.LAYR_MOONRAKER_CONF as string).mtimeMs;
    try {
      const result = invoke(box, ['--dry-run', '--yes', '--dist', box.dist], { LAYR_HTTP_MODE: 'fail' });
      const output = textOf(result);
      expect(result.status).toBe(0);
      expect(output).toContain('moonraker: reachable: no');
      expect(output).toContain('will not edit moonraker.conf');
      expect(output).toContain('controllers: unknown');
      expect(statSync(box.env.LAYR_MOONRAKER_CONF as string).mtimeMs).toBe(before);
      expect(readFileSync(box.env.LAYR_MOONRAKER_CONF as string, 'utf8')).not.toContain('cors_domains');
    } finally {
      cleanup(box);
    }
  });

  it('fails a short disk and a low memory read before changing anything', () => {
    const box = makeSandbox();
    try {
      const disk = invoke(box, ['diagnose', '--dist', box.dist], { LAYR_DISK_FREE_MB: '10' });
      expect(disk.status).not.toBe(0);
      expect(textOf(disk)).toContain('changed=no');
      expect(textOf(disk)).toContain('Not enough free disk');
      const memory = invoke(box, ['diagnose', '--dist', box.dist], { LAYR_MEM_MB: '64' });
      expect(memory.status).not.toBe(0);
      expect(textOf(memory)).toContain('Not enough memory');
      expect(existsSync(path.join(box.home, 'layr'))).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('reports an unreadable touch node without writing an input rule', () => {
    const box = makeSandbox();
    try {
      const result = invoke(box, ['diagnose', '--sample-touch', '--dist', box.dist], {
        LAYR_INPUT_ROOT: path.join(box.root, 'no-input'),
      });
      const output = textOf(result);
      expect(result.status).toBe(0);
      expect(output).toContain('touch: Goodix Capacitive TouchScreen');
      expect(output).toContain('is not readable');
      expect(output).toContain('No udev rule was written');
      expect(output).toContain('changed=no');
    } finally {
      cleanup(box);
    }
  });
});

describe('bootstrap filament controllers', () => {
  function withPrinter(names: string[], query: unknown) {
    const box = makeSandbox();
    writeFileSync(box.objects, objects(names));
    writeFileSync(box.query, `${JSON.stringify(query)}\n`);
    return box;
  }

  it('reads AFC and lane status and leaves Happy Hare off', () => {
    const box = withPrinter(
      ['webhooks', 'AFC', 'AFC_lane lane1', 'AFC_stepper hub0', 'AFC_BoxTurtle Turtle_1'],
      {
        result: {
          status: {
            AFC: { current_load: 'lane1', current_lane: 'lane1', current_state: 'Idle', error_state: false, message: 'ready' },
            'AFC_lane lane1': { filament_status: 'Loaded', prep: true, load: true, tool_loaded: true, loaded_to_hub: false },
          },
        },
      },
    );
    try {
      const result = invoke(box, ['diagnose', '--dist', box.dist]);
      const output = textOf(result);
      const log = readFileSync(box.httpLog, 'utf8');
      expect(result.status).toBe(0);
      expect(output).toContain('afc-object: present');
      expect(output).toContain('mmu-object: absent');
      expect(output).toContain('afc-lanes: lane1 hub0');
      expect(output).toContain('afc-unit: AFC_BoxTurtle Turtle_1');
      expect(output).toContain('controllers: afc');
      expect(output).toContain('afc-status: current_load=lane1 current_lane=lane1 current_state=Idle error_state=false message=ready');
      expect(output).toContain('afc-lane-status: lane1 filament_status=Loaded prep=true load=true tool_loaded=true loaded_to_hub=false');
      expect(output).toContain('turn AFC on');
      expect(output).toContain('Leave Happy Hare off');
      expect(output).not.toContain('turn Happy Hare on');
      expect(output).toContain('did not install or change AFC');
      expect(log).toContain('/printer/objects/query?');
      expect(log).not.toContain('gcode');
      expect(log.split('\n').every((line) => line === '' || line.startsWith('http://localhost:7125/'))).toBe(true);
    } finally {
      cleanup(box);
    }
  });

  it('reads Happy Hare tool and gate status and leaves AFC off', () => {
    const box = withPrinter(['webhooks', 'mmu'], {
      result: {
        status: {
          mmu: {
            tool: 1,
            gate: 2,
            filament: 'Loaded',
            action: 'Idle',
            print_state: 'standby',
            enabled: true,
            reason_for_pause: null,
            gate_status: [1, 0, 2],
            gate_material: ['PLA', 'PETG', 'ABS'],
            gate_filament_name: ['Blue', 'Red', 'Green'],
          },
        },
      },
    });
    try {
      const result = invoke(box, ['diagnose', '--dist', box.dist]);
      const output = textOf(result);
      expect(result.status).toBe(0);
      expect(output).toContain('afc-object: absent');
      expect(output).toContain('mmu-object: present');
      expect(output).toContain('controllers: happy-hare');
      expect(output).toContain('mmu-status: tool=1 gate=2 filament=Loaded action=Idle print_state=standby enabled=true reason_for_pause=not-reported');
      expect(output).toContain('mmu-gate: 0 status=1 material=PLA name=Blue');
      expect(output).toContain('mmu-gate: 2 status=2 material=ABS name=Green');
      expect(output).toContain('turn Happy Hare on');
      expect(output).toContain('Leave AFC off');
      expect(output).not.toContain('turn AFC on');
      expect(output).toContain('did not install or change Happy Hare');
      expect(output).not.toContain('afc-status:');
      expect(readFileSync(box.httpLog, 'utf8')).not.toContain('gcode');
    } finally {
      cleanup(box);
    }
  });

  it('refuses to encourage both controllers when both objects are listed', () => {
    const box = withPrinter(['AFC', 'AFC_lane lane1', 'mmu'], {
      result: {
        status: {
          AFC: { current_load: null, current_state: 'Idle', error_state: false, message: 'ready' },
          'AFC_lane lane1': { filament_status: 'Ready', prep: false, load: false, tool_loaded: false, loaded_to_hub: false },
          mmu: { tool: -1, gate: -1, filament: 'Unloaded', action: 'Idle', print_state: 'idle', enabled: false, gate_status: [0], gate_material: ['PLA'], gate_filament_name: ['Spare'] },
        },
      },
    });
    try {
      const result = invoke(box, ['diagnose', '--dist', box.dist]);
      const output = textOf(result);
      expect(result.status).toBe(0);
      expect(output).toContain('controllers: both');
      expect(output).toContain('afc-object: present');
      expect(output).toContain('mmu-object: present');
      expect(output).toContain('afc-lane-status: lane1');
      expect(output).toContain('mmu-status: tool=-1 gate=-1');
      expect(output).toContain('mutually exclusive');
      expect(output).toContain('Do not enable both switches');
      expect(output).toContain('Do not run both controllers at the same time');
      expect(output).toContain('different printer');
      expect(output).not.toContain('turn AFC on');
      expect(output).not.toContain('turn Happy Hare on');
      expect(output).toContain('did not install, configure, or start either');
      expect(readFileSync(box.httpLog, 'utf8')).not.toMatch(/gcode|script/);
    } finally {
      cleanup(box);
    }
  });

  it('treats a printer with neither object as optional', () => {
    const box = withPrinter(['webhooks', 'extruder'], { result: { status: {} } });
    try {
      const result = invoke(box, ['diagnose', '--dist', box.dist]);
      const output = textOf(result);
      expect(output).toContain('controllers: neither');
      expect(output).toContain('afc-object: absent');
      expect(output).toContain('mmu-object: absent');
      expect(output).toContain('Both stay off');
      expect(output).toContain('without reinstalling LAYR');
      expect(output).toContain('Do not enable both switches');
      expect(output).not.toContain('afc-status:');
      expect(output).not.toContain('mmu-status:');
    } finally {
      cleanup(box);
    }
  });
});

describe('bootstrap source selection and install handoff', () => {
  it('prefers a signed release asset and does not download Node', () => {
    const box = makeSandbox();
    writeFileSync(box.env.LAYR_RELEASE_JSON as string, `${JSON.stringify(releaseAsset)}\n`);
    try {
      const result = invoke(box, ['--dry-run', '--yes']);
      const output = textOf(result);
      expect(result.status).toBe(0);
      expect(output).toContain('source: release v0.2.0');
      expect(output).toContain('would-download: https://github.com/EzraTechnologies/LAYR/releases/download/v0.2.0/layr-dist.tar.gz');
      expect(output).not.toContain('node-v22');
      expect(output).toContain('display-changed=no');
      expect(output).toContain('webkit-port: not installed');
    } finally {
      cleanup(box);
    }
  });

  it('unpacks deploy scripts from a release archive and does not build Node', () => {
    const box = makeSandbox();
    const stage = path.join(box.root, 'stage');
    const tarball = path.join(box.root, 'layr-dist.tar.gz');
    mkdirSync(path.join(stage, 'deploy'), { recursive: true });
    writeFileSync(path.join(stage, 'index.html'), '<!doctype html><title>from-release</title>');
    writeExe(path.join(stage, 'deploy', 'install.sh'), '#!/bin/bash\nprintf \'install %s\\n\' "$*"\n');
    execFileSync('tar', ['-C', stage, '-czf', tarball, '.']);
    const sha = execFileSync('sha256sum', [tarball], { encoding: 'utf8' }).split(/\s+/)[0];
    writeFileSync(path.join(box.root, 'layr-dist.tar.gz.sha256'), `${sha}\n`);
    writeFileSync(box.env.LAYR_RELEASE_JSON as string, `${JSON.stringify(releaseAsset)}\n`);
    try {
      const result = invoke(box, ['--yes'], {
        LAYR_TARBALL: tarball,
        LAYR_SHA_FILE: path.join(box.root, 'layr-dist.tar.gz.sha256'),
      });
      const output = textOf(result);
      expect(result.status, output).toBe(0);
      expect(output).toContain('install --dist');
      expect(output).toContain('--yes');
      expect(output).not.toContain('node-v22');
      expect(output).toContain('display-changed=no');
      expect(existsSync(path.join(box.home, 'layr', 'src', 'deploy', 'install.sh'))).toBe(true);
    } finally {
      cleanup(box);
    }
  });

  it('ignores an unsigned release and falls through to a pinned Node build', () => {
    const box = makeSandbox();
    writeFileSync(
      box.env.LAYR_RELEASE_JSON as string,
      `${JSON.stringify({ tag_name: 'v9.9.9', assets: [{ name: 'layr-dist.tar.gz', browser_download_url: 'https://github.com/EzraTechnologies/LAYR/releases/download/v9.9.9/layr-dist.tar.gz' }] })}\n`,
    );
    writeFileSync(box.env.LAYR_COMMIT_JSON as string, `${JSON.stringify({ sha: 'a'.repeat(40) })}\n`);
    try {
      const result = invoke(box, ['--dry-run', '--yes']);
      const output = textOf(result);
      expect(result.status).toBe(0);
      expect(output).toContain('unsigned release was ignored');
      expect(output).toContain(`source: build ${'a'.repeat(40)}`);
      expect(output).toContain('https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-arm64.tar.gz');
      expect(output).toContain('f7a1e486dbc8b286847815b477d4fb5e9fb963ed4489c3e1588853d685f589f9');
    } finally {
      cleanup(box);
    }
  });

  it('uses an explicit commit and does not ask GitHub for the latest release', () => {
    const box = makeSandbox();
    const sha = 'AB'.repeat(20);
    try {
      const result = invoke(box, ['--dry-run', '--yes', '--ref', sha]);
      const output = textOf(result);
      expect(result.status).toBe(0);
      expect(output).toContain(`source: build ${sha.toLowerCase()}`);
      expect(readFileSync(box.httpLog, 'utf8')).not.toContain('releases/latest');
    } finally {
      cleanup(box);
    }
  });

  it('defers the source choice until python3 exists', () => {
    const box = makeSandbox({ present: PRESENT.replace(' python3', '') });
    try {
      const result = invoke(box, ['diagnose']);
      expect(result.status).toBe(0);
      expect(textOf(result)).toContain('source: deferred');
      expect(existsSync(box.aptLog)).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('dry-runs the existing install.sh and does not switch the display', () => {
    const box = makeSandbox();
    try {
      const result = invoke(box, ['--dry-run', '--yes', '--dist', box.dist]);
      const output = textOf(result);
      expect(result.status).toBe(0);
      expect(output).toContain('Dry run only');
      expect(output).toContain('install-kind: first');
      expect(output).toContain('display-switch: no');
      expect(output).not.toContain('disable --now KlipperScreen');
      expect(output).not.toContain('--ignore-hdmi-pointers');
    } finally {
      cleanup(box);
    }
  });

  it('names an update when repair is asked and a current install already exists', () => {
    const box = makeSandbox();
    mkdirSync(path.join(box.home, 'layr', 'current'), { recursive: true });
    try {
      const skipped = invoke(box, ['--dry-run', '--yes', '--dist', box.dist]);
      expect(skipped.status).toBe(0);
      expect(textOf(skipped)).toContain('install-state: partial');
      expect(textOf(skipped)).toContain('reinstall: no');
      expect(textOf(skipped)).toContain('changed=no');
      expect(textOf(skipped)).not.toContain('install-kind: update');
      expect(existsSync(box.aptLog)).toBe(false);

      const result = invoke(box, ['--repair', '--dry-run', '--yes', '--dist', box.dist]);
      expect(result.status).toBe(0);
      expect(textOf(result)).toContain('action: repair');
      expect(textOf(result)).toContain('install-kind: update');
      expect(textOf(result)).toContain('display-changed=no');
    } finally {
      cleanup(box);
    }
  });

  it('plans apt and stops when apt fails, without calling install', () => {
    const box = makeSandbox({ present: PRESENT.replace(' cage', '') });
    const installLog = path.join(box.root, 'install.log');
    writeExe(path.join(box.root, 'install.sh'), `#!/bin/bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(installLog)}\n`);
    try {
      const result = invoke(box, ['--yes', '--dist', box.dist], { LAYR_APT_RC: '1', LAYR_INSTALL_SH: path.join(box.root, 'install.sh') });
      const output = textOf(result);
      expect(result.status).not.toBe(0);
      expect(output).toContain('package: cage');
      expect(output).toContain('apt-failed=yes');
      expect(output).toContain('display-changed=no');
      expect(existsSync(installLog)).toBe(false);
      expect(readFileSync(box.aptLog, 'utf8')).toContain('update');
    } finally {
      cleanup(box);
    }
  });

  it('passes preview install arguments and does not opt into the HDMI rule', () => {
    const box = makeSandbox();
    const installLog = path.join(box.root, 'install.log');
    writeExe(path.join(box.root, 'install.sh'), `#!/bin/bash\nprintf '%s\\n' "$*" > ${JSON.stringify(installLog)}\n`);
    try {
      const result = invoke(box, ['--dry-run', '--yes', '--dist', box.dist], { LAYR_INSTALL_SH: path.join(box.root, 'install.sh') });
      expect(result.status).toBe(0);
      const args = readFileSync(installLog, 'utf8');
      expect(args).toContain('--dist');
      expect(args).toContain('--yes');
      expect(args).toContain('--dry-run');
      expect(args).not.toContain('--ignore-hdmi-pointers');
    } finally {
      cleanup(box);
    }
  });

  it('plans a display switch in a dry run and performs it only after the page answers', () => {
    const box = makeSandbox();
    const displayLog = path.join(box.root, 'display.log');
    writeExe(path.join(box.root, 'display.sh'), `#!/bin/bash\nprintf '%s\\n' "$*" > ${JSON.stringify(displayLog)}\n`);
    try {
      const planned = invoke(box, ['--dry-run', '--yes', '--switch-display', '--dist', box.dist], {
        LAYR_DISPLAY_SH: path.join(box.root, 'display.sh'),
      });
      expect(planned.status).toBe(0);
      expect(textOf(planned)).toContain('display-switch: planned after the page answers; not performed in a dry run');
      expect(existsSync(displayLog)).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('switches only after install when the page answers, and refuses an empty page', () => {
    const box = makeSandbox();
    const displayLog = path.join(box.root, 'display.log');
    const installLog = path.join(box.root, 'install.log');
    writeExe(path.join(box.root, 'install.sh'), `#!/bin/bash\nprintf '%s\\n' "$*" > ${JSON.stringify(installLog)}\n`);
    writeExe(path.join(box.root, 'display.sh'), `#!/bin/bash\nprintf '%s\\n' "$*" > ${JSON.stringify(displayLog)}\n`);
    try {
      const refused = invoke(box, ['--yes', '--switch-display', '--dist', box.dist], {
        LAYR_INSTALL_SH: path.join(box.root, 'install.sh'),
        LAYR_DISPLAY_SH: path.join(box.root, 'display.sh'),
        LAYR_PAGE_EMPTY: '1',
      });
      expect(refused.status).not.toBe(0);
      expect(textOf(refused)).toContain('KlipperScreen was not stopped');
      expect(existsSync(installLog)).toBe(true);
      expect(existsSync(displayLog)).toBe(false);

      const switched = invoke(box, ['--yes', '--switch-display', '--dist', box.dist], {
        LAYR_INSTALL_SH: path.join(box.root, 'install.sh'),
        LAYR_DISPLAY_SH: path.join(box.root, 'display.sh'),
        LAYR_PAGE_EMPTY: '0',
      });
      expect(switched.status).toBe(0);
      expect(readFileSync(displayLog, 'utf8')).toContain('to-layr --yes');
      expect(textOf(switched)).toContain('display-switch: layr-kiosk');
    } finally {
      cleanup(box);
    }
  });

  it('records a missing input group without rebooting', () => {
    const box = makeSandbox();
    try {
      const result = invoke(box, ['--dry-run', '--yes', '--dist', box.dist], { LAYR_GROUPS: 'render input' });
      const output = textOf(result);
      expect(result.status).toBe(0);
      expect(output).toContain('groups-missing: video');
      expect(output).toContain('usermod -aG');
      expect(output).toContain('does not restart the Pi');
    } finally {
      cleanup(box);
    }
  });
});

const SERVICE_UNITS = 'layr-web.service layr-kiosk.service KlipperScreen.service';

function writeRelease(box: Sandbox, name = '20260101T000000Z') {
  const release = path.join(box.home, 'layr', 'releases', name);
  mkdirSync(release, { recursive: true });
  writeFileSync(path.join(release, 'index.html'), '<!doctype html><title>LAYR</title>\n');
  const current = path.join(box.home, 'layr', 'current');
  rmSync(current, { recursive: true, force: true });
  symlinkSync(release, current);
  return release;
}

function unitEnv(options: { units?: string; active?: string; failed?: string; enabled?: string } = {}) {
  return {
    LAYR_UNITS: options.units ?? SERVICE_UNITS,
    LAYR_ACTIVE_UNITS: options.active ?? 'layr-web.service',
    LAYR_FAILED_UNITS: options.failed ?? '',
    LAYR_ENABLED_UNITS: options.enabled ?? 'KlipperScreen.service',
  };
}

function displayStub(box: Sandbox) {
  const log = path.join(box.root, 'display-switch.log');
  const file = path.join(box.root, 'layr-display-stub.sh');
  writeExe(file, `#!/bin/bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexit "\${LAYR_DISPLAY_RC:-0}"\n`);
  return { file, log };
}

function armRealDisplay(box: Sandbox) {
  const bin = path.join(box.root, 'bin');
  writeExe(path.join(bin, 'sudo'), '#!/bin/bash\nexec "$@"\n');
  writeExe(path.join(bin, 'curl'), '#!/bin/bash\nif [ "${LAYR_CURL_FAIL:-0}" = 1 ]; then exit 1; fi\nexit 0\n');
  writeExe(path.join(bin, 'cage'), '#!/bin/bash\nexit 0\n');
  writeExe(path.join(bin, 'chromium'), '#!/bin/bash\nexit 0\n');
}

describe('display switcher', () => {
  it('installs on the first run and does not open the switch menu', () => {
    const box = makeSandbox();
    try {
      const result = invoke(box, ['--dry-run', '--yes', '--dist', box.dist]);
      const output = textOf(result);
      expect(result.status).toBe(0);
      expect(output).toContain('install-state: not-installed');
      expect(output).toContain('install-kind: first');
      expect(output).toContain('Dry run only');
      expect(output).not.toContain('Same installer, already on this Pi');
      expect(output).not.toContain('automatic-toggle: refused');
    } finally {
      cleanup(box);
    }
  });

  it('re-runs as a menu on KlipperScreen and on LAYR without downloading', () => {
    const box = makeSandbox();
    const release = writeRelease(box);
    const before = readFileSync(path.join(release, 'index.html'), 'utf8');
    try {
      const ks = invoke(box, [], unitEnv({ active: 'layr-web.service KlipperScreen.service' }));
      const ksOut = textOf(ks);
      expect(ks.status).toBe(0);
      expect(ksOut).toContain('install-state: installed');
      expect(ksOut).toContain('active-display: klipperscreen');
      expect(ksOut).toContain('1) Switch to LAYR');
      expect(ksOut).toContain('2) Switch to KlipperScreen');
      expect(ksOut).toContain('3) Update');
      expect(ksOut).toContain('4) Repair');
      expect(ksOut).toContain('5) Diagnostics');
      expect(ksOut).toContain('6) Exit');
      expect(ksOut).toContain('menu: skipped');
      expect(ksOut).toContain('reinstall: no');
      expect(ksOut).toContain('changed=no');
      expect(ksOut).toContain('offline-fallback-needs-download: no');
      expect(ksOut).not.toContain('raw.githubusercontent.com');
      expect(ksOut).not.toContain('Dry run only');
      expect(existsSync(box.aptLog)).toBe(false);
      expect(existsSync(box.httpLog)).toBe(false);
      expect(readFileSync(box.systemctlLog, 'utf8')).not.toContain('disable');
      expect(readFileSync(path.join(release, 'index.html'), 'utf8')).toBe(before);

      const layr = invoke(box, [], { ...unitEnv({ active: 'layr-web.service layr-kiosk.service' }), LAYR_MENU_CHOICE: 'exit' });
      expect(layr.status).toBe(0);
      expect(textOf(layr)).toContain('active-display: layr');
      expect(textOf(layr)).toContain('menu: exit');
      expect(textOf(layr)).toContain('changed=no');
      expect(existsSync(box.aptLog)).toBe(false);
      expect(existsSync(box.httpLog)).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('switches through layr-display.sh and leaves an already active display alone', () => {
    const box = makeSandbox();
    writeRelease(box);
    const stub = displayStub(box);
    try {
      const toLayr = invoke(box, ['--switch-display'], {
        ...unitEnv({ active: 'layr-web.service KlipperScreen.service' }),
        LAYR_DISPLAY_SH: stub.file,
      });
      expect(toLayr.status).toBe(0);
      expect(readFileSync(stub.log, 'utf8')).toContain('to-layr --yes');
      expect(textOf(toLayr)).toContain('reinstall: no');
      expect(textOf(toLayr)).toContain('display-changed=yes');
      expect(existsSync(box.aptLog)).toBe(false);
      expect(existsSync(box.httpLog)).toBe(false);

      rmSync(stub.log);
      const already = invoke(box, ['--switch-display'], {
        ...unitEnv({ active: 'layr-web.service layr-kiosk.service' }),
        LAYR_DISPLAY_SH: stub.file,
      });
      expect(already.status).toBe(0);
      expect(textOf(already)).toContain('already-active: layr');
      expect(textOf(already)).toContain('display-changed=no');
      expect(existsSync(stub.log)).toBe(false);

      const back = invoke(box, ['--switch-klipperscreen'], {
        ...unitEnv({ active: 'layr-web.service layr-kiosk.service' }),
        LAYR_DISPLAY_SH: stub.file,
      });
      expect(back.status).toBe(0);
      expect(readFileSync(stub.log, 'utf8')).toContain('to-klipperscreen --yes');
      expect(textOf(back)).toContain('display-switch: klipperscreen');
      expect(existsSync(box.httpLog)).toBe(false);

      rmSync(stub.log);
      const stayed = invoke(box, [], {
        ...unitEnv({ active: 'layr-web.service KlipperScreen.service' }),
        LAYR_DISPLAY_SH: stub.file,
        LAYR_MENU_CHOICE: 'switch-klipperscreen',
      });
      expect(stayed.status).toBe(0);
      expect(textOf(stayed)).toContain('already-active: klipperscreen');
      expect(existsSync(stub.log)).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('refuses an automatic toggle when both, neither, or systemd is unreadable', () => {
    const box = makeSandbox();
    writeRelease(box);
    const stub = displayStub(box);
    try {
      const both = invoke(box, [], {
        ...unitEnv({ active: SERVICE_UNITS }),
        LAYR_DISPLAY_SH: stub.file,
      });
      expect(both.status).toBe(0);
      expect(textOf(both)).toContain('active-display: both');
      expect(textOf(both)).toContain('automatic-toggle: refused');
      expect(textOf(both)).toContain('changed=no');
      expect(existsSync(stub.log)).toBe(false);
      expect(readFileSync(box.systemctlLog, 'utf8')).not.toContain('disable');

      const picked = invoke(box, [], {
        ...unitEnv({ active: SERVICE_UNITS }),
        LAYR_DISPLAY_SH: stub.file,
        LAYR_MENU_CHOICE: 'switch-klipperscreen',
      });
      expect(picked.status).toBe(0);
      expect(textOf(picked)).toContain('display-conflict: both');
      expect(textOf(picked)).toContain('explicit-switch: klipperscreen');
      expect(readFileSync(stub.log, 'utf8')).toContain('to-klipperscreen --yes');

      rmSync(stub.log);
      const neither = invoke(box, [], {
        ...unitEnv({ active: 'layr-web.service' }),
        LAYR_DISPLAY_SH: stub.file,
      });
      expect(neither.status).toBe(0);
      expect(textOf(neither)).toContain('active-display: neither');
      expect(textOf(neither)).toContain('automatic-toggle: refused');
      expect(existsSync(stub.log)).toBe(false);

      const uncertain = invoke(box, [], {
        ...unitEnv(),
        LAYR_DISPLAY_SH: stub.file,
        LAYR_SYSTEMCTL_BIN: 'missing',
        LAYR_MENU_CHOICE: 'switch-layr',
      });
      expect(uncertain.status).not.toBe(0);
      expect(textOf(uncertain)).toContain('install-state: uncertain');
      expect(textOf(uncertain)).toContain('active-display: uncertain');
      expect(textOf(uncertain)).toContain('switch-refused: uncertain');
      expect(textOf(uncertain)).toContain('changed=no');
      expect(existsSync(stub.log)).toBe(false);
      expect(existsSync(box.aptLog)).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('reports a partial install and does not finish it unless repair is chosen', () => {
    const box = makeSandbox();
    const stub = displayStub(box);
    try {
      mkdirSync(path.join(box.home, 'layr', 'current'), { recursive: true });
      const empty = invoke(box, [], { LAYR_DISPLAY_SH: stub.file });
      expect(empty.status).toBe(0);
      expect(textOf(empty)).toContain('install-state: partial');
      expect(textOf(empty)).toContain('release: broken');
      expect(textOf(empty)).toContain('changed=no');
      expect(existsSync(box.aptLog)).toBe(false);
      expect(existsSync(stub.log)).toBe(false);

      rmSync(path.join(box.home, 'layr', 'current'), { recursive: true, force: true });
      const unitsOnly = invoke(box, [], {
        ...unitEnv({ units: 'layr-web.service layr-kiosk.service', active: '' }),
        LAYR_DISPLAY_SH: stub.file,
      });
      expect(unitsOnly.status).toBe(0);
      expect(textOf(unitsOnly)).toContain('install-state: partial');
      expect(textOf(unitsOnly)).toContain('release: absent');
      expect(existsSync(box.aptLog)).toBe(false);

      writeRelease(box);
      const webOnly = invoke(box, [], {
        ...unitEnv({ units: 'layr-web.service', active: 'layr-web.service' }),
        LAYR_DISPLAY_SH: stub.file,
      });
      expect(textOf(webOnly)).toContain('install-state: partial');
      expect(textOf(webOnly)).toContain('layr-kiosk: missing');
      expect(existsSync(stub.log)).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('refuses to switch to KlipperScreen when that unit is absent', () => {
    const box = makeSandbox();
    writeRelease(box);
    const stub = displayStub(box);
    try {
      const result = invoke(box, ['--switch-klipperscreen'], {
        ...unitEnv({
          units: 'layr-web.service layr-kiosk.service',
          active: 'layr-web.service layr-kiosk.service',
        }),
        LAYR_DISPLAY_SH: stub.file,
        LAYR_HTTP_MODE: 'fail',
      });
      const output = textOf(result);
      expect(result.status).not.toBe(0);
      expect(output).toContain('klipperscreen: absent');
      expect(output).toContain('switch-refused: klipperscreen-absent');
      expect(output).toContain('was not installed or removed');
      expect(output).toContain('display-changed=no');
      expect(existsSync(stub.log)).toBe(false);
      expect(readFileSync(box.systemctlLog, 'utf8')).not.toContain('disable');
      expect(existsSync(box.aptLog)).toBe(false);
      expect(existsSync(box.httpLog)).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('switches back to KlipperScreen when LAYR is broken or the page is down, without a network', () => {
    const box = makeSandbox();
    writeRelease(box);
    armRealDisplay(box);
    const conf = box.env.LAYR_MOONRAKER_CONF as string;
    const before = statSync(conf).mtimeMs;
    try {
      const frontend = invoke(box, ['--switch-klipperscreen'], {
        ...unitEnv({ active: 'layr-kiosk.service', enabled: 'layr-kiosk.service' }),
        LAYR_HTTP_MODE: 'fail',
        LAYR_CURL_FAIL: '1',
        LAYR_DISK_FREE_MB: '10',
      });
      const frontendLog = readFileSync(box.systemctlLog, 'utf8');
      expect(frontend.status, textOf(frontend)).toBe(0);
      expect(textOf(frontend)).toContain('install-state: broken');
      expect(textOf(frontend)).toContain('active-display: layr');
      expect(textOf(frontend)).toContain('display-changed=yes');
      expect(textOf(frontend)).toContain('offline-fallback-needs-download: no');
      expect(frontendLog).toContain('disable --now layr-kiosk.service');
      expect(frontendLog).toContain('enable --now KlipperScreen.service');
      expect(existsSync(box.aptLog)).toBe(false);
      expect(existsSync(box.httpLog)).toBe(false);
      expect(statSync(conf).mtimeMs).toBe(before);

      rmSync(box.systemctlLog, { force: true });
      const failed = invoke(box, [], {
        ...unitEnv({ active: 'layr-web.service', failed: 'layr-kiosk.service' }),
        LAYR_HTTP_MODE: 'fail',
        LAYR_MENU_CHOICE: 'switch-klipperscreen',
      });
      expect(failed.status, textOf(failed)).toBe(0);
      expect(textOf(failed)).toContain('install-state: broken');
      expect(textOf(failed)).toContain('layr-kiosk: failed');
      expect(textOf(failed)).toContain('active-display: neither');
      expect(textOf(failed)).toContain('explicit-switch: klipperscreen');
      expect(readFileSync(box.systemctlLog, 'utf8')).toContain('enable --now KlipperScreen.service');
      expect(existsSync(box.httpLog)).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('does not stop KlipperScreen when the kiosk cannot start, and restores it when the kiosk dies', () => {
    const box = makeSandbox();
    writeRelease(box);
    armRealDisplay(box);
    try {
      const refused = invoke(box, ['--switch-display'], {
        ...unitEnv({ active: 'layr-web.service KlipperScreen.service', enabled: 'KlipperScreen.service' }),
        LAYR_CURL_FAIL: '1',
      });
      expect(refused.status).not.toBe(0);
      expect(textOf(refused)).toContain('display-changed=no');
      expect(textOf(refused)).toContain('KlipperScreen was not stopped');
      expect(readFileSync(box.systemctlLog, 'utf8')).not.toContain('disable');
      expect(existsSync(box.aptLog)).toBe(false);

      rmSync(box.systemctlLog, { force: true });
      const restored = invoke(box, ['--switch-display'], {
        ...unitEnv({ active: 'layr-web.service KlipperScreen.service', enabled: 'KlipperScreen.service' }),
        LAYR_KIOSK_WAIT_SECS: '1',
        LAYR_KIOSK_WAIT_INTERVAL: '0',
      });
      const log = readFileSync(box.systemctlLog, 'utf8');
      expect(restored.status).not.toBe(0);
      expect(textOf(restored)).toContain('display-changed=no');
      expect(log).toContain('disable --now KlipperScreen.service');
      expect(log).toContain('enable --now layr-kiosk.service');
      expect(log).toContain('disable --now layr-kiosk.service');
      expect(log).toContain('enable --now KlipperScreen.service');
      expect(existsSync(box.aptLog)).toBe(false);
      expect(existsSync(box.httpLog)).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('updates or repairs only when asked, and leaves the display alone', () => {
    const box = makeSandbox();
    writeRelease(box);
    const stub = displayStub(box);
    try {
      const updated = invoke(box, ['--update', '--dry-run', '--yes', '--dist', box.dist], {
        ...unitEnv({ active: 'layr-web.service KlipperScreen.service' }),
        LAYR_DISPLAY_SH: stub.file,
      });
      expect(updated.status, textOf(updated)).toBe(0);
      expect(textOf(updated)).toContain('action: update');
      expect(textOf(updated)).toContain('Dry run only');
      expect(textOf(updated)).toContain('display-changed=no');
      expect(textOf(updated)).toContain('The current display was left as it is.');
      expect(existsSync(stub.log)).toBe(false);
      expect(existsSync(box.aptLog)).toBe(false);
      expect(readFileSync(box.httpLog, 'utf8')).not.toContain('releases/latest');
      expect(readFileSync(box.httpLog, 'utf8')).not.toContain('nodejs.org');
    } finally {
      cleanup(box);
    }
  });

  it('runs diagnostics and an offline status report without installing', () => {
    const box = makeSandbox();
    writeRelease(box);
    const conf = box.env.LAYR_MOONRAKER_CONF as string;
    const before = statSync(conf).mtimeMs;
    try {
      const diagnostics = invoke(box, [], {
        ...unitEnv({ active: 'layr-web.service KlipperScreen.service' }),
        LAYR_MENU_CHOICE: 'diagnostics',
        LAYR_HTTP_MODE: 'fail',
      });
      const output = textOf(diagnostics);
      expect(diagnostics.status).toBe(0);
      expect(output).toContain('action: diagnostics');
      expect(output).toContain('changed=no');
      expect(output).toContain('reinstall: no');
      expect(output).toContain('moonraker: reachable: no');
      expect(output).toContain('offline-fallback-needs-download: no');
      expect(existsSync(box.aptLog)).toBe(false);
      expect(readFileSync(box.httpLog, 'utf8')).not.toContain('github.com');
      expect(statSync(conf).mtimeMs).toBe(before);

      const offline = invoke(box, ['diagnose'], {
        ...unitEnv({ active: 'layr-web.service layr-kiosk.service' }),
        LAYR_HTTP_MODE: 'fail',
      });
      expect(offline.status).toBe(0);
      expect(textOf(offline)).toContain('install-state: installed');
      expect(textOf(offline)).toContain('source: unavailable');
      expect(textOf(offline)).toContain('changed=no');
      expect(existsSync(box.aptLog)).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('refuses a switch when layr-display.sh is not on disk', () => {
    const box = makeSandbox();
    writeRelease(box);
    const copy = path.join(box.root, 'layr-installer.sh');
    writeFileSync(copy, readFileSync(bootstrap, 'utf8'));
    chmodSync(copy, 0o755);
    try {
      const result = run(`bash ${JSON.stringify(copy)} --switch-klipperscreen`, {
        ...box.env,
        ...unitEnv({ active: 'layr-web.service layr-kiosk.service' }),
        LAYR_HTTP_MODE: 'fail',
      });
      const output = textOf(result);
      expect(result.status).not.toBe(0);
      expect(output).toContain('switch-refused: layr-display.sh missing');
      expect(output).toContain('changed=no');
      expect(output).toContain('offline-fallback-needs-download: no');
      expect(readFileSync(box.systemctlLog, 'utf8')).not.toContain('disable');
      expect(existsSync(box.aptLog)).toBe(false);
      expect(existsSync(box.httpLog)).toBe(false);
    } finally {
      cleanup(box);
    }
  });

  it('does not start or stop units from the bootstrap script itself', () => {
    const source = readFileSync(bootstrap, 'utf8');
    expect(source).not.toMatch(/systemctl\s+(disable|enable|restart|stop|start)\b/);
    expect(source).toContain('layr-display.sh');
    expect(source).toContain('offline-fallback-needs-download: no');
  });
});

describe('bootstrap safety helpers', () => {
  it('refuses a truncated script before creating a home directory', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-truncated-'));
    const home = path.join(root, 'home');
    mkdirSync(home);
    try {
      for (const name of ['layr-installer.sh', 'install.sh', 'layr-display.sh', 'rollback.sh']) {
        const dir = path.join(root, name.replace('.sh', ''));
        mkdirSync(dir);
        const source = readFileSync(path.join(repo, 'deploy', name), 'utf8').replace(/\n# LAYR_SCRIPT_END\n?$/, '\n');
        writeFileSync(path.join(dir, name), source);
        if (name !== 'layr-installer.sh') writeFileSync(path.join(dir, 'lib.sh'), readFileSync(path.join(repo, 'deploy/lib.sh'), 'utf8'));
        const result = run(`bash ${JSON.stringify(path.join(dir, name))} --help`, { HOME: home, PATH: process.env.PATH });
        expect(result.status, name).not.toBe(0);
        expect(textOf(result)).toContain('incomplete');
      }
      expect(existsSync(path.join(home, 'layr'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('allowlists downloads, pins Node, and rejects a bad checksum', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-allow-'));
    const bin = path.join(root, 'bin');
    const canary = path.join(root, 'curl.log');
    writeExe(path.join(bin, 'curl'), `#!/bin/bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(canary)}\nexit 1\n`);
    const command = [
      'set -euo pipefail',
      'LAYR_BOOTSTRAP_SOURCE_ONLY=1',
      `. ${JSON.stringify(bootstrap)}`,
      'url_allowed "http://evil.example/layr" && exit 1',
      'url_allowed "https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-arm64.tar.gz"',
      'spec=$(node_spec aarch64)',
      'printf "%s\\n" "$spec" | grep -q f7a1e486dbc8b286847815b477d4fb5e9fb963ed4489c3e1588853d685f589f9',
      'printf "%s\\n" "$(resolve_ref ABABABABABABABABABABABABABABABABABABABAB)" | grep -qx abababababababababababababababababababab',
      'printf x > "$PWD/blob"',
      'if verify_sha256 "$PWD/blob" 0000000000000000000000000000000000000000000000000000000000000000; then exit 1; fi',
      'MOONRAKER=http://192.168.1.50:7125',
      'if http_get "http://evil.example/file" "$PWD/out" 1000; then exit 1; fi',
    ].join('\n');
    try {
      const allowed = run(command, { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: root }, root);
      expect(allowed.status, textOf(allowed)).not.toBe(0);
      expect(textOf(allowed)).toContain('Refusing download URL');
      expect(existsSync(canary)).toBe(false);

      const loopback = run(
        [
          'LAYR_BOOTSTRAP_SOURCE_ONLY=1',
          `. ${JSON.stringify(bootstrap)}`,
          'set +e',
          'http_get "http://127.0.0.1:9/layr" "$PWD/page" 1000',
          'exit 0',
        ].join('\n'),
        { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: root },
        root,
      );
      expect(loopback.status).toBe(0);
      expect(textOf(loopback)).not.toContain('Refusing download URL');
      expect(readFileSync(canary, 'utf8')).toContain('127.0.0.1:9');

      rmSync(canary);
      const remote = run(
        [
          'LAYR_BOOTSTRAP_SOURCE_ONLY=1',
          `. ${JSON.stringify(bootstrap)}`,
          'set +e',
          'MOONRAKER=http://192.168.1.50:7125',
          'http_get "http://192.168.1.50:7125/server/info" "$PWD/info" 1000',
          'http_get "http://192.168.1.50:7125/printer/gcode/script" "$PWD/bad" 1000',
          'exit 0',
        ].join('\n'),
        { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: root },
        root,
      );
      expect(textOf(remote)).toContain('Refusing download URL');
      expect(readFileSync(canary, 'utf8')).toContain('/server/info');
      expect(readFileSync(canary, 'utf8')).not.toContain('gcode/script');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not install controllers, force HDMI, reboot, or select the WebKit port', () => {
    const files = ['layr-installer.sh', 'install.sh', 'layr-display.sh', 'rollback.sh', 'uninstall.sh', 'lib.sh'].map((name) =>
      readFileSync(path.join(repo, 'deploy', name), 'utf8'),
    );
    const combined = files.join('\n');
    expect(combined).not.toMatch(/hdmi_mode|hdmi_group|hdmi_force/);
    expect(combined).not.toMatch(/\b(reboot|shutdown|poweroff)\b/);
    expect(combined).not.toMatch(/wpewebkit|\blayr-engine\.sh use wpe\b/);
    expect(combined).not.toMatch(/printer\/gcode\/script|printer\.gcode\.script/);
    expect(combined).not.toMatch(/>>?\s*\S*printer\.cfg/);
    expect(combined).toContain('did not install');
    expect(combined).toContain('Happy Hare');
    expect(readFileSync(bootstrap, 'utf8')).toContain('mutually exclusive');
  });
});

describe('display switch guards', () => {
  function displayEnv(root: string, options: { units: string; active: string; enabled: string; curlFail?: boolean; withCage?: boolean; withCurl?: boolean; withChromium?: boolean; startFail?: boolean }) {
    const bin = path.join(root, 'bin');
    const log = path.join(root, 'systemctl.log');
    mkdirSync(bin, { recursive: true });
    // Missing dependencies must stay missing on a Pi that has Cage/Chromium installed.
    // Allow only the shell utilities needed by layr-display.sh and lib.sh; application
    // dependencies and service operations below are always explicit fixtures.
    for (const name of ['bash', 'awk', 'cat', 'date', 'dirname', 'grep', 'mkdir', 'rm', 'sed', 'sleep', 'tail']) {
      const tool = execFileSync('bash', ['-c', 'command -v "$1"', 'bash', name], { encoding: 'utf8' }).trim();
      symlinkSync(tool, path.join(bin, name));
    }
    writeExe(path.join(bin, 'id'), '#!/bin/sh\n[ "$1" = "-u" ] || exit 1\nprintf "1000\\n"\n');
    writeExe(
      path.join(bin, 'systemctl'),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$LAYR_SYSTEMCTL_LOG"
verb=$1
shift
case "$verb" in
  list-unit-files)
    unit=
    for arg in "$@"; do unit=$arg; done
    case " $LAYR_UNITS " in
      *" $unit "*) printf '%s\\n' "$unit"; exit 0 ;;
    esac
    exit 1
    ;;
  is-active)
    [ "$1" = "--quiet" ] && shift
    unit=$1
    case " $LAYR_ACTIVE_UNITS " in
      *" $unit "*) exit 0 ;;
    esac
    exit 3
    ;;
  is-enabled)
    [ "$1" = "--quiet" ] && shift
    unit=$1
    case " $LAYR_ENABLED_UNITS " in
      *" $unit "*) exit 0 ;;
    esac
    exit 1
    ;;
  enable)
    if [ "$LAYR_KIOSK_START_FAIL" = 1 ] && [ "$*" = "--now layr-kiosk.service" ]; then exit 1; fi
    ;;
esac
exit 0
`,
    );
    writeExe(path.join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n');
    if (options.withCurl !== false) writeExe(path.join(bin, 'curl'), `#!/bin/sh\nexit ${options.curlFail ? 1 : 0}\n`);
    if (options.withChromium !== false) writeExe(path.join(bin, 'chromium'), '#!/bin/sh\nexit 0\n');
    if (options.withCage !== false) writeExe(path.join(bin, 'cage'), '#!/bin/sh\nexit 0\n');
    const home = path.join(root, 'home');
    mkdirSync(home, { recursive: true });
    return {
      log,
      env: {
        HOME: home,
        LAYR_HOME: path.join(home, 'layr'),
        PATH: bin,
        LAYR_SYSTEMCTL_LOG: log,
        LAYR_UNITS: options.units,
        LAYR_ACTIVE_UNITS: options.active,
        LAYR_ENABLED_UNITS: options.enabled,
        LAYR_KIOSK_START_FAIL: options.startFail ? '1' : '0',
        LAYR_KIOSK_WAIT_SECS: '1',
        LAYR_KIOSK_WAIT_INTERVAL: '0',
      },
    };
  }

  it('does not stop KlipperScreen when cage, the page, or the web service is missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-display-guard-'));
    try {
      const installed = 'layr-kiosk.service layr-web.service KlipperScreen.service';
      const cases = [
        { name: 'cage', options: { withCage: false }, message: 'cage is not installed' },
        { name: 'web-inactive', options: { active: 'KlipperScreen.service' }, message: 'not running' },
        { name: 'page', options: { curlFail: true }, message: 'did not answer' },
        { name: 'web-missing', options: { units: 'layr-kiosk.service KlipperScreen.service' }, message: 'layr-web.service is not installed' },
        { name: 'kiosk-missing', options: { units: 'layr-web.service KlipperScreen.service' }, message: 'layr-kiosk.service is not installed' },
        { name: 'chromium', options: { withChromium: false }, message: 'Chromium is not installed' },
        { name: 'curl', options: { withCurl: false }, message: 'curl is not installed' },
      ];
      for (const scenario of cases) {
        const fx = displayEnv(path.join(root, scenario.name), {
          units: installed,
          active: 'layr-web.service KlipperScreen.service',
          enabled: 'KlipperScreen.service',
          ...scenario.options,
        });
        const result = run('bash deploy/layr-display.sh to-layr --yes', fx.env);
        expect(result.status, scenario.name).not.toBe(0);
        expect(textOf(result), scenario.name).toContain(scenario.message);
        const log = readFileSync(fx.log, 'utf8');
        // All failures must occur before any service mutation, not just before disable.
        expect(log, scenario.name).not.toMatch(/^(enable|disable|start|stop|restart) /m);
        expect(existsSync(path.join(fx.env.LAYR_HOME!, 'state', 'klipperscreen-disabled-by-layr')), scenario.name).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('turns KlipperScreen back on when the kiosk fails to start or does not stay up', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-display-restore-'));
    try {
      for (const startFail of [false, true]) {
        const fx = displayEnv(path.join(root, String(startFail)), {
          units: 'layr-kiosk.service layr-web.service KlipperScreen.service',
          active: 'layr-web.service KlipperScreen.service',
          enabled: 'KlipperScreen.service',
          startFail,
        });
        const result = run('bash deploy/layr-display.sh to-layr --yes', fx.env);
        const log = readFileSync(fx.log, 'utf8');
        expect(result.status, textOf(result)).not.toBe(0);
        expect(log.split('\n').filter(line => /^(enable|disable) /.test(line))).toEqual([
          'disable --now KlipperScreen.service',
          'enable --now layr-kiosk.service',
          'disable --now layr-kiosk.service',
          'enable --now KlipperScreen.service',
        ]);
        expect(textOf(result)).toContain('turned back on');
        expect(textOf(result)).toContain(startFail ? 'layr-kiosk.service did not start' : 'The LAYR kiosk did not stay active');
        expect(existsSync(path.join(fx.env.LAYR_HOME!, 'state', 'klipperscreen-disabled-by-layr'))).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves KlipperScreen stopped when the kiosk stays active', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-display-ok-'));
    const fx = displayEnv(root, {
      units: 'layr-kiosk.service layr-web.service KlipperScreen.service',
      active: 'layr-web.service layr-kiosk.service',
      enabled: 'KlipperScreen.service',
    });
    try {
      const result = run('bash deploy/layr-display.sh to-layr --yes', fx.env);
      const log = readFileSync(fx.log, 'utf8');
      expect(result.status, textOf(result)).toBe(0);
      expect(log).toContain('enable --now layr-kiosk.service');
      expect(log).not.toContain('enable --now KlipperScreen.service');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
