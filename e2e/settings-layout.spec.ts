import { expect, test, type Locator, type Page } from '@playwright/test';
import { STORAGE_UI_KEY } from '../src/lib/settings.svelte';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';
import type { MockOptions } from './mockMoonraker';

/**
 * Card edges in the settings scroller's content box, so a scroll position does not change the gaps.
 * The old grid put Connection and the tall right stack in one row, then stretched that row and left
 * a hole under Connection until the full-width Printer host card.
 */
interface CardBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ColumnLayout {
  connection: CardBox;
  pi: CardBox;
  klipper: CardBox;
  integrations: CardBox;
  display: CardBox;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

const NAMES = ['Connection', 'Klipper', 'Printer host', 'Integrations', 'Display'] as const;

async function measure(page: Page): Promise<ColumnLayout> {
  return page.evaluate((names) => {
    const scroller = document.querySelector('.settings');
    if (!(scroller instanceof HTMLElement)) throw new Error('settings scroller missing');
    const origin = scroller.getBoundingClientRect();
    const cardOf = (name: string): CardBox => {
      const heading = [...scroller.querySelectorAll('h2')].find((node) => node.textContent?.trim() === name);
      const section = heading?.closest('section');
      if (!(section instanceof HTMLElement)) throw new Error(`missing ${name}`);
      const rect = section.getBoundingClientRect();
      return {
        x: rect.left - origin.left + scroller.scrollLeft,
        y: rect.top - origin.top + scroller.scrollTop,
        width: rect.width,
        height: rect.height,
      };
    };
    return {
      connection: cardOf(names[0]!),
      klipper: cardOf(names[1]!),
      pi: cardOf(names[2]!),
      integrations: cardOf(names[3]!),
      display: cardOf(names[4]!),
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    };
  }, [...NAMES]);
}

function gap(above: CardBox, below: CardBox): number {
  return below.y - (above.y + above.height);
}

function overlaps(a: CardBox, b: CardBox): boolean {
  const right = (box: CardBox) => box.x + box.width;
  const bottom = (box: CardBox) => box.y + box.height;
  return a.x < right(b) - 1 && right(a) > b.x + 1 && a.y < bottom(b) - 1 && bottom(a) > b.y + 1;
}

/**
 * Two stacks, content-sized cards, and only the column gap between neighbours.
 * `minRatio` is the shorter stack divided by the taller one. Display includes the printer image
 * chooser, so the right stack runs longer than the left. An empty Klipper card (no sensors, printer
 * not set up) shortens the left stack further. Neighbour gaps are what reject a hole under Connection.
 */
function expectBalancedColumns(layout: ColumnLayout, minRatio = 0.72) {
  const { connection, pi, klipper, integrations, display } = layout;
  expect(Math.abs(connection.y - integrations.y)).toBeLessThan(2);
  expect(Math.abs(pi.x - connection.x)).toBeLessThan(2);
  expect(Math.abs(klipper.x - connection.x)).toBeLessThan(2);
  expect(Math.abs(display.x - integrations.x)).toBeLessThan(2);
  expect(Math.abs(pi.width - connection.width)).toBeLessThan(2);
  expect(Math.abs(klipper.width - connection.width)).toBeLessThan(2);
  expect(Math.abs(display.width - integrations.width)).toBeLessThan(2);

  const columnGap = integrations.x - (connection.x + connection.width);
  expect(columnGap).toBeGreaterThan(4);
  expect(columnGap).toBeLessThan(20);

  for (const space of [gap(connection, klipper), gap(klipper, pi), gap(integrations, display)]) {
    expect(space).toBeGreaterThan(4);
    expect(space).toBeLessThan(20);
  }

  const cards = [connection, pi, klipper, integrations, display];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) expect(overlaps(cards[i]!, cards[j]!)).toBe(false);
  }

  const left = pi.y + pi.height - connection.y;
  const right = display.y + display.height - integrations.y;
  const shorter = Math.min(left, right);
  const taller = Math.max(left, right);
  expect(shorter / taller).toBeGreaterThan(minRatio);

  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  for (const card of cards) {
    expect(card.x).toBeGreaterThanOrEqual(-1);
    expect(card.x + card.width).toBeLessThanOrEqual(layout.clientWidth + 1);
  }
}

async function scrollSettings(page: Page, ratio: number) {
  await page.locator('.settings').evaluate((el, next) => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) * next;
  }, ratio);
}

