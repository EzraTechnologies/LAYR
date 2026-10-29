import { expect, test, type Page } from '@playwright/test';
import { seedIntegrations } from './integrationSeed';
import { openWithMock, VIEWPORTS } from './helpers';
import { errorMmu, printingMmu, readyMmu } from './mmuFixture';
import { defaultFiles, MOONRAKER, type MockFile, type MockOptions } from './mockMoonraker';

/**
 * Regenerates docs/screenshots from the real production bundle connected to the mock Moonraker in
 * `e2e/mockMoonraker.ts` (fixture data, fixed clock). Nothing here is part of the shipped app.
 */
interface Shot {
  name: string;
  route: string;
  options?: MockOptions;
  prepare?: (page: Page) => Promise<void>;
}

/** Adds one real subfolder under stealthburner so the nested shot has folders and files together. */
function withPartsFolder(): MockFile[] {
  const files = defaultFiles();
  const donor = files.find((file) => file.path.endsWith('SB_cowling_ASA_0.2mm.gcode'));
  return [
    ...files,
    {
      path: 'stealthburner/parts/logo_plate.gcode',
      modified: (donor?.modified ?? 1) - 10,
      size: 420_000,
      meta: {
        estimated_time: 900,
        filament_total: 800,
        filament_type: 'ASA',
        slicer: 'OrcaSlicer',
        slicer_version: '2.3.0',
        thumbnails: [
          { width: 32, height: 32, relative_path: '.thumbs/logo_plate-32x32.png' },
          { width: 300, height: 300, relative_path: '.thumbs/logo_plate-300x300.png' },
        ],
      },
    },
  ];
}

