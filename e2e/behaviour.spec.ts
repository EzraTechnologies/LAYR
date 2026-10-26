import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { expectCleanLayout } from './helpers';

test.use({ viewport: { width: 1024, height: 600 } });

function trackNetwork(page: Page) {
  const sockets: string[] = [];
  const foreignRequests: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.hostname !== '127.0.0.1') foreignRequests.push(req.url());
  });
  return { sockets, foreignRequests };
}

test('demo mode opens no sockets and makes no external requests', async ({ page }) => {
  const net = trackNetwork(page);
  await page.goto('/?demo=printing&moonraker=http://127.0.0.1:7125');
  await expect(page.getByRole('heading', { name: /cable_clip_set/ })).toBeVisible();
  await page.waitForTimeout(500);
  expect(net.sockets).toEqual([]);
  expect(net.foreignRequests).toEqual([]);
});

test('demo print controls are disabled and labelled', async ({ page }) => {
  await page.goto('/?demo=printing');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await expect(page.getByText('Demo mode: printer actions are disabled')).toBeVisible();
});

test('keyboard navigation reaches every section', async ({ page }) => {
  await page.goto('/?demo=printing#/home');
  for (const label of ['Home', 'Files', 'Controls', 'Filament', 'Settings']) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: label })).toBeFocused();
  }
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
});

test('demo scenario can be switched from Settings', async ({ page }) => {
  await page.goto('/?demo=printing#/settings');
  await page.getByRole('radio', { name: 'Paused' }).click();
  await expect(page).toHaveURL(/demo=paused/);
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByText('Paused').first()).toBeVisible();
});

test('live mode shows offline state and retries when Moonraker is unreachable', async ({ page }) => {
  // Port 9 (discard) is not listening, so the socket fails immediately.
  await page.goto('/?demo=off&moonraker=http://127.0.0.1:9');
  await expect(page.getByRole('heading', { name: 'Printer is offline' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Attempt \d+/)).toBeVisible();
  await expect(page.getByText('Demo', { exact: true })).toHaveCount(0);
  await expectCleanLayout(page);
});

/** Minimal Moonraker stand-in served through Playwright's WebSocket routing; read-only methods only. */
function mockMoonraker(ws: WebSocketRoute, calls: string[]) {
  const status = {
    webhooks: { state: 'ready', state_message: 'Printer is ready' },
    print_stats: {
      filename: 'mock/test_part.gcode',
      state: 'printing',
      message: '',
      print_duration: 1200,
      total_duration: 1260,
      filament_used: 1500,
      info: { current_layer: 12, total_layer: 80 },
    },
    display_status: { progress: 0.25, message: null },
    virtual_sdcard: { progress: 0.25, is_active: true, file_path: '/x' },
    extruder: { temperature: 215.2, target: 215, power: 0.4 },
    heater_bed: { temperature: 60.1, target: 60, power: 0.2 },
  };
  ws.onMessage((raw) => {
    const msg = JSON.parse(String(raw)) as { id: number; method: string };
    calls.push(msg.method);
    const reply = (result: unknown) => ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    switch (msg.method) {
      case 'server.connection.identify':
        return reply({ connection_id: 1 });
      case 'server.info':
        return reply({ klippy_connected: true, klippy_state: 'ready' });
      case 'printer.info':
        return reply({ state: 'ready', state_message: 'Printer is ready', hostname: 'mock-host' });
      case 'printer.objects.list':
        // No chamber sensor and no heater_bed objects beyond the basics: exercises missing-object handling.
        return reply({ objects: [...Object.keys(status), 'gcode_move', 'toolhead'] });
      case 'printer.objects.subscribe':
        reply({ eventtime: 1, status });
        setTimeout(() => {
          ws.send(
            JSON.stringify({
              jsonrpc: '2.0',
              method: 'notify_status_update',
              params: [{ extruder: { temperature: 216.4 }, display_status: { progress: 0.3 } }, 2],
            }),
          );
        }, 100);
        return;
      case 'server.files.metadata':
        return reply({ filename: 'mock/test_part.gcode', estimated_time: 5000 });
      default:
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }));
    }
  });
}

test('live mode maps Moonraker data from a mocked socket', async ({ page }) => {
  const calls: string[] = [];
  await page.routeWebSocket(/\/websocket$/, (ws) => mockMoonraker(ws, calls));
  await page.goto('/?demo=off&moonraker=http://127.0.0.1:7125');

  await expect(page.getByRole('heading', { name: 'test_part' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
  await expect(page.getByLabel(/Nozzle: 216 degrees, target 215 degrees/)).toBeVisible();
  await expect(page.getByText('No chamber sensor')).toBeVisible();
  await expect(page.getByText('mock-host')).toBeVisible();
  await expect(page.getByText('Printer control is not available in LAYR v0.1')).toBeVisible();
  await expectCleanLayout(page);

  const allowed = new Set([
    'server.connection.identify',
    'server.info',
    'printer.info',
    'printer.objects.list',
    'printer.objects.subscribe',
    'server.files.metadata',
  ]);
  expect(calls.filter((m) => !allowed.has(m))).toEqual([]);
});
