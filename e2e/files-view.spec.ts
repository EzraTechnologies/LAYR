import { expect, test, type Page } from '@playwright/test';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';
import { defaultFiles, type MockFile } from './mockMoonraker';

/**
 * List stays the default. Folders is another view of the same Moonraker directory listing:
 * folder cards, then the G-code in that directory. Nothing here flattens or invents paths.
 */

const UI_KEY = 'layr.ui';

function confirmDialog(page: Page, label: string) {
  return async () => {
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: label }).click();
    await expect(dialog).toBeHidden();
  };
}

function treeFiles(): MockFile[] {
  const donor = defaultFiles()[0]!;
  return [
    {
      path: 'my parts #1/very_long_panel_name_for_the_trident_skirt_left_ASA_0.2mm.gcode',
      modified: donor.modified,
      size: 1_500_000,
      meta: {
        estimated_time: 2400,
        filament_total: 3200,
        filament_type: 'ASA',
        slicer: 'OrcaSlicer',
        thumbnails: [
          { width: 32, height: 32, relative_path: '.thumbs/panel-32x32.png' },
          { width: 300, height: 300, relative_path: '.thumbs/panel-300x300.png' },
        ],
      },
    },
    {
      path: 'my parts #1/covers/lid.gcode',
      modified: donor.modified - 50,
      size: 80_000,
      meta: { estimated_time: 300, filament_total: 200, filament_type: 'PETG', thumbnails: [] },
    },
    {
      path: 'orca/voron/trident/panels/left/skirt.gcode',
      modified: donor.modified - 80,
      size: 40_000,
      meta: null,
    },
  ];
}

