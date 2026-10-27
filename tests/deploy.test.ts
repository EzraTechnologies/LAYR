import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command: string, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  return execFileSync('bash', ['-lc', command], {
    cwd: options.cwd ?? repo,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
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

describe('kiosk engine selection', () => {
  it('selects chromium by default, finds a Wayland Cog plugin, and falls back when WPE is missing', () => {
    const modules = mkdtempSync(path.join(tmpdir(), 'layr-cog-'));
    writeFileSync(path.join(modules, 'libcogplatform-drm.so'), '');
    const script = `
      set -euo pipefail
      . deploy/kiosk-lib.sh
      normalize_engine ''
      normalize_engine WPE
      if normalize_engine nope >/dev/null; then echo 'accepted-bad'; exit 1; fi
      export LAYR_COG_MODULE_DIRS=${JSON.stringify(modules)}
      if find_cog_wayland_platform >/dev/null; then echo 'drm-was-accepted'; exit 1; fi
      touch ${JSON.stringify(path.join(modules, 'libcogplatform-wl.so'))}
      find_cog_wayland_platform
      export LAYR_KIOSK_ENGINE=wpe
      resolve_launch_engine
      export LAYR_KIOSK_ENGINE=chromium
      resolve_launch_engine
    `;
    const output = run(script).trim().split('\n');
    expect(output).toEqual(['chromium', 'wpe', 'wl', 'chromium', 'chromium']);
    rmSync(modules, { recursive: true, force: true });
  });

  it('saves a Chromium rollback and refuses to save WPE when Cog is not usable', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'layr-engine-'));
    const layr = path.join(home, 'layr');
    mkdirSync(layr);
    const env = {
      HOME: home,
      LAYR_HOME: layr,
      LAYR_ENV: path.join(layr, 'layr.env'),
      LAYR_STATE: path.join(layr, 'state'),
    };
    writeFileSync(env.LAYR_ENV, 'LAYR_PORT=7180\nLAYR_MOONRAKER_URL=http://localhost:7125\nLAYR_HIDE_CURSOR=1\n');
    try {
      const refused = runAllowFail('bash deploy/layr-engine.sh use wpe --yes', { env });
      expect(refused.status).not.toBe(0);
      expect(refused.stdout + refused.stderr).toMatch(/not usable|not installed|missing/i);
      expect(readFileSync(env.LAYR_ENV, 'utf8')).not.toContain('LAYR_KIOSK_ENGINE=wpe');

      const saved = run('bash deploy/layr-engine.sh use chromium --yes', { env });
      expect(saved).toContain('LAYR_KIOSK_ENGINE=chromium');
      const file = readFileSync(env.LAYR_ENV, 'utf8');
      expect(file).toContain('LAYR_KIOSK_ENGINE=chromium');
      expect(file).toContain('LAYR_PORT=7180');
      expect(file).toContain('LAYR_HIDE_CURSOR=1');

      writeFileSync(env.LAYR_ENV, file.replace('LAYR_KIOSK_ENGINE=chromium', 'LAYR_KIOSK_ENGINE=wpe'));
      run('bash deploy/layr-engine.sh rollback --yes', { env });
      expect(readFileSync(env.LAYR_ENV, 'utf8')).toContain('LAYR_KIOSK_ENGINE=chromium');
      const status = run('bash deploy/layr-engine.sh status', { env });
      expect(status).toContain('saved-engine: chromium');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
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