const SHOTS: Shot[] = [
  { name: 'home-printing', route: 'home', options: { scenario: 'printing' } },
  { name: 'home-paused', route: 'home', options: { scenario: 'paused' } },
  { name: 'home-ready', route: 'home', options: { scenario: 'ready', homed: true } },
  {
    name: 'home-error',
    route: 'home',
    options: { scenario: 'shutdown' },
  },
  {
    name: 'files',
    route: 'files',
    options: { scenario: 'ready' },
    prepare: async (page) => {
      await expect(page.getByRole('button', { name: /Voron_Design_Cube/ })).toBeVisible();
      await expect(page.getByRole('img', { name: /Voron_Design_Cube/ })).toBeVisible();
    },
  },
  {
    name: 'files-folders',
    route: 'files',
    options: { scenario: 'ready' },
    prepare: async (page) => {
      await page.getByRole('radio', { name: 'Thumbnails' }).click();
      await expect(page.getByRole('heading', { name: 'Folders' })).toBeVisible();
      await expect(page.getByRole('img', { name: /Voron_Design_Cube/ })).toBeVisible();
    },
  },
  {
    name: 'files-folders-nested',
    route: 'files',
    options: { scenario: 'ready', files: withPartsFolder() },
    prepare: async (page) => {
      await page.getByRole('radio', { name: 'Thumbnails' }).click();
      await page.getByRole('list', { name: 'Folders' }).getByRole('button', { name: /stealthburner/ }).click();
      await expect(page.getByRole('heading', { name: 'stealthburner' })).toBeVisible();
      await expect(page.getByRole('list', { name: 'Folders' }).getByRole('button', { name: /parts/ })).toBeVisible();
      await expect(page.getByRole('img', { name: /SB_main_body/ })).toBeVisible();
    },
  },
  {
    name: 'files-folder-empty',
    route: 'files',
    options: { scenario: 'ready', emptyDirs: ['archive'] },
    prepare: async (page) => {
      await page.getByRole('radio', { name: 'Thumbnails' }).click();
      await page.getByRole('list', { name: 'Folders' }).getByRole('button', { name: /archive/ }).click();
      await expect(page.getByText('This folder is empty')).toBeVisible();
    },
  },
  {
    name: 'file-detail',
    route: 'files',
    options: { scenario: 'ready' },
    prepare: async (page) => {
      await page.getByRole('button', { name: /Voron_Design_Cube/ }).click();
      await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
    },
  },
  { name: 'move', route: 'move', options: { scenario: 'ready', homed: true } },
  { name: 'move-printing', route: 'move', options: { scenario: 'printing' } },
  { name: 'heat', route: 'heat', options: { scenario: 'printing' } },
  { name: 'extrude', route: 'extrude', options: { scenario: 'paused' } },
  {
    name: 'afc',
    route: 'afc',
    options: { scenario: 'ready', homed: true, afc: 'ready' },
    prepare: async (page) => {
      await expect(page.getByText('Loaded lane2')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Change lane4' })).toBeVisible();
    },
  },
  {
    name: 'afc-loading',
    route: 'afc',
    options: { scenario: 'ready', homed: true, afc: 'loading' },
    prepare: async (page) => {
      await expect(page.getByRole('status').filter({ hasText: 'Loading · lane4' })).toBeVisible();
    },
  },
  {
    name: 'afc-error',
    route: 'afc',
    options: { scenario: 'ready', homed: true, afc: 'error' },
    prepare: async (page) => {
      await expect(page.getByText('Filament failed to load to the toolhead')).toBeVisible();
    },
  },
  {
    name: 'afc-absent',
    route: 'afc',
    options: { scenario: 'ready' },
    prepare: async (page) => {
      await expect(page.getByRole('heading', { name: 'AFC is not installed' })).toBeVisible();
    },
  },
  {
    name: 'home-spool',
    route: 'home',
    options: { scenario: 'ready', homed: true, spoolman: 'ready' },
    prepare: async (page) => {
      await expect(page.getByRole('link', { name: /Galaxy Black/ })).toBeVisible();
    },
  },
  {
    name: 'home-printing-spool',
    route: 'home',
    options: { scenario: 'printing', spoolman: 'ready' },
    prepare: async (page) => {
      await expect(page.getByText(/Galaxy Black/)).toBeVisible();
    },
  },
  {
    name: 'extrude-spool',
    route: 'extrude',
    options: { scenario: 'ready', homed: true, spoolman: 'ready' },
    prepare: async (page) => {
      await expect(page.getByRole('button', { name: /Galaxy Black/ })).toBeVisible();
    },
  },
  {
    name: 'spool-browse',
    route: 'extrude',
    options: { scenario: 'ready', homed: true, spoolman: 'ready' },
    prepare: async (page) => {
      await page.getByRole('button', { name: /Galaxy Black/ }).click();
      await expect(page.getByRole('dialog', { name: 'Spools' })).toBeVisible();
    },
  },
  {
    name: 'spool-confirm',
    route: 'extrude',
    options: { scenario: 'ready', homed: true, spoolman: 'ready' },
    prepare: async (page) => {
      await page.getByRole('button', { name: /Galaxy Black/ }).click();
      await page.getByRole('button', { name: /Arctic White/ }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
    },
  },
  {
    name: 'spool-offline',
    route: 'extrude',
    options: { scenario: 'ready', spoolman: 'offline' },
    prepare: async (page) => {
      await expect(page.getByRole('button', { name: /Spoolman offline/ })).toBeVisible();
    },
  },
  {
    name: 'files-spool',
    route: 'files',
    options: { scenario: 'ready', spoolman: 'ready' },
    prepare: async (page) => {
      await page.getByRole('button', { name: /cable_chain_mount_PETG/ }).click();
      await expect(page.getByText(/Active spool/)).toBeVisible();
    },
  },
  { name: 'fans', route: 'fans', options: { scenario: 'printing' } },
  { name: 'macros', route: 'macros', options: { scenario: 'ready' } },
  {
    name: 'console',
    route: 'console',
    options: {
      scenario: 'ready',
      gcodeStore: [
        { message: 'G28', time: 1768487400, type: 'command' },
        { message: '// Klipper state: Ready', time: 1768487410, type: 'response' },
        { message: 'QUAD_GANTRY_LEVEL', time: 1768487440, type: 'command' },
        { message: '// probe at 50.000,25.000 is z=1.402500', time: 1768487450, type: 'response' },
        { message: '// Retries: 0/5 Probed points range: 0.002500 tolerance: 0.007500', time: 1768487460, type: 'response' },
        { message: 'G1 X400', time: 1768487470, type: 'command' },
        { message: '!! Move out of range: 400.000 125.000 10.000 [0.000]', time: 1768487471, type: 'response' },
      ],
    },
  },
  { name: 'settings', route: 'settings', options: { scenario: 'ready' } },
  {
    name: 'mmu',
    route: 'mmu',
    options: { scenario: 'ready', mmu: { status: readyMmu() } },
    prepare: async (page) => {
      await expect(page.getByRole('heading', { name: 'Happy Hare' })).toBeVisible();
      await expect(page.getByRole('radio', { name: 'Gate 2, Available, selected' })).toBeVisible();
    },
  },
  {
    name: 'mmu-error',
    route: 'mmu',
    options: { scenario: 'paused', mmu: { status: errorMmu() } },
    prepare: async (page) => {
      await expect(page.getByText('Filament clog on gate 2')).toBeVisible();
    },
  },
  {
    name: 'mmu-printing',
    route: 'mmu',
    options: { scenario: 'printing', mmu: { status: printingMmu() } },
    prepare: async (page) => {
      await expect(page.getByText('Not available while printing')).toBeVisible();
    },
  },
  {
    name: 'mmu-absent',
    route: 'mmu',
    options: { scenario: 'ready' },
    prepare: async (page) => {
      await expect(page.getByRole('heading', { name: 'No Happy Hare MMU' })).toBeVisible();
    },
  },
  {
    name: 'confirm-cancel',
    route: 'home',
    options: { scenario: 'printing' },
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
    },
  },
];

test.describe('screenshots @screenshot', () => {
  for (const vp of VIEWPORTS) {
    for (const shot of SHOTS) {
      test(`${vp.name} ${shot.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        if (shot.name.startsWith('afc')) await seedIntegrations(page, { afc: true }, MOONRAKER);
        else if (shot.name.startsWith('mmu')) await seedIntegrations(page, { happyHare: true }, MOONRAKER);
        else if (shot.name.includes('spool')) await seedIntegrations(page, { spoolman: true }, MOONRAKER);
        await openWithMock(page, shot.route, { ...shot.options, fixedClock: true });
        await shot.prepare?.(page);
        await page.evaluate(() => document.fonts.ready);
        // Let one-off progress/meter transitions settle so captures are stable.
        await page.waitForTimeout(700);
        await page.screenshot({ path: `docs/screenshots/${vp.name}-${shot.name}.png` });
      });
    }

    test(`${vp.name} not-set-up`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.clock.setFixedTime(Date.UTC(2026, 0, 15, 14, 32, 0));
      await page.goto('/#/home');
      await expect(page.getByRole('heading', { name: 'Connect LAYR to your printer' })).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `docs/screenshots/${vp.name}-not-set-up.png` });
    });

    test(`${vp.name} offline`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/?moonraker=http://127.0.0.1:9#/home');
      await expect(page.getByText(/Attempt \d+/)).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: `docs/screenshots/${vp.name}-offline.png` });
    });

    test(`${vp.name} mmu-offline`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await seedIntegrations(page, { happyHare: true }, 'http://127.0.0.1:9');
      await page.goto('/?moonraker=http://127.0.0.1:9#/mmu');
      await expect(page.getByText('Printer is offline. MMU state is not shown')).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: `docs/screenshots/${vp.name}-mmu-offline.png` });
    });
  }
});
