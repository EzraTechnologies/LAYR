import { expect, test, type Page } from '@playwright/test';
import { ROUTES } from '../src/lib/routes';
import { openWithMock } from './helpers';
import { MOONRAKER } from './mockMoonraker';

test.use({ viewport: { width: 1024, height: 600 } });

function trackSockets(page: Page) {
  const sockets: string[] = [];
  const foreign: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  page.on('request', (req) => {
    if (new URL(req.url()).port !== '4174') foreign.push(req.url());
  });
  return { sockets, foreign };
}

async function confirmDialog(page: Page, label: string | RegExp) {
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: label }).click();
  await expect(dialog).toBeHidden();
}

test.describe('release safety', () => {
  test('there is no demo mode: ?demo= is ignored and nothing connects without an endpoint', async ({ page }) => {
    const net = trackSockets(page);
    await page.goto('/?demo=printing#/home');
    await expect(page.getByRole('heading', { name: 'Connect LAYR to your printer' })).toBeVisible();
    await expect(page.getByText(/demo/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Emergency stop/ })).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(net.sockets).toEqual([]);
    expect(net.foreign).toEqual([]);
  });

  test('the production bundle contains no demo code or sample data', async ({ page, request }) => {
    await page.goto('/');
    const scripts = await page.locator('script[src]').evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).src));
    expect(scripts.length).toBeGreaterThan(0);
    for (const src of scripts) {
      const body = await (await request.get(src)).text();
      for (const marker of ['DemoSource', 'demoScenario', 'cable_clip_set', 'Demo Printer', 'layr-demo', 'VITE_LAYR_DEMO']) {
        expect(body, `${src} contains ${marker}`).not.toContain(marker);
      }
    }
  });

  test('rendering every screen sends no printer commands', async ({ page }) => {
    for (const scenario of ['ready', 'printing'] as const) {
      const mock = await openWithMock(page, 'home', { scenario, homed: true });
      for (const route of ROUTES) {
        await page.getByRole('link', { name: route.label, exact: true }).click();
        await page.waitForTimeout(150);
      }
      expect(mock.controlCalls).toEqual([]);
    }
  });

  test('setting up the endpoint from Settings connects to the chosen Moonraker', async ({ page }) => {
    await new (await import('./mockMoonraker')).MockMoonraker({ scenario: 'ready' }).install(page);
    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Use this device' }).click();
    await expect(page.getByRole('button', { name: 'Moonraker URL' })).toContainText('http://127.0.0.1:7125');
    await page.getByRole('button', { name: 'Save & connect' }).click();
    await expect(page.getByRole('status', { name: 'Printer status: Ready' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('layr.moonrakerUrl'))).toBe(MOONRAKER);
  });
});