async function expectFullyInViewport(page: Page, control: Locator) {
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

for (const vp of VIEWPORTS) {
  test.describe(`settings columns ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('keeps cards in two stacks with no hole under Connection', async ({ page }) => {
      await openWithMock(page, 'settings', { scenario: 'ready', homed: true });
      await expect(page.getByRole('heading', { name: 'Connection' })).toBeVisible();
      const layout = await measure(page);
      expectBalancedColumns(layout);
      expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight + 40);
      await expect(page.getByRole('heading', { name: 'Printer host' })).toContainText('Printer host');
      await expect(page.locator('[aria-labelledby="set-pi"]')).toContainText('not a Klipper firmware restart');
      await expect(page.locator('[aria-labelledby="set-printer"]')).toContainText('does not reboot the printer host');
      await expect(page.locator('[aria-labelledby="set-display"] #printer-image-label')).toHaveText('Printer image');
      await expectCleanLayout(page);

      await scrollSettings(page, 0.45);
      await expectCleanLayout(page);
      expectBalancedColumns(await measure(page));

      await scrollSettings(page, 1);
      await expect(page.getByRole('button', { name: 'Shut down printer host', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reboot printer host', exact: true })).toBeVisible();
      await expectCleanLayout(page);
      const scrolled = await page.locator('.settings').evaluate((el) => ({
        top: el.scrollTop,
        max: el.scrollHeight - el.clientHeight,
      }));
      expect(scrolled.top).toBeGreaterThan(40);
      expect(scrolled.max - scrolled.top).toBeLessThan(2);
    });

    test('stays balanced with a taller host card and a named printer', async ({ page }) => {
      await page.addInitScript((key) => {
        localStorage.setItem(key, JSON.stringify({ displayName: 'Voron Trident', theme: 'black' }));
      }, STORAGE_UI_KEY);
      const options: MockOptions = { scenario: 'printing', homed: true };
      await openWithMock(page, 'settings', options);
      const lockout = page.getByText('Not available during a print');
      await lockout.scrollIntoViewIfNeeded();
      await expect(lockout).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reboot printer host', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Shut down printer host', exact: true })).toBeDisabled();
      const useHost = page.getByRole('button', { name: 'Use host name' });
      await useHost.scrollIntoViewIfNeeded();
      await expect(useHost).toBeVisible();
      await expect(page.locator('[aria-labelledby="set-display"] #printer-image-label')).toHaveText('Printer image');
      expectBalancedColumns(await measure(page), 0.68);
      await expectCleanLayout(page);
      await scrollSettings(page, 1);
      await expectCleanLayout(page);
      await expect(page.locator('html')).toHaveClass(/theme-black/);
    });

    test('stays compact when the printer is not set up', async ({ page }) => {
      await page.goto('/#/settings');
      await expect(page.locator('[aria-labelledby="set-conn"]')).toContainText('Not set up');
      const layout = await measure(page);
      expectBalancedColumns(layout, 0.58);
      expect(gap(layout.connection, layout.klipper)).toBeLessThan(20);
      await expect(page.locator('[aria-labelledby="set-display"] #printer-image-label')).toHaveText('Printer image');
      expect(layout.pi.y).toBeGreaterThan(layout.klipper.y);
      const reboot = page.getByRole('button', { name: 'Reboot printer host', exact: true });
      await reboot.scrollIntoViewIfNeeded();
      await expect(reboot).toBeDisabled();
      await expect(page.getByText('Set up the printer connection in Settings')).toBeVisible();
      await expectCleanLayout(page);
      if (layout.scrollHeight > layout.clientHeight + 8) {
        await scrollSettings(page, 1);
        await expectCleanLayout(page);
      }
    });

    test('keeps host confirmation on screen and keyboard reachable', async ({ page }) => {
      await openWithMock(page, 'settings', { scenario: 'ready', homed: true });
      const reboot = page.getByRole('button', { name: 'Reboot printer host', exact: true });
      await reboot.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('alertdialog');
      await expect(dialog.getByRole('heading', { name: 'Reboot the printer host?' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Go back' })).toBeFocused();
      await expectFullyInViewport(page, dialog.getByRole('button', { name: 'Go back' }));
      await expectFullyInViewport(page, dialog.getByRole('button', { name: 'Reboot printer host', exact: true }));
      await expectCleanLayout(page);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      await page.getByRole('button', { name: 'Shut down printer host', exact: true }).click();
      await expect(dialog.getByRole('heading', { name: 'Shut down the printer host?' })).toBeVisible();
      await expectFullyInViewport(page, dialog.getByRole('button', { name: 'Go back' }));
      await expectFullyInViewport(page, dialog.getByRole('button', { name: 'Shut down printer host', exact: true }));
      await expectCleanLayout(page);
      await dialog.getByRole('button', { name: 'Go back' }).click();
      await expect(dialog).toBeHidden();

      await page.getByRole('radio', { name: '5 min' }).click();
      await expect(page.getByRole('radio', { name: '5 min' })).toHaveAttribute('aria-checked', 'true');
      await page.getByRole('button', { name: 'Moonraker URL' }).click();
      await expect(page.getByRole('dialog', { name: 'Moonraker URL' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Moonraker URL' })).toBeHidden();
    });
  });
}
