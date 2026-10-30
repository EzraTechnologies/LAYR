import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command: string, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  return execFileSync('bash', ['-c', command], {
    cwd: options.cwd ?? repo,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    // Keep child stderr on the error object instead of echoing expected fallback text.
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function runAllowFail(command: string, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): { status: number; stdout: string; stderr: string } {
  try {
    return { status: 0, stdout: run(command, options), stderr: '' };
  } catch (error) {
    const err = error as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      status: err.status ?? 1,
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? ''),
    };
  }
}

describe('install.sh --dist', () => {
  it('accepts a caller-relative path and an absolute path', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-install-'));
    const dist = path.join(root, 'dist');
    const home = path.join(root, 'home');
    mkdirSync(dist);
    mkdirSync(home);
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>LAYR</title>');
    const env = { HOME: home };
    try {
      const relative = run(`bash ${JSON.stringify(path.join(repo, 'deploy/install.sh'))} --dist ./dist --dry-run --yes`, {
        cwd: root,
        env,
      });
      expect(relative).toContain(dist);
      expect(relative).not.toContain(path.join(repo, 'deploy/dist'));

      const absolute = run(`bash ${JSON.stringify(path.join(repo, 'deploy/install.sh'))} --dist ${JSON.stringify(dist)} --dry-run --yes`, {
        cwd: '/tmp',
        env,
      });
      expect(absolute).toContain(`cp -a ${dist} `);
      expect(absolute).toContain('layr-kiosk.sh');
      expect(absolute).toContain('kiosk-lib.sh');
      expect(absolute).toContain('layr-hdmi-input.sh');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('defaults to the dist directory next to deploy/', () => {
    const dist = path.join(repo, 'dist');
    const created = !existsSync(dist);
    if (created) mkdirSync(dist);
    const index = path.join(dist, 'index.html');
    const wroteIndex = created || !existsSync(index);
    if (wroteIndex) writeFileSync(index, '<!doctype html>');
    const home = mkdtempSync(path.join(tmpdir(), 'layr-home-'));
    try {
      const output = run(`bash ${JSON.stringify(path.join(repo, 'deploy/install.sh'))} --dry-run --yes`, {
        cwd: '/tmp',
        env: { HOME: home },
      });
      expect(output).toContain(path.resolve(dist));
    } finally {
      if (wroteIndex && created) rmSync(dist, { recursive: true, force: true });
      else if (wroteIndex) rmSync(index);
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('layr.env upgrades', () => {
  it('refreshes port and Moonraker URL without dropping the engine or cursor override', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-env-'));
    const envFile = path.join(root, 'layr.env');
    writeFileSync(envFile, 'LAYR_PORT=1\nLAYR_MOONRAKER_URL=http://old\nLAYR_KIOSK_ENGINE=wpe\nLAYR_HIDE_CURSOR=1\n');
    const output = run(
      `. deploy/lib.sh && write_layr_env ${JSON.stringify(envFile)} 7180 http://localhost:7125 && cat ${JSON.stringify(envFile)}`,
    );
    expect(output).toContain('LAYR_PORT=7180');
    expect(output).toContain('LAYR_MOONRAKER_URL=http://localhost:7125');
    expect(output).toContain('LAYR_KIOSK_ENGINE=wpe');
    expect(output).toContain('LAYR_HIDE_CURSOR=1');
    expect(output).not.toContain('LAYR_PORT=1');
    rmSync(root, { recursive: true, force: true });
  });
});

// wpe_report follows PATH for cog, cage, and dpkg, and LAYR_COG_MODULE_DIRS for the
// Wayland plugin. A Pi with those packages installed is a valid host, so the engine
// tests replace discovery with fixtures instead of reading the machine.
type CogPlatform = 'wl' | 'fdo' | 'drm' | 'none';

type KioskEngineFixture = {
  root: string;
  bin: string;
  modules: string;
  env: NodeJS.ProcessEnv;
};

type EngineConfig = {
  HOME: string;
  LAYR_HOME: string;
  LAYR_ENV: string;
  LAYR_STATE: string;
};

// dirname is how layr-engine.sh finds kiosk-lib.sh. The other names are the external
// commands that script and wpe_report call. cog, cage, and dpkg stay under test control.
const kioskHostTools = ['bash', 'cat', 'chmod', 'dirname', 'grep', 'head', 'mkdir', 'mktemp', 'mv', 'tail', 'tr'] as const;
const hostToolCache = new Map<string, string>();

function hostTool(name: string): string {
  const cached = hostToolCache.get(name);
  if (cached) return cached;
  const found = execFileSync('bash', ['-c', 'command -v "$1"', 'bash', name], { encoding: 'utf8' }).trim();
  if (!found) throw new Error(`required host tool is missing: ${name}`);
  hostToolCache.set(name, found);
  return found;
}

function writeExecutable(file: string, body: string) {
  writeFileSync(file, body.endsWith('\n') ? body : `${body}\n`);
  chmodSync(file, 0o755);
}

function dpkgQueryStub(webkit: boolean): string {
  const found = webkit
    ? `
if [ "$pkg" = "libwpewebkit-1.1-0" ]; then
  printf '%s\\n' 'libwpewebkit-1.1-0 0.0.0-layr-fixture'
  exit 0
fi`
    : '';
  return `#!/bin/sh
prev=""
pkg=""
for arg in "$@"; do
  if [ "$prev" = "-f" ]; then
    prev=""
    continue
  fi
  case "$arg" in
    -f) prev="-f" ;;
    -*) ;;
    *) pkg=$arg ;;
  esac
done
${found}
exit 1
`;
}

function kioskEngineFixture(
  options: { cog?: boolean; cage?: boolean; webkit?: boolean; platform?: CogPlatform } = {},
): KioskEngineFixture {
  const cog = options.cog === true;
  const cage = options.cage === true;
  const webkit = options.webkit === true;
  const platform = options.platform ?? 'none';
  const root = mkdtempSync(path.join(tmpdir(), 'layr-wpe-'));
  const bin = path.join(root, 'bin');
  const modules = path.join(root, 'modules');
  mkdirSync(bin);
  mkdirSync(modules);
  for (const name of kioskHostTools) symlinkSync(hostTool(name), path.join(bin, name));
  if (cog) {
    writeExecutable(
      path.join(bin, 'cog'),
      `#!/bin/sh
if [ "\${1:-}" = "--version" ]; then
  printf '%s\\n' 'cog 0.16.1-layr-fixture'
fi
exit 0
`,
    );
  }
  if (cage) writeExecutable(path.join(bin, 'cage'), '#!/bin/sh\nexit 0\n');
  writeExecutable(path.join(bin, 'dpkg'), '#!/bin/sh\nexit 0\n');
  writeExecutable(path.join(bin, 'dpkg-query'), dpkgQueryStub(webkit));
  if (platform !== 'none') writeFileSync(path.join(modules, `libcogplatform-${platform}.so`), '');
  return {
    root,
    bin,
    modules,
    env: {
      PATH: bin,
      LAYR_COG_MODULE_DIRS: modules,
    },
  };
}

function engineConfig(root: string): EngineConfig {
  const home = path.join(root, 'home');
  const layr = path.join(home, 'layr');
  mkdirSync(layr, { recursive: true });
  const layrEnv = path.join(layr, 'layr.env');
  writeFileSync(layrEnv, 'LAYR_PORT=7180\nLAYR_MOONRAKER_URL=http://localhost:7125\nLAYR_HIDE_CURSOR=1\n');
  return {
    HOME: home,
    LAYR_HOME: layr,
    LAYR_ENV: layrEnv,
    LAYR_STATE: path.join(layr, 'state'),
  };
}

function launchEngine(fx: KioskEngineFixture, requested?: string): { engine: string; stderr: string } {
  const errFile = path.join(fx.root, 'launch.err');
  const assignment = requested === undefined ? 'unset LAYR_KIOSK_ENGINE' : `export LAYR_KIOSK_ENGINE=${JSON.stringify(requested)}`;
  const engine = run(
    `
      set -euo pipefail
      . deploy/kiosk-lib.sh
      ${assignment}
      resolve_launch_engine 2>${JSON.stringify(errFile)}
    `,
    { env: fx.env },
  ).trim();
  return { engine, stderr: existsSync(errFile) ? readFileSync(errFile, 'utf8') : '' };
}

describe('kiosk engine selection', () => {
  it('selects chromium by default, finds a Wayland Cog plugin, and falls back when mocked WPE is missing', () => {
    const fx = kioskEngineFixture({ platform: 'drm' });
    const script = `
      set -euo pipefail
      . deploy/kiosk-lib.sh
      normalize_engine ''
      normalize_engine WPE
      if normalize_engine nope >/dev/null; then echo 'accepted-bad'; exit 1; fi
      if find_cog_wayland_platform >/dev/null; then echo 'drm-was-accepted'; exit 1; fi
      printf '' > ${JSON.stringify(path.join(fx.modules, 'libcogplatform-wl.so'))}
      find_cog_wayland_platform
      export LAYR_KIOSK_ENGINE=wpe
      resolve_launch_engine
      export LAYR_KIOSK_ENGINE=chromium
      resolve_launch_engine
    `;
    try {
      const output = run(script, { env: fx.env }).trim().split('\n');
      expect(output).toEqual(['chromium', 'wpe', 'wl', 'chromium', 'chromium']);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it('saves a Chromium rollback and refuses to save WPE when mocked Cog is not usable', () => {
    const fx = kioskEngineFixture();
    const cfg = engineConfig(fx.root);
    const env = { ...fx.env, ...cfg };
    try {
      const refused = runAllowFail('bash deploy/layr-engine.sh use wpe --yes', { env });
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toContain('WPE is not usable');
      expect(refused.stdout).toContain('cog: not installed');
      expect(refused.stdout).toContain('wayland-platform: missing');
      expect(refused.stdout).toContain('libwpewebkit: libwpewebkit-1.1-0 is not installed');
      expect(readFileSync(cfg.LAYR_ENV, 'utf8')).not.toContain('LAYR_KIOSK_ENGINE=wpe');

      const saved = run('bash deploy/layr-engine.sh use chromium --yes', { env });
      expect(saved).toContain('LAYR_KIOSK_ENGINE=chromium');
      const file = readFileSync(cfg.LAYR_ENV, 'utf8');
      expect(file).toContain('LAYR_KIOSK_ENGINE=chromium');
      expect(file).toContain('LAYR_PORT=7180');
      expect(file).toContain('LAYR_HIDE_CURSOR=1');

      writeFileSync(cfg.LAYR_ENV, file.replace('LAYR_KIOSK_ENGINE=chromium', 'LAYR_KIOSK_ENGINE=wpe'));
      run('bash deploy/layr-engine.sh rollback --yes', { env });
      expect(readFileSync(cfg.LAYR_ENV, 'utf8')).toContain('LAYR_KIOSK_ENGINE=chromium');
      const status = run('bash deploy/layr-engine.sh status', { env });
      expect(status).toContain('saved-engine: chromium');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it('saves mocked WPE when Cog, Cage, WPE WebKit, and a Wayland plugin are present, then rolls back to Chromium', () => {
    const fx = kioskEngineFixture({ cog: true, cage: true, webkit: true, platform: 'wl' });
    writeFileSync(path.join(fx.modules, 'libcogplatform-fdo.so'), '');
    const cfg = engineConfig(fx.root);
    const env = { ...fx.env, ...cfg };
    try {
      expect(launchEngine(fx)).toEqual({ engine: 'chromium', stderr: '' });
      expect(launchEngine(fx, 'chromium')).toEqual({ engine: 'chromium', stderr: '' });
      expect(launchEngine(fx, 'wpe')).toEqual({ engine: 'wpe', stderr: '' });
      const rejected = launchEngine(fx, 'nope');
      expect(rejected.engine).toBe('chromium');
      expect(rejected.stderr).toContain('not chromium or wpe');
      expect(run('. deploy/kiosk-lib.sh && find_cog_wayland_platform', { env: fx.env }).trim()).toBe('wl');

      const check = run('bash deploy/layr-engine.sh check', { env });
      expect(check).toContain(`cog: ${path.join(fx.bin, 'cog')}`);
      expect(check).toContain('cog-version: cog 0.16.1-layr-fixture');
      expect(check).toContain(`cage: ${path.join(fx.bin, 'cage')}`);
      expect(check).toContain('wayland-platform: wl');
      expect(check).toContain('libwpewebkit: libwpewebkit-1.1-0 0.0.0-layr-fixture');
      expect(check).not.toContain('not installed');

      const saved = run('bash deploy/layr-engine.sh use wpe --yes', { env });
      expect(saved).toContain('LAYR_KIOSK_ENGINE=wpe');
      const file = readFileSync(cfg.LAYR_ENV, 'utf8');
      expect(file).toContain('LAYR_KIOSK_ENGINE=wpe');
      expect(file).toContain('LAYR_PORT=7180');
      expect(file).toContain('LAYR_MOONRAKER_URL=http://localhost:7125');
      expect(file).toContain('LAYR_HIDE_CURSOR=1');
      expect(run('bash deploy/layr-engine.sh status', { env })).toContain('saved-engine: wpe');

      run('bash deploy/layr-engine.sh rollback --yes', { env });
      const rolled = readFileSync(cfg.LAYR_ENV, 'utf8');
      expect(rolled).toContain('LAYR_KIOSK_ENGINE=chromium');
      expect(rolled).not.toContain('LAYR_KIOSK_ENGINE=wpe');
      expect(rolled).toContain('LAYR_PORT=7180');
      expect(rolled).toContain('LAYR_HIDE_CURSOR=1');
      expect(run('bash deploy/layr-engine.sh status', { env })).toContain('saved-engine: chromium');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it('accepts a mocked fdo plugin when the wl plugin is absent', () => {
    const fx = kioskEngineFixture({ cog: true, cage: true, webkit: true, platform: 'fdo' });
    try {
      expect(launchEngine(fx, 'wpe')).toEqual({ engine: 'wpe', stderr: '' });
      const check = run('bash deploy/layr-engine.sh check', { env: fx.env });
      expect(check).toContain('wayland-platform: fdo');
      expect(check).toContain('cog-version: cog 0.16.1-layr-fixture');
      expect(check).toContain('libwpewebkit: libwpewebkit-1.1-0 0.0.0-layr-fixture');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it('falls back to Chromium and refuses to save WPE for each missing mocked dependency', () => {
    const cases: Array<{ name: string; cog?: boolean; cage?: boolean; webkit?: boolean; platform?: CogPlatform; report: string }> = [
      { name: 'cog missing', cage: true, webkit: true, platform: 'wl', report: 'cog: not installed' },
      { name: 'cage missing', cog: true, webkit: true, platform: 'wl', report: 'cage: not installed' },
      {
        name: 'WPE WebKit package missing',
        cog: true,
        cage: true,
        webkit: false,
        platform: 'wl',
        report: 'libwpewebkit: libwpewebkit-1.1-0 is not installed',
      },
      { name: 'Wayland plugin missing', cog: true, cage: true, webkit: true, platform: 'none', report: 'wayland-platform: missing' },
      { name: 'DRM plugin ignored', cog: true, cage: true, webkit: true, platform: 'drm', report: 'wayland-platform: missing' },
    ];
    for (const item of cases) {
      const fx = kioskEngineFixture(item);
      const cfg = engineConfig(fx.root);
      const env = { ...fx.env, ...cfg };
      try {
        const launched = launchEngine(fx, 'wpe');
        expect(launched.engine, item.name).toBe('chromium');
        expect(launched.stderr, item.name).toContain('not usable');
        const checked = runAllowFail('bash deploy/layr-engine.sh check', { env });
        expect(checked.status, item.name).not.toBe(0);
        expect(checked.stdout, item.name).toContain(item.report);
        const refused = runAllowFail('bash deploy/layr-engine.sh use wpe --yes', { env });
        expect(refused.status, item.name).not.toBe(0);
        expect(refused.stderr, item.name).toContain('The saved engine was not changed');
        expect(readFileSync(cfg.LAYR_ENV, 'utf8'), item.name).not.toContain('LAYR_KIOSK_ENGINE=');
      } finally {
        rmSync(fx.root, { recursive: true, force: true });
      }
    }
  });

  it('reports the real host WPE probe for diagnostics', () => {
    const output = run(`
      set +e
      . deploy/kiosk-lib.sh
      wpe_report
      printf '\\n__probe_exit:%s\\n' "$?"
      exit 0
    `);
    const matched = output.match(/__probe_exit:(\d+)\s*$/);
    const report = output.replace(/\n?__probe_exit:\d+\s*$/, '').trim();
    process.stderr.write(`Host WPE probe (diagnostic only, not asserted), exit ${matched?.[1] ?? 'unknown'}\n${report}\n`);
    expect(matched).not.toBeNull();
  });
});

describe('pointer helpers', () => {
  it('reads the last hideCursor value from Chromium localStorage bytes', () => {
    const profile = mkdtempSync(path.join(tmpdir(), 'layr-profile-'));
    const level = path.join(profile, 'Default', 'Local Storage', 'leveldb');
    mkdirSync(level, { recursive: true });
    const script = path.join(repo, 'deploy/read-hide-cursor.py');
    writeFileSync(path.join(level, '000001.log'), Buffer.from('{"hideCursor":false}{"hideCursor":true}', 'utf-8'));
    expect(run(`python3 ${JSON.stringify(script)} ${JSON.stringify(profile)}`).trim()).toBe('1');
    writeFileSync(path.join(level, '000002.ldb'), Buffer.from('{"hideCursor":true}{"hideCursor":false}', 'utf16le'));
    expect(run(`python3 ${JSON.stringify(script)} ${JSON.stringify(profile)}`).trim()).toBe('0');
    rmSync(profile, { recursive: true, force: true });
  });

  it('writes a transparent Xcursor theme', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-cursor-'));
    run(`python3 deploy/blank-cursor.py ${JSON.stringify(root)}`);
    const cursor = readFileSync(path.join(root, 'layr-blank', 'cursors', 'left_ptr'));
    expect(cursor.subarray(0, 4).toString('utf8')).toBe('Xcur');
    expect(existsSync(path.join(root, 'layr-blank', 'cursors', 'hand2'))).toBe(true);
    expect(readFileSync(path.join(root, 'layr-blank', 'index.theme'), 'utf8')).toContain('layr-blank');
    rmSync(root, { recursive: true, force: true });
  });
});

function pageUrl(home: string, port = '7180', moonraker = 'http://localhost:7125'): URL {
  const raw = run(
    `. deploy/kiosk-lib.sh && kiosk_page_url ${JSON.stringify(port)} ${JSON.stringify(moonraker)} ${JSON.stringify(home)}`,
  ).trim();
  return new URL(raw);
}

function releaseHome(root: string, name: string): { home: string; dir: string } {
  const home = path.join(root, 'layr');
  const dir = path.join(home, 'releases', name);
  mkdirSync(dir, { recursive: true });
  return { home, dir };
}

const managedRule = (names: string[]) =>
  [
    '# LAYR-owned: 99-layr-ignore-hdmi-pointers.rules',
    '# Managed by deploy/layr-hdmi-input.sh. Do not edit this file.',
    '# Ignores Raspberry Pi vc4-hdmi virtual pointing sticks only.',
    '# HDMI-CEC remote and keyboard events on those devices are ignored too.',
    '# Touchscreens, mice, and other input devices are not matched.',
    '# Remove with: deploy/layr-hdmi-input.sh remove',
    ...names.map(
      (name) =>
        `ACTION!="remove", SUBSYSTEM=="input", KERNEL=="event[0-9]*", ATTRS{name}=="${name}", ENV{LIBINPUT_IGNORE_DEVICE}="1"`,
    ),
    '',
  ].join('\n');

const handWrittenPiRule = [
  'ACTION!="remove", SUBSYSTEM=="input", KERNEL=="event[0-9]*", ATTRS{name}=="vc4-hdmi-0", ENV{LIBINPUT_IGNORE_DEVICE}="1"',
  'ACTION!="remove", SUBSYSTEM=="input", KERNEL=="event[0-9]*", ATTRS{name}=="vc4-hdmi-1", ENV{LIBINPUT_IGNORE_DEVICE}="1"',
  '',
].join('\n');

function writeInput(root: string, event: string, name: string, props: Record<string, string>) {
  const dir = path.join(root, 'input', event);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'name'), `${name}\n`);
  writeFileSync(
    path.join(dir, 'properties'),
    `${Object.entries(props)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
  );
}

function hdmiFixture(root: string) {
  const home = path.join(root, 'home');
  mkdirSync(home, { recursive: true });
  mkdirSync(path.join(root, 'input'), { recursive: true });
  return {
    script: path.join(repo, 'deploy/layr-hdmi-input.sh'),
    rule: path.join(root, 'udev', '99-layr-ignore-hdmi-pointers.rules'),
    log: path.join(root, 'udev.log'),
    env: {
      HOME: home,
      LAYR_HOME: path.join(home, 'layr'),
      LAYR_INPUT_FIXTURE: path.join(root, 'input'),
      LAYR_UDEV_RULES_PATH: path.join(root, 'udev', '99-layr-ignore-hdmi-pointers.rules'),
      LAYR_UDEV_CMD_LOG: path.join(root, 'udev.log'),
    },
  };
}

function writePanel(root: string) {
  writeInput(root, 'event10', 'BIQU BTT-HDMI7', { ID_INPUT_TOUCHSCREEN: '1', ID_INPUT_KEY: '1' });
  writeInput(root, 'event2', 'vc4-hdmi-1', { ID_INPUT_POINTINGSTICK: '1', ID_INPUT_KEY: '1' });
  writeInput(root, 'event7', 'vc4-hdmi-0', { ID_INPUT_POINTINGSTICK: '1', ID_INPUT_KEY: '1' });
  writeInput(root, 'event1', 'Logitech USB Optical Mouse', { ID_INPUT_MOUSE: '1' });
  writeInput(root, 'event4', 'gpio-keys', { ID_INPUT_KEY: '1' });
}

function fakeSystemctl(bin: string, mode: 'active' | 'inactive') {
  mkdirSync(bin, { recursive: true });
  const active = mode === 'active' ? '1' : '0';
  writeFileSync(
    path.join(bin, 'systemctl'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$LAYR_SYSTEMCTL_LOG"
verb=$1
shift
[ "$1" = "--quiet" ] && shift
unit=$1
case "$verb" in
  is-active)
    if [ "$unit" = "layr-kiosk.service" ] && [ "${active}" = "1" ]; then exit 0; fi
    exit 3
    ;;
  is-enabled)
    if [ "$unit" = "layr-kiosk.service" ] && [ "${active}" = "1" ]; then exit 0; fi
    exit 1
    ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
}

describe('kiosk page URL', () => {
  it('uses the release directory name and returns to it on rollback', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-url-'));
    const older = releaseHome(root, '20261028T010000Z');
    const newer = releaseHome(root, '20261028T020000Z');
    const current = path.join(older.home, 'current');
    const point = (dir: string) => {
      rmSync(current, { force: true });
      symlinkSync(dir, current);
    };
    try {
      point(newer.dir);
      const upgraded = pageUrl(older.home, '7180', 'http://printer.local:7125/path?x=1&y=2');
      expect(upgraded.origin + upgraded.pathname).toBe('http://localhost:7180/');
      expect(upgraded.hash).toBe('#/home');
      expect([...upgraded.searchParams.keys()]).toEqual(['moonraker', 'layr_build']);
      expect(upgraded.searchParams.get('moonraker')).toBe('http://printer.local:7125/path?x=1&y=2');
      expect(upgraded.searchParams.get('layr_build')).toBe('20261028T020000Z');
      const repeated = pageUrl(older.home);
      expect(pageUrl(older.home).href).toBe(repeated.href);

      point(older.dir);
      expect(pageUrl(older.home).searchParams.get('layr_build')).toBe('20261028T010000Z');
      point(newer.dir);
      expect(pageUrl(older.home).searchParams.get('layr_build')).toBe('20261028T020000Z');

      const spaced = releaseHome(root, 'release one');
      point(spaced.dir);
      expect(pageUrl(older.home).searchParams.get('layr_build')).toBe('release one');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stays unreleased when current is missing, broken, or not a directory', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-url-missing-'));
    const home = path.join(root, 'layr');
    mkdirSync(home);
    try {
      expect(pageUrl(home).searchParams.get('layr_build')).toBe('unreleased');
      expect(pageUrl(home).searchParams.get('moonraker')).toBe('http://localhost:7125');
      expect(pageUrl(home).hash).toBe('#/home');

      symlinkSync(path.join(home, 'releases', 'missing'), path.join(home, 'current'));
      expect(pageUrl(home).searchParams.get('layr_build')).toBe('unreleased');
      rmSync(path.join(home, 'current'));
      writeFileSync(path.join(home, 'current'), 'not a release');
      expect(pageUrl(home).searchParams.get('layr_build')).toBe('unreleased');

      const bad = runAllowFail(`. deploy/kiosk-lib.sh && kiosk_page_url '7180;rm' 'http://localhost:7125' ${JSON.stringify(home)}`);
      expect(bad.status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('follows rollback.sh in both directions without restarting the kiosk', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-rollback-url-'));
    const layr = path.join(root, 'home', 'layr');
    const older = path.join(layr, 'releases', '20261028T010000Z');
    const newer = path.join(layr, 'releases', '20261028T020000Z');
    const bin = path.join(root, 'bin');
    mkdirSync(older, { recursive: true });
    mkdirSync(newer, { recursive: true });
    mkdirSync(path.join(layr, 'state'), { recursive: true });
    symlinkSync(newer, path.join(layr, 'current'));
    writeFileSync(path.join(layr, 'state', 'previous'), `${older}\n`);
    fakeSystemctl(bin, 'inactive');
    const env = {
      HOME: path.join(root, 'home'),
      LAYR_HOME: layr,
      LAYR_SYSTEMCTL_LOG: path.join(root, 'systemctl.log'),
      PATH: `${bin}:${process.env.PATH ?? ''}`,
    };
    try {
      expect(pageUrl(layr).searchParams.get('layr_build')).toBe('20261028T020000Z');
      const first = run('bash deploy/rollback.sh --yes', { env });
      expect(first).toContain('The kiosk was not restarted');
      expect(pageUrl(layr).searchParams.get('layr_build')).toBe('20261028T010000Z');
      expect(readFileSync(env.LAYR_SYSTEMCTL_LOG, 'utf8')).not.toContain('restart');
      run('bash deploy/rollback.sh --yes', { env });
      expect(pageUrl(layr).searchParams.get('layr_build')).toBe('20261028T020000Z');

      const preview = run('bash deploy/rollback.sh --dry-run --yes --reload-kiosk', { env });
      expect(preview).toContain('layr-kiosk.service is not active, so it was not started.');
      expect(preview).not.toContain('systemctl restart layr-kiosk');
      expect(pageUrl(layr).searchParams.get('layr_build')).toBe('20261028T020000Z');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds the kiosk page from the shared URL helper', () => {
    const text = readFileSync(path.join(repo, 'deploy/layr-kiosk.sh'), 'utf8');
    expect(text).toContain('PAGE=$(kiosk_page_url "$LAYR_PORT" "$LAYR_MOONRAKER_URL" "$LAYR_HOME")');
    expect(text).not.toContain('PAGE="http://localhost:${LAYR_PORT}/?moonraker=${LAYR_MOONRAKER_URL}#/home"');
    expect(text.match(/"\$PAGE"/g)).toHaveLength(2);
  });
});

describe('kiosk reload', () => {
  it('restarts layr-kiosk only when that unit is already active', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-reload-'));
    const bin = path.join(root, 'bin');
    const log = path.join(root, 'systemctl.log');
    fakeSystemctl(bin, 'active');
    const env = { PATH: `${bin}:${process.env.PATH ?? ''}`, LAYR_SYSTEMCTL_LOG: log };
    try {
      const active = run(`DRY_RUN=0; . deploy/lib.sh; DRY_RUN=0; reload_active_kiosk`, { env });
      expect(active).toContain('Reloading layr-kiosk.service only');
      const calls = readFileSync(log, 'utf8');
      expect(calls).toContain('restart layr-kiosk.service');
      expect(calls).not.toMatch(/klipper|moonraker|KlipperScreen/i);
      rmSync(log);

      fakeSystemctl(bin, 'inactive');
      const idle = run(`. deploy/lib.sh; reload_active_kiosk`, { env });
      expect(idle).toContain('layr-kiosk.service is not active, so it was not started.');
      expect(readFileSync(log, 'utf8')).not.toContain('restart');

      const limited = path.join(root, 'limited');
      mkdirSync(limited);
      symlinkSync('/bin/bash', path.join(limited, 'bash'));
      const missing = runAllowFail(`. deploy/lib.sh; reload_active_kiosk`, { env: { PATH: limited } });
      expect(missing.status).not.toBe(0);
      expect(missing.stdout + missing.stderr).toMatch(/systemctl is not available/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('HDMI phantom pointer rule', () => {
  it('ignores only vc4-hdmi pointing sticks and keeps touch and mouse devices', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-hdmi-'));
    const swapped = mkdtempSync(path.join(tmpdir(), 'layr-hdmi-swap-'));
    const fx = hdmiFixture(root);
    const other = hdmiFixture(swapped);
    writePanel(root);
    writeInput(swapped, 'event0', 'BIQU BTT-HDMI7', { ID_INPUT_TOUCHSCREEN: '1', ID_INPUT_POINTINGSTICK: '1' });
    writeInput(swapped, 'event3', 'vc4-hdmi-1', { ID_INPUT_POINTINGSTICK: '1', ID_INPUT_KEY: '1' });
    writeInput(swapped, 'event12', 'vc4-hdmi-0', { ID_INPUT_POINTINGSTICK: '1', ID_INPUT_KEY: '1' });
    writeInput(swapped, 'event8', 'Logitech USB Optical Mouse', { ID_INPUT_MOUSE: '1', ID_INPUT_POINTINGSTICK: '1' });
    try {
      const status = run(`bash ${JSON.stringify(fx.script)} status`, { env: fx.env });
      expect(status).toContain('mitigation-offered: yes');
      expect(status).toContain('phantom-names: vc4-hdmi-0 vc4-hdmi-1');
      expect(status).toMatch(/name: BIQU BTT-HDMI7[\s\S]*?phantom-hdmi-pointer: no/);
      expect(status).toMatch(/name: vc4-hdmi-0[\s\S]*?phantom-hdmi-pointer: yes/);
      expect(status).toMatch(/name: Logitech USB Optical Mouse[\s\S]*?phantom-hdmi-pointer: no/);
      expect(status).toContain('note: status does not change input devices');
      expect(existsSync(fx.rule)).toBe(false);

      const applied = run(`bash ${JSON.stringify(fx.script)} apply --yes`, { env: fx.env });
      expect(applied).toContain('HDMI-CEC');
      expect(applied).toContain('mitigation-applied: yes');
      expect(applied).toContain('live: event10 name=BIQU BTT-HDMI7 ID_INPUT_TOUCHSCREEN=1 LIBINPUT_IGNORE_DEVICE=-');
      const rule = readFileSync(fx.rule, 'utf8');
      expect(rule).toBe(managedRule(['vc4-hdmi-0', 'vc4-hdmi-1']));
      expect(rule).not.toContain('event10');
      expect(rule).not.toContain('event7');
      expect(rule).not.toContain('event2');
      expect(rule).not.toContain('BTT');
      expect(rule).not.toContain('Logitech');
      const log = readFileSync(fx.log, 'utf8').trim().split('\n');
      expect(log[0]).toBe('udevadm control --reload-rules');
      expect(log).toContain('udevadm trigger --subsystem-match=input --action=change --sysname-match=event2');
      expect(log).toContain('udevadm trigger --subsystem-match=input --action=change --sysname-match=event7');
      expect(log.some((line) => line.includes('event10') || line.includes('event1') || line.includes('event4'))).toBe(false);
      expect(log.some((line) => line === 'udevadm trigger --subsystem-match=input --action=change')).toBe(false);

      run(`bash ${JSON.stringify(other.script)} apply --yes`, { env: other.env });
      expect(readFileSync(other.rule, 'utf8')).toBe(rule);

      rmSync(fx.log);
      const again = run(`bash ${JSON.stringify(fx.script)} apply --yes`, { env: fx.env });
      expect(again).toContain('was not rewritten');
      expect(readFileSync(fx.rule, 'utf8')).toBe(rule);
      expect(readFileSync(fx.rule, 'utf8').match(/^ACTION/gm)).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(swapped, { recursive: true, force: true });
    }
  });

  it('does not apply when nothing matches, including CEC keys and touch-tagged HDMI names', () => {
    const cases: Array<{ name: string; props: Record<string, string> }> = [
      { name: 'vc4-hdmi-0', props: { ID_INPUT_KEY: '1' } },
      { name: 'vc4-hdmi-0', props: { ID_INPUT_POINTINGSTICK: '1', ID_INPUT_TOUCHSCREEN: '1' } },
      { name: 'vc4-hdmi-0-extra', props: { ID_INPUT_POINTINGSTICK: '1' } },
      { name: 'BIQU BTT-HDMI7', props: { ID_INPUT_TOUCHSCREEN: '1', ID_INPUT_POINTINGSTICK: '1' } },
      { name: 'Logitech USB Optical Mouse', props: { ID_INPUT_MOUSE: '1' } },
    ];
    for (const item of cases) {
      const root = mkdtempSync(path.join(tmpdir(), 'layr-hdmi-skip-'));
      const fx = hdmiFixture(root);
      writeInput(root, 'event0', item.name, item.props);
      try {
        const output = run(`bash ${JSON.stringify(fx.script)} apply --yes`, { env: fx.env });
        expect(output).toContain('No vc4-hdmi pointing stick found');
        expect(output).toContain('mitigation-applied: no');
        expect(existsSync(fx.rule)).toBe(false);
        expect(existsSync(fx.log)).toBe(false);
        const status = run(`bash ${JSON.stringify(fx.script)} status`, { env: fx.env });
        expect(status).toContain('mitigation-offered: no');
        expect(status).toContain('phantom-count: 0');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }

    const empty = mkdtempSync(path.join(tmpdir(), 'layr-hdmi-empty-'));
    const fx = hdmiFixture(empty);
    try {
      const output = run(`bash ${JSON.stringify(fx.script)} apply`, { env: fx.env });
      expect(output).toContain('mitigation-applied: no');
      expect(existsSync(fx.rule)).toBe(false);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite or remove a rule it did not write', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-hdmi-foreign-'));
    const fx = hdmiFixture(root);
    writePanel(root);
    mkdirSync(path.dirname(fx.rule), { recursive: true });
    writeFileSync(fx.rule, handWrittenPiRule);
    try {
      const applied = run(`bash ${JSON.stringify(fx.script)} apply --yes`, { env: fx.env });
      expect(applied).toContain('A hand-written Pi rule is preserved');
      expect(readFileSync(fx.rule, 'utf8')).toBe(handWrittenPiRule);
      const removed = runAllowFail(`bash ${JSON.stringify(fx.script)} remove --yes`, { env: fx.env });
      expect(removed.status).not.toBe(0);
      expect(removed.stderr).toContain('LAYR did not write it');
      expect(readFileSync(fx.rule, 'utf8')).toBe(handWrittenPiRule);

      writeFileSync(fx.rule, `${handWrittenPiRule}# operator note\n`);
      const noted = readFileSync(fx.rule, 'utf8');
      run(`bash ${JSON.stringify(fx.script)} apply --yes`, { env: fx.env });
      expect(readFileSync(fx.rule, 'utf8')).toBe(noted);

      writeFileSync(
        fx.rule,
        `${handWrittenPiRule}ACTION!="remove", SUBSYSTEM=="input", KERNEL=="event[0-9]*", ATTRS{name}=="Logitech USB Optical Mouse", ENV{LIBINPUT_IGNORE_DEVICE}="1"\n`,
      );
      const custom = readFileSync(fx.rule, 'utf8');
      const refused = runAllowFail(`bash ${JSON.stringify(fx.script)} apply --yes`, { env: fx.env });
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toContain('Refusing to overwrite');
      expect(readFileSync(fx.rule, 'utf8')).toBe(custom);

      writeFileSync(fx.rule, handWrittenPiRule.split('\n')[1] + '\n');
      const partial = readFileSync(fx.rule, 'utf8');
      const incomplete = runAllowFail(`bash ${JSON.stringify(fx.script)} apply --yes`, { env: fx.env });
      expect(incomplete.status).not.toBe(0);
      expect(readFileSync(fx.rule, 'utf8')).toBe(partial);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is idempotent to install and can remove and restore only its own rule', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-hdmi-restore-'));
    const fx = hdmiFixture(root);
    writeInput(root, 'event9', 'vc4-hdmi-0', { ID_INPUT_POINTINGSTICK: '1', ID_INPUT_KEY: '1' });
    writeInput(root, 'event5', 'vc4-hdmi-0', { ID_INPUT_POINTINGSTICK: '1', ID_INPUT_KEY: '1' });
    try {
      const dry = run(`bash ${JSON.stringify(fx.script)} apply --dry-run`, { env: fx.env });
      expect(dry).toContain('Dry run. No file, udev device, or service was changed.');
      expect(dry).toContain('HDMI-CEC');
      expect(existsSync(fx.rule)).toBe(false);
      expect(existsSync(fx.log)).toBe(false);
      const declined = runAllowFail(`printf '\\n' | bash ${JSON.stringify(fx.script)} apply`, { env: fx.env });
      expect(declined.status).not.toBe(0);
      expect(declined.stderr).toContain('No input device was changed');
      expect(existsSync(fx.rule)).toBe(false);

      run(`bash ${JSON.stringify(fx.script)} apply --yes`, { env: fx.env });
      expect(readFileSync(fx.rule, 'utf8')).toBe(managedRule(['vc4-hdmi-0']));
      expect(readFileSync(fx.rule, 'utf8').match(/^ACTION/gm)).toHaveLength(1);
      const triggers = readFileSync(fx.log, 'utf8');
      expect(triggers).toContain('--sysname-match=event5');
      expect(triggers).toContain('--sysname-match=event9');

      writeInput(root, 'event6', 'vc4-hdmi-1', { ID_INPUT_POINTINGSTICK: '1', ID_INPUT_KEY: '1' });
      run(`bash ${JSON.stringify(fx.script)} apply --yes`, { env: fx.env });
      expect(readFileSync(fx.rule, 'utf8')).toBe(managedRule(['vc4-hdmi-0', 'vc4-hdmi-1']));
      const previous = readFileSync(path.join(fx.env.LAYR_HOME, 'state', 'hdmi-pointer', 'previous-managed.rules'), 'utf8');
      expect(previous).toBe(managedRule(['vc4-hdmi-0']));

      const restored = run(`bash ${JSON.stringify(fx.script)} restore --yes`, { env: fx.env });
      expect(restored).toContain('Restored');
      expect(readFileSync(fx.rule, 'utf8')).toBe(managedRule(['vc4-hdmi-0']));

      run(`bash ${JSON.stringify(fx.script)} apply --yes`, { env: fx.env });
      expect(readFileSync(fx.rule, 'utf8')).toBe(managedRule(['vc4-hdmi-0', 'vc4-hdmi-1']));
      const removed = run(`bash ${JSON.stringify(fx.script)} remove --yes`, { env: fx.env });
      expect(removed).toContain('Removed');
      expect(existsSync(fx.rule)).toBe(false);
      const again = run(`bash ${JSON.stringify(fx.script)} remove --yes`, { env: fx.env });
      expect(again).toContain('Nothing to remove');
      run(`bash ${JSON.stringify(fx.script)} restore --yes`, { env: fx.env });
      expect(readFileSync(fx.rule, 'utf8')).toBe(managedRule(['vc4-hdmi-0', 'vc4-hdmi-1']));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('install and uninstall leave Pi input rules alone', () => {
  it('does not write a udev rule unless --ignore-hdmi-pointers is set', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-install-hdmi-'));
    const dist = path.join(root, 'dist');
    const fx = hdmiFixture(root);
    mkdirSync(dist);
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
    writePanel(root);
    const bin = path.join(root, 'bin');
    fakeSystemctl(bin, 'inactive');
    const env = { ...fx.env, PATH: `${bin}:${process.env.PATH ?? ''}`, LAYR_SYSTEMCTL_LOG: path.join(root, 'systemctl.log') };
    try {
      const plain = run(
        `bash ${JSON.stringify(path.join(repo, 'deploy/install.sh'))} --dist ${JSON.stringify(dist)} --dry-run --yes`,
        { cwd: root, env },
      );
      expect(plain).toContain('layr-kiosk.service was not restarted');
      expect(plain).toContain('layr_build=');
      expect(plain).not.toContain('LIBINPUT_IGNORE_DEVICE');
      expect(existsSync(fx.rule)).toBe(false);

      const opted = run(
        `bash ${JSON.stringify(path.join(repo, 'deploy/install.sh'))} --dist ${JSON.stringify(dist)} --dry-run --yes --ignore-hdmi-pointers`,
        { cwd: root, env },
      );
      expect(opted).toContain('Dry run. No file, udev device, or service was changed.');
      expect(opted).toContain('ATTRS{name}=="vc4-hdmi-0"');
      expect(opted).toContain('HDMI-CEC');
      expect(existsSync(fx.rule)).toBe(false);

      const quiet = hdmiFixture(path.join(root, 'empty'));
      mkdirSync(quiet.env.LAYR_INPUT_FIXTURE, { recursive: true });
      const none = run(
        `bash ${JSON.stringify(path.join(repo, 'deploy/install.sh'))} --dist ${JSON.stringify(dist)} --dry-run --yes --ignore-hdmi-pointers`,
        { cwd: root, env: { ...env, ...quiet.env } },
      );
      expect(none).toContain('No vc4-hdmi pointing stick found');
      expect(existsSync(quiet.rule)).toBe(false);

      const reloaded = run(
        `bash ${JSON.stringify(path.join(repo, 'deploy/install.sh'))} --dist ${JSON.stringify(dist)} --dry-run --yes --reload-kiosk`,
        { cwd: root, env },
      );
      expect(reloaded).toContain('layr-kiosk.service is not active, so it was not started.');
      expect(reloaded).not.toContain('systemctl restart layr-kiosk');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uninstall does not delete an existing pointer rule', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'layr-uninstall-rule-'));
    const home = path.join(root, 'home');
    const rule = path.join(root, '99-layr-ignore-hdmi-pointers.rules');
    mkdirSync(home);
    writeFileSync(rule, handWrittenPiRule);
    try {
      const output = run(`bash ${JSON.stringify(path.join(repo, 'deploy/uninstall.sh'))} --dry-run --yes`, {
        env: { HOME: home, LAYR_HOME: path.join(home, 'layr'), LAYR_UDEV_RULES_PATH: rule },
      });
      expect(output).toContain('does not delete that file');
      expect(readFileSync(rule, 'utf8')).toBe(handWrittenPiRule);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('deploy script syntax', () => {
  it('passes bash -n', () => {
    for (const script of [
      'deploy/layr-kiosk.sh',
      'deploy/kiosk-lib.sh',
      'deploy/layr-hdmi-input.sh',
      'deploy/install.sh',
      'deploy/rollback.sh',
      'deploy/uninstall.sh',
      'deploy/lib.sh',
      'deploy/check-device.sh',
      'deploy/bootstrap.sh',
      'deploy/layr-display.sh',
    ]) {
      run(`bash -n ${script}`);
    }
  });
});