test.describe('dashboard', () => {
  test('maps live Moonraker data', async ({ page }) => {
    const mock = await openWithMock(page, 'home', { scenario: 'printing' });
    await expect(page.getByRole('heading', { name: 'SB_main_body_ASA_0.2mm_3h41m' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '62');
    await expect(page.getByText('130 / 210')).toBeVisible();
    await expect(page.getByLabel(/Nozzle: 255 degrees, target 255 degrees/)).toBeVisible();
    await expect(page.getByLabel(/Chamber: 51 degrees/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Fans' }).last()).toContainText('Part cooling');
    await expect(page.locator('header.bar').getByText('trident', { exact: true })).toHaveCount(0);

    const motion = page.getByRole('region', { name: 'Live motion reported by Klipper' });
    await expect(motion).toContainText('48');
    await expect(motion).toContainText('12.0');
    await expect(motion).toContainText('mm/s');
    await expect(motion).not.toContainText('%');
    await expect(motion).not.toContainText('150');
    await expect(motion).not.toContainText('120');
    await expect(page.locator('img[alt="SB_main_body_ASA_0.2mm_3h41m"]')).toBeVisible();
    await expect.poll(() => mock.thumbnailRequests).toContain(
      '/server/files/gcodes/stealthburner/.thumbs/SB_main_body_ASA_0.2mm_3h41m-300x300.png',
    );
    const subscribed = mock.calls.find((call) => call.method === 'printer.objects.subscribe');
    expect(subscribed?.params?.objects).toMatchObject({
      motion_report: ['live_velocity', 'live_extruder_velocity'],
      configfile: ['settings'],
    });
  });

  test('pause shows halted motion, not the speed or flow percentage', async ({ page }) => {
    await openWithMock(page, 'home', { scenario: 'paused' });
    const motion = page.getByRole('region', { name: 'Live motion reported by Klipper' });
    await expect(motion).toContainText('0');
    await expect(motion).toContainText('0.0');
    await expect(motion).not.toContainText('%');
    await expect(motion).not.toContainText('150');
  });

  test('does not invent a percentage when motion_report is absent', async ({ page }) => {
    const mock = new (await import('./mockMoonraker')).MockMoonraker({ scenario: 'printing' });
    delete mock.status.motion_report;
    await mock.install(page);
    await page.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/home`);
    await expect(page.getByRole('status', { name: /Printer status/ })).not.toHaveText(/Connecting|Offline|Not set up/);
    const motion = page.getByRole('region', { name: 'Live motion reported by Klipper' });
    await expect(motion).toContainText('—');
    await expect(motion).not.toContainText('%');
    await expect(motion).not.toContainText('150');
  });

  test('a speed override does not replace the live mm/s readout', async ({ page }) => {
    const mock = await openWithMock(page, 'home', { scenario: 'printing' });
    await page.getByRole('button', { name: /Live speed/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Speed override' });
    await expect(dialog).toContainText('150%');
    await dialog.getByRole('button', { name: 'Increase speed override' }).click();
    await expect.poll(() => mock.scripts.at(-1)).toBe('M220 S160');
    const motion = page.getByRole('region', { name: 'Live motion reported by Klipper' });
    await expect(motion).toContainText('48');
    await expect(motion).not.toContainText('160');
    await expect(page).toHaveURL(/#\/home$/);
  });

  test('uses a saved display name and leaves the host name alone', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('layr.ui', JSON.stringify({ displayName: 'Voron Trident' }));
    });
    await openWithMock(page, 'home', { scenario: 'ready' });
    await expect(page.getByRole('heading', { name: 'Voron Trident' })).toBeVisible();
    await expect(page.getByText('trident', { exact: true })).toBeVisible();
  });

  test('shows a placeholder thumbnail when the file has no preview', async ({ page }) => {
    await openWithMock(page, 'home', {
      scenario: 'printing',
      status: {
        print_stats: {
          filename: 'no_preview_bracket.gcode',
          state: 'printing',
          message: '',
          print_duration: 10,
          total_duration: 12,
          filament_used: 10,
          info: { current_layer: 1, total_layer: 4 },
        },
      },
    });
    await expect(page.getByRole('img', { name: 'no_preview_bracket (no preview)' })).toBeVisible();
  });

  test('shows Klipper errors from the console as alerts', async ({ page }) => {
    const mock = await openWithMock(page, 'home', { scenario: 'ready' });
    mock.notify('notify_gcode_response', ['!! Heater extruder not heating at expected rate']);
    await expect(page.getByRole('list', { name: 'Printer alerts' })).toContainText('Heater extruder not heating');
    await page.getByRole('button', { name: 'Dismiss alert' }).click();
    await expect(page.getByRole('list', { name: 'Printer alerts' })).toHaveCount(0);
  });
});

test.describe('print management', () => {
  test('pause, resume and a confirmed cancel', async ({ page }) => {
    const mock = await openWithMock(page, 'home', { scenario: 'printing' });
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('status', { name: 'Printer status: Paused' })).toBeVisible();
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByRole('status', { name: 'Printer status: Printing' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await confirmDialog(page, 'Keep printing');
    expect(mock.controlCalls.map((c) => c.method)).toEqual(['printer.print.pause', 'printer.print.resume']);

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await confirmDialog(page, 'Cancel print');
    await expect(page.getByText('Print cancelled')).toBeVisible();
    expect(mock.controlCalls.at(-1)?.method).toBe('printer.print.cancel');
  });

  test('emergency stop needs a deliberate press and hold', async ({ page }) => {
    const mock = await openWithMock(page, 'home', { scenario: 'printing' });
    const estop = page.getByRole('button', { name: /Emergency stop/ });
    await estop.click();
    await page.waitForTimeout(300);
    expect(mock.controlCalls).toEqual([]);

    const box = (await estop.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1000);
    await page.mouse.up();
    await expect(page.getByRole('heading', { name: 'Printer reports an error' })).toBeVisible();
    expect(mock.controlCalls.map((c) => c.method)).toEqual(['printer.emergency_stop']);

    await page.getByRole('button', { name: 'Firmware restart' }).click();
    await confirmDialog(page, 'Go back');
    expect(mock.controlCalls).toHaveLength(1);
    await page.getByRole('button', { name: 'Firmware restart' }).click();
    await confirmDialog(page, 'Firmware restart');
    await expect(page.getByRole('status', { name: 'Printer status: Ready' })).toBeVisible();
    expect(mock.controlCalls.at(-1)?.method).toBe('printer.firmware_restart');
  });
});

test.describe('files', () => {
  test('lists files with thumbnails, browses nested folders and falls back without a preview', async ({ page }) => {
    const mock = await openWithMock(page, 'files', { scenario: 'ready' });
    await expect(page.getByRole('button', { name: /readme/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /\.thumbs/ })).toHaveCount(0);
    await expect(page.locator('img[alt="Voron_Design_Cube_v7_ASA_0.2mm_1h12m"]')).toBeVisible();
    await expect(page.getByRole('img', { name: 'no_preview_bracket (no preview)' })).toBeVisible();

    await page.getByRole('button', { name: /calibration/ }).click();
    await expect(page.getByRole('heading', { name: 'calibration' })).toBeVisible();
    await expect(page.locator('img[alt="first layer #2"]')).toBeVisible();
    await expect.poll(() => mock.thumbnailRequests).toContain('/server/files/gcodes/calibration/.thumbs/first%20layer%20%232-300x300.png');
    await expect.poll(() => page.locator('img[alt="first layer #2"]').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Up one folder' }).click();
    await expect(page.getByRole('heading', { name: 'G-code files' })).toBeVisible();
  });

  test('starting a print requires confirmation', async ({ page }) => {
    const mock = await openWithMock(page, 'files', { scenario: 'ready' });
    await page.getByRole('button', { name: /cable_chain_mount_PETG/ }).click();
    await page.getByRole('button', { name: 'Print', exact: true }).click();
    await confirmDialog(page, 'Go back');
    expect(mock.controlCalls).toEqual([]);

    await page.getByRole('button', { name: 'Print', exact: true }).click();
    await confirmDialog(page, 'Start print');
    await expect(page).toHaveURL(/#\/home$/);
    await expect(page.getByRole('status', { name: 'Printer status: Printing' })).toBeVisible();
    expect(mock.controlCalls).toEqual([{ method: 'printer.print.start', params: { filename: 'cable_chain_mount_PETG.gcode' } }]);
  });

  test('deleting a file requires confirmation and refreshes the list', async ({ page }) => {
    const mock = await openWithMock(page, 'files', { scenario: 'ready' });
    await page.getByRole('button', { name: /no_preview_bracket/ }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await confirmDialog(page, 'Delete');
    await expect(page.getByRole('button', { name: /no_preview_bracket/ })).toHaveCount(0);
    expect(mock.controlCalls).toEqual([{ method: 'server.files.delete_file', params: { path: 'gcodes/no_preview_bracket.gcode' } }]);
  });

  test('the file being printed cannot be started again or deleted', async ({ page }) => {
    await openWithMock(page, 'files', { scenario: 'printing' });
    await page.getByRole('button', { name: /stealthburner/ }).click();
    await page.getByRole('button', { name: /SB_main_body/ }).click();
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await expect(page.getByText('A print is already in progress')).toBeVisible();
  });
});

test.describe('motion', () => {
  test('jogging is locked until homed; homing and jogs send correct Klipper G-code', async ({ page }) => {
    const mock = await openWithMock(page, 'move', { scenario: 'ready', homed: false });
    await expect(page.getByText('Home the printer to enable jogging')).toBeVisible();
    for (const name of ['X+ 10 mm', 'X− 10 mm', 'Y+ 10 mm', 'Z− 10 mm']) {
      await expect(page.getByRole('button', { name })).toBeDisabled();
    }
    await expect(page.getByRole('button', { name: 'Home Z' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Home Z' })).toHaveAttribute('title', 'Home X and Y first, or use Home all');

    await page.getByRole('button', { name: 'Home all' }).click();
    await expect(page.getByText('Homed').first()).toBeVisible();
    // Homed at X max: X+ is blocked by the travel limit, X− is allowed.
    await expect(page.getByRole('button', { name: 'X+ 10 mm' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'X+ 10 mm' })).toHaveAttribute('title', 'X is at its maximum (250 mm)');
    await page.getByRole('button', { name: 'X− 10 mm' }).click();
    await expect(page.getByText('240.0')).toBeVisible();

    expect(mock.scripts).toEqual([
      'G28',
      'SAVE_GCODE_STATE NAME=layr_jog\nG91\nG1 X-10 F3000\nRESTORE_GCODE_STATE NAME=layr_jog',
    ]);
  });

  test('Z jogs are clamped at the bed and speed-limited', async ({ page }) => {
    const mock = await openWithMock(page, 'move', { scenario: 'ready', homed: true });
    await page.getByRole('radio', { name: '25' }).first().click();
    await page.getByRole('button', { name: 'Z− 25 mm' }).click();
    await expect(page.getByText('Limited to 10 mm by the Z travel limit')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Z− 25 mm' })).toBeDisabled();
    expect(mock.scripts).toEqual(['SAVE_GCODE_STATE NAME=layr_jog\nG91\nG1 Z-10 F600\nRESTORE_GCODE_STATE NAME=layr_jog']);
  });

  test('repeated taps do not queue duplicate commands', async ({ page }) => {
    const mock = await openWithMock(page, 'move', { scenario: 'ready' });
    const home = page.getByRole('button', { name: 'Home all' });
    await home.click();
    await home.click({ force: true }).catch(() => {});
    await home.click({ force: true }).catch(() => {});
    await expect(page.getByText('Homed').first()).toBeVisible();
    expect(mock.scripts.filter((s) => s === 'G28')).toHaveLength(1);
  });

  test('during a print only babystepping is available', async ({ page }) => {
    const mock = await openWithMock(page, 'move', { scenario: 'printing' });
    await expect(page.getByText('Jogging and homing are locked')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Home all' })).toBeDisabled();
    await page.getByRole('button', { name: '+0.01' }).click();
    await expect(page.getByText('-0.010')).toBeVisible();
    expect(mock.scripts).toEqual(['SET_GCODE_OFFSET Z_ADJUST=0.01 MOVE=1']);
  });
});

test.describe('heaters and extrusion', () => {
  test('targets are limited by the printer config and high targets need confirmation', async ({ page }) => {
    const mock = await openWithMock(page, 'heat', { scenario: 'ready' });
    const sheet = page.getByRole('dialog', { name: 'Nozzle target' });

    await page.getByRole('button', { name: 'Set Nozzle target' }).click();
    await sheet.getByRole('textbox').fill('350');
    await expect(sheet.getByRole('button', { name: 'Set' })).toBeDisabled();
    await expect(sheet.getByText('Maximum 300')).toBeVisible();
    await sheet.getByRole('button', { name: 'Clear' }).click();
    for (const key of ['2', '4', '0']) await sheet.getByRole('button', { name: key, exact: true }).click();
    await sheet.getByRole('button', { name: 'Set' }).click();
    await expect(page.getByText('→ 240°')).toBeVisible();

    await page.getByRole('button', { name: 'Set Nozzle target' }).click();
    await sheet.getByRole('textbox').fill('285');
    await sheet.getByRole('button', { name: 'Set' }).click();
    await confirmDialog(page, 'Heat to 285 °C');
    await page.getByRole('button', { name: 'Cool down' }).click();

    expect(mock.scripts).toEqual([
      'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=240',
      'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=285',
      'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=0',
    ]);
  });

  test('cold extrusion is prevented', async ({ page }) => {
    const mock = await openWithMock(page, 'extrude', { scenario: 'ready' });
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled();
    await expect(page.getByText('Nozzle is below 170 °C. Heat it before extruding')).toBeVisible();
    mock.update({ extruder: { temperature: 240.2, target: 240, can_extrude: true } });
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeEnabled();
    await page.getByRole('button', { name: 'Extrude' }).click();
    await expect(page.getByText('Extrude 10 mm')).toBeVisible();
    expect(mock.scripts).toEqual(['SAVE_GCODE_STATE NAME=layr_extrude\nM83\nG1 E10 F300\nRESTORE_GCODE_STATE NAME=layr_extrude']);
  });

  test('unload reports success only after Klipper confirms completion', async ({ page }) => {
    const mock = await openWithMock(page, 'extrude', { scenario: 'ready' });
    await page.getByRole('button', { name: 'Unload' }).click();
    await confirmDialog(page, 'Run macro');
    await expect(page.getByRole('status').filter({ hasText: 'UNLOAD_FILAMENT completed' })).toBeVisible();
    expect(mock.scripts).toEqual(['UNLOAD_FILAMENT']);
  });
});

test.describe('fans, macros and console', () => {
  test('fan and light controls send scaled commands', async ({ page }) => {
    const mock = await openWithMock(page, 'fans', { scenario: 'ready' });
    await page.getByRole('button', { name: 'Part cooling 100%' }).click();
    await page.getByRole('button', { name: 'Nevermore 50%' }).click();
    await page.getByRole('button', { name: 'Caselight off' }).click();
    await expect.poll(() => mock.scripts.length).toBe(3);
    expect(mock.scripts).toEqual(['M106 S255', 'SET_FAN_SPEED FAN=nevermore SPEED=0.5', 'SET_PIN PIN=caselight VALUE=0']);
  });

  test('macros hide internal ones, search, confirm, and route parameterised macros to the console', async ({ page }) => {
    const mock = await openWithMock(page, 'macros', { scenario: 'ready' });
    await expect(page.getByRole('button', { name: /_HOME_Z_HELPER/ })).toHaveCount(0);
    await page.getByRole('button', { name: /Show internal/ }).click();
    await expect(page.getByRole('button', { name: /_HOME_Z_HELPER/ })).toBeVisible();

    await page.getByRole('button', { name: 'Search macros' }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('CASE');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Macros' }).getByRole('button')).toHaveCount(2);
    await page.getByRole('button', { name: /CASELIGHT_ON/ }).click();
    await confirmDialog(page, 'Run macro');
    await expect.poll(() => mock.scripts).toEqual(['CASELIGHT_ON']);

    await page.getByRole('button', { name: 'Clear search' }).click();
    await page.getByRole('button', { name: /CHAMBER_HEATSOAK/ }).click();
    await expect(page).toHaveURL(/#\/console$/);
    await expect(page.getByRole('button', { name: 'Edit command' })).toContainText('CHAMBER_HEATSOAK TEMP=');
    expect(mock.scripts).toEqual(['CASELIGHT_ON']);
  });

  test('console commands are typed explicitly and confirmed before sending', async ({ page }) => {
    const mock = await openWithMock(page, 'console', { scenario: 'ready' });
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
    await page.getByRole('button', { name: 'Edit command' }).click();
    const keyboard = page.getByRole('group', { name: 'On-screen keyboard' });
    for (const key of ['S', 'T', 'A', 'T', 'U', 'S']) await keyboard.getByRole('button', { name: key, exact: true }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Send' }).click();
    await confirmDialog(page, 'Go back');
    expect(mock.scripts).toEqual([]);
    await page.getByRole('button', { name: 'Send' }).click();
    await confirmDialog(page, 'Send');
    await expect(page.getByRole('list', { name: 'G-code responses' })).toContainText('> STATUS');
    await expect(page.getByRole('list', { name: 'G-code responses' })).toContainText('// Klipper state: Ready');
    expect(mock.scripts).toEqual(['STATUS']);
  });

  test('M112 typed in the console uses the emergency stop endpoint', async ({ page }) => {
    const mock = await openWithMock(page, 'console', { scenario: 'ready' });
    await page.getByRole('button', { name: 'Edit command' }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('M112');
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => mock.controlCalls.map((c) => c.method)).toEqual(['printer.emergency_stop']);
  });
});

test.describe('connection loss', () => {
  test('goes offline without stale data, disables controls and resyncs after reconnect', async ({ page }) => {
    const mock = await openWithMock(page, 'move', { scenario: 'ready', homed: true });
    await expect(page.getByRole('button', { name: 'Home all' })).toBeEnabled();
    await mock.disconnect();
    await expect(page.getByRole('status', { name: 'Printer status: Offline' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Home all' })).toBeDisabled();
    await expect(page.getByRole('button', { name: /Emergency stop/ })).toBeDisabled();
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Printer is offline' })).toBeVisible();
    await expect(page.getByLabel(/Nozzle: No data/)).toBeVisible();

    const subscribes = mock.calls.filter((c) => c.method === 'printer.objects.subscribe').length;
    mock.online = true;
    mock.status.extruder = { ...mock.status.extruder, temperature: 199.6, target: 200 };
    await page.getByRole('button', { name: 'Retry now' }).click();
    await expect(page.getByRole('status', { name: 'Printer status: Ready' })).toBeVisible();
    await expect(page.getByLabel(/Nozzle: 200 degrees, target 200 degrees/)).toBeVisible();
    expect(mock.calls.filter((c) => c.method === 'printer.objects.subscribe').length).toBe(subscribes + 1);
    expect(mock.controlCalls).toEqual([]);
  });
});