test.describe('files view modes', () => {
  test.use({ viewport: { width: 1024, height: 600 } });

  test('list stays the default and folders shows only the current directory', async ({ page }) => {
    await openWithMock(page, 'files', { scenario: 'ready' });
    await expect(page.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('list', { name: 'Files', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /SB_main_body/ })).toHaveCount(0);

    await page.getByRole('radio', { name: 'Folders' }).click();
    await expect(page.getByRole('heading', { name: 'Folders' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'G-code', exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Files', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /SB_main_body/ })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Folders' }).getByRole('button')).toHaveText([/calibration/, /stealthburner/]);
    await expect(page.getByRole('img', { name: 'Voron_Design_Cube_v7_ASA_0.2mm_1h12m' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'no_preview_bracket (no preview)' })).toBeVisible();

    await page.getByRole('list', { name: 'Folders' }).getByRole('button', { name: /stealthburner/ }).click();
    await expect(page.getByRole('heading', { name: 'stealthburner' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'G-code files' })).toBeVisible();
    await expect(page.getByRole('button', { name: /SB_cowling/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Voron_Design_Cube/ })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Folders' })).toHaveCount(0);

    await page.getByRole('button', { name: 'G-code files' }).click();
    await expect(page.getByRole('heading', { name: 'G-code files' })).toBeVisible();
    await page.getByRole('list', { name: 'Folders' }).getByRole('button', { name: /calibration/ }).click();
    await expect(page.getByRole('img', { name: 'first layer #2' })).toBeVisible();
    await page.getByRole('button', { name: 'Up one folder' }).click();
    await expect(page.getByRole('heading', { name: 'G-code files' })).toBeVisible();
  });

  test('switching views keeps the directory, sort, and open file', async ({ page }) => {
    await openWithMock(page, 'files', { scenario: 'ready' });
    await page.getByRole('radio', { name: 'Name' }).click();
    await page.getByRole('button', { name: /calibration/ }).click();
    await expect(page.getByRole('heading', { name: 'calibration' })).toBeVisible();
    await page.getByRole('button', { name: /first layer #2/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // The detail sheet covers the toolbar, so activate the control directly. Only the view preference changes.
    await page.locator('.view button', { hasText: 'Folders' }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator('.view button', { hasText: 'Folders' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.sort button', { hasText: 'Name' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('h2.path')).toHaveText('calibration');
    await expect(page.getByRole('dialog').getByRole('heading', { name: /first layer #2/ })).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('radio', { name: 'List' }).click();
    await expect(page.getByRole('list', { name: 'Files', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'calibration' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Name' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: /first layer #2/ })).toBeVisible();
  });

  test('the choice is saved and stays in sync with Settings', async ({ page }) => {
    await openWithMock(page, 'files', { scenario: 'ready' });
    await page.getByRole('radio', { name: 'Name' }).click();
    await page.getByRole('radio', { name: 'Folders' }).click();
    await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').filesViewMode, UI_KEY)).toBe('folders');

    await page.getByRole('link', { name: 'Settings' }).click();
    const browsing = page.getByRole('radiogroup', { name: 'File browsing' });
    await expect(browsing.getByRole('radio', { name: 'Folders' })).toHaveAttribute('aria-checked', 'true');
    await browsing.getByRole('radio', { name: 'List' }).click();

    await page.getByRole('link', { name: 'Files' }).click();
    await expect(page.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('list', { name: 'Files', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Name' })).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('radio', { name: 'Folders' }).click();
    await page.reload();
    await expect(page.getByRole('status', { name: /Printer status/ })).not.toHaveText(/Connecting|Offline|Not set up/);
    await expect(page.getByRole('radio', { name: 'Folders' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('heading', { name: 'Folders' })).toBeVisible();
  });

  test('older settings and unknown values stay on the list', async ({ page }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(key, JSON.stringify({ theme: 'black', displayName: 'Voron Trident', filesViewMode: 'grid' }));
    }, UI_KEY);
    await openWithMock(page, 'files', { scenario: 'ready' });
    await expect(page.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('list', { name: 'Files', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Voron Trident' })).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/theme-black/);
  });

  test('a saved folder preference opens on folder cards', async ({ page }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(key, JSON.stringify({ filesViewMode: 'folder', displayName: 'Kept name' }));
    }, UI_KEY);
    await openWithMock(page, 'files', { scenario: 'ready' });
    await expect(page.getByRole('radio', { name: 'Folders' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('heading', { name: 'Folders' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Kept name' })).toBeVisible();
  });

  test('nested folders, empty folders, and names are not flattened', async ({ page }) => {
    await openWithMock(page, 'files', {
      scenario: 'ready',
      files: treeFiles(),
      emptyDirs: ['my parts #1/empty bin', 'orca/voron/trident/panels/left/hardware'],
    });
    await page.getByRole('radio', { name: 'Folders' }).click();
    await expect(page.getByRole('list', { name: 'Folders' }).getByRole('button')).toHaveText([/my parts #1/, /orca/]);
    await expect(page.getByRole('button', { name: /skirt/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /very_long_panel/ })).toHaveCount(0);

    await page.getByRole('button', { name: /my parts #1/ }).click();
    await expect(page.getByRole('heading', { name: 'my parts #1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'G-code files' })).toHaveAttribute('title', 'gcodes');
    await expect(page.getByRole('list', { name: 'Folders' }).getByRole('button')).toHaveText([/covers/, /empty bin/]);
    await expect(page.getByRole('img', { name: /very_long_panel_name/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /lid/ })).toHaveCount(0);

    await page.getByRole('button', { name: /empty bin/ }).click();
    await expect(page.getByRole('heading', { name: 'empty bin' })).toBeVisible();
    await expect(page.getByText('This folder is empty')).toBeVisible();
    await expect(page.getByText('No G-code files or subfolders here.')).toBeVisible();
    await page.getByRole('button', { name: 'my parts #1' }).click();
    await page.getByRole('button', { name: /^covers/ }).click();
    await expect(page.getByRole('heading', { name: 'covers' })).toBeVisible();
    await expect(page.getByRole('button', { name: /lid/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /very_long_panel/ })).toHaveCount(0);
  });

  test('folders mode still confirms print and delete, and blocks the active file', async ({ page }) => {
    const mock = await openWithMock(page, 'files', { scenario: 'ready' });
    await page.getByRole('radio', { name: 'Folders' }).click();
    await page.getByRole('button', { name: /cable_chain_mount_PETG/ }).click();
    await page.getByRole('button', { name: 'Print', exact: true }).click();
    await confirmDialog(page, 'Go back')();
    expect(mock.controlCalls).toEqual([]);
    await page.getByRole('button', { name: 'Delete' }).click();
    await confirmDialog(page, 'Go back')();
    expect(mock.controlCalls).toEqual([]);
  });

  test('the file being printed cannot be started or deleted from folder cards', async ({ page }) => {
    const mock = await openWithMock(page, 'files', { scenario: 'printing' });
    await page.getByRole('radio', { name: 'Folders' }).click();
    await page.getByRole('button', { name: /stealthburner/ }).click();
    await page.getByRole('button', { name: /SB_main_body/ }).click();
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await expect(page.getByText('A print is already in progress')).toBeVisible();
    expect(mock.controlCalls).toEqual([]);
  });
});

for (const vp of VIEWPORTS) {
  test.describe(`files view layout ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('list and folders at the root', async ({ page }) => {
      await openWithMock(page, 'files', { scenario: 'ready' });
      await expect(page.getByRole('button', { name: /Voron_Design_Cube/ })).toBeVisible();
      await expectCleanLayout(page);
      await page.getByRole('radio', { name: 'Folders' }).click();
      await expect(page.getByRole('img', { name: /Voron_Design_Cube/ })).toBeVisible();
      await expectCleanLayout(page);
    });

    test('nested folders, a deep path, and an empty folder', async ({ page }) => {
      await openWithMock(page, 'files', {
        scenario: 'ready',
        files: treeFiles(),
        emptyDirs: ['my parts #1/empty bin', 'orca/voron/trident/panels/left/hardware'],
      });
      await page.getByRole('radio', { name: 'Folders' }).click();
      await expectCleanLayout(page);

      await page.getByRole('button', { name: /orca/ }).click();
      await page.getByRole('button', { name: /^voron/ }).click();
      await page.getByRole('button', { name: /^trident/ }).click();
      await page.getByRole('button', { name: /^panels/ }).click();
      await page.getByRole('button', { name: /^left/ }).click();
      await expect(page.getByRole('heading', { name: 'left' })).toBeVisible();
      await expect(page.getByRole('button', { name: /hardware/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /skirt/ })).toBeVisible();
      await expectCleanLayout(page);

      await page.getByRole('button', { name: /hardware/ }).click();
      await expect(page.getByText('This folder is empty')).toBeVisible();
      await expectCleanLayout(page);

      await page.getByRole('button', { name: 'G-code files' }).click();
      await page.getByRole('button', { name: /my parts #1/ }).click();
      await expect(page.getByRole('img', { name: /very_long_panel_name/ })).toBeVisible();
      await expectCleanLayout(page);
    });

    test('settings file browsing control', async ({ page }) => {
      await openWithMock(page, 'settings', { scenario: 'ready' });
      const browsing = page.getByRole('radiogroup', { name: 'File browsing' });
      await expect(browsing.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
      await browsing.getByRole('radio', { name: 'Folders' }).click();
      await expectCleanLayout(page);
      await page.getByRole('link', { name: 'Files' }).click();
      await expect(page.getByRole('radio', { name: 'Folders' })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('heading', { name: 'Folders' })).toBeVisible();
    });
  });
}
