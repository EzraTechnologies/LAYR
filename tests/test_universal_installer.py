"""Isolated installer contract tests; no packages or host services are changed."""
import importlib.machinery
import importlib.util
import json
import io
from contextlib import redirect_stdout
import os
import pty
import subprocess
import shutil
import sys
import select
import time
import signal
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('layr_cli', str(Path(__file__).resolve().parents[1] / 'deploy/layr'))
spec = importlib.util.spec_from_loader(loader.name, loader)
cli = importlib.util.module_from_spec(spec)
loader.exec_module(cli)
REAL_PROBE_WEB = cli.probe_web
REAL_RUNNING_BACKEND = cli.running_service_backend
session_spec = importlib.util.spec_from_file_location('layr_session', Path(__file__).resolve().parents[1] / 'deploy/layr-session.py')
session = importlib.util.module_from_spec(session_spec)
session_spec.loader.exec_module(session)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        patch.dict(os.environ, dict(os.environ)).start()
        self.addCleanup(patch.stopall)
        patch.object(cli, 'require_privileges').start()
        patch.object(cli, 'apt_plan').start()
        patch.object(cli, 'runtime_preflight').start()
        patch.object(cli, 'probe_moonraker', return_value=(True, 'test reachable')).start()
        patch.object(cli, 'probe_web', return_value=dict(ok=True, error='', url='http://127.0.0.1:7180/')).start()
        patch.object(cli, 'running_service_backend', return_value='wayland').start()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for directory in ('etc', 'proc/bus/input', 'sys/class/drm/card0-eDP-1', 'dist'):
            (self.root / directory).mkdir(parents=True)
        (self.root / 'etc/os-release').write_text('ID=debian\nVERSION_ID="12"\n')
        (self.root / 'proc/meminfo').write_text('MemTotal: 2048000 kB\n')
        (self.root / 'proc/bus/input/devices').write_text('N: Name="Goodix Touchscreen"\n')
        (self.root / 'sys/class/drm/card0-eDP-1/status').write_text('connected\n')
        (self.root / 'dist/index.html').write_text('<title>LAYR</title>')
        self.capture = patch.object(cli, 'capture', side_effect=self.fake_capture).start()
        self.addCleanup(patch.stopall)
        patch.object(cli, 'ROOT', self.root / 'layr').start()
        self.commands = []
        patch.object(cli, 'execute', side_effect=lambda args, dry=False: self.commands.append((list(map(str, args)), dry))).start()

    def fake_capture(self, *args):
        if args[0] == 'dpkg':
            return 'amd64'
        if args[0] == 'apt-cache':
            return 'Candidate: 1.0'
        return ''

    def options(self, **kwargs):
        return SimpleNamespace(**(dict(profile='headless', moonraker='printer.local', dist=str(self.root / 'dist'), yes=True, dry_run=False) | kwargs))

    def check_architecture(self, arch):
        with patch.object(cli, 'capture', side_effect=lambda *args: arch if args[0] == 'dpkg' else ('Candidate: 1.0' if args[0] == 'apt-cache' else '')):
            facts = cli.detect(self.root)
            self.assertTrue(facts['supported'])
            self.assertEqual(facts['architecture'], arch)
            self.assertIn('function unverified', facts['touchscreen'])
            cli.install(self.options(), facts)
            self.assertNotIn('chromium', self.commands[-2][0])
            cli.install(self.options(profile='kiosk'), facts)
            self.assertIn('chromium', self.commands[-2][0])

    def test_i386_regression(self):
        self.check_architecture('i386')

    def test_amd64_regression(self):
        self.check_architecture('amd64')

    def test_armhf_regression(self):
        self.check_architecture('armhf')

    def test_arm64_regression(self):
        self.check_architecture('arm64')

    def test_armv6_kernel_is_not_accepted_as_supported_armhf(self):
        with patch.object(cli, 'capture', side_effect=lambda *args: 'armhf' if args[0] == 'dpkg' else ('armv6l' if args[0] == 'uname' else '')):
            facts = cli.detect(self.root)
        self.assertFalse(facts['supported'])
        with self.assertRaisesRegex(RuntimeError, 'Unsupported'):
            cli.install(self.options(), facts)
        self.assertEqual(self.commands, [])

    def test_pi_os_and_mainsail_bookworm(self):
        for distro in ('raspbian', 'mainsailos'):
            (self.root / 'etc/os-release').write_text(f'ID={distro}\nVERSION_CODENAME=bookworm\n')
            self.check_architecture('armhf')
            self.check_architecture('arm64')

    def test_kiosk_without_display_or_ram_fails_before_changes(self):
        for key, value in [('ram_mb', 200), ('connectors', {})]:
            facts = cli.detect(self.root)
            facts[key] = value
            with self.assertRaises(RuntimeError):
                cli.install(self.options(profile='kiosk'), facts)
            self.assertEqual(self.commands, [])

    def test_failed_package_install_does_not_commit_state_or_continue(self):
        with patch.object(cli, 'execute', side_effect=subprocess.CalledProcessError(1, 'apt-get')) as execute:
            with self.assertRaises(subprocess.CalledProcessError):
                cli.install(self.options(), cli.detect(self.root))
            self.assertEqual(execute.call_count, 1)
            self.assertFalse(cli.ROOT.exists())

    def test_interactive_remote_configuration(self):
        cli.ROOT.mkdir()
        env_file = cli.ROOT / 'layr.env'
        env_file.write_text('LAYR_PORT=7180\nLAYR_HIDE_CURSOR=1\nLAYR_MOONRAKER_URL=http://old:7125\n')
        options = self.options(profile=None, moonraker=None)
        with patch.object(cli.sys.stdin, 'isatty', return_value=True), patch('builtins.input', side_effect=['192.168.10.50', '7125']):
            cli.configure(options)
        self.assertIn('http://192.168.10.50:7125', env_file.read_text())
        self.assertIn('LAYR_HIDE_CURSOR=1', env_file.read_text())
        self.assertEqual(self.commands, [])
        self.assertEqual(env_file.stat().st_mode & 0o777, 0o600)

    def test_unreachable_moonraker_fails_before_changes(self):
        with patch.object(cli, 'probe_moonraker', return_value=(False, 'unreachable')):
            with self.assertRaisesRegex(RuntimeError, 'connectivity failed'):
                cli.install(self.options(), cli.detect(self.root))
        self.assertEqual(self.commands, [])
        self.assertFalse(cli.ROOT.exists())

    def test_offline_staging_requires_explicit_flag(self):
        with patch.object(cli, 'probe_moonraker', return_value=(False, 'unreachable')):
            cli.install(self.options(allow_offline=True), cli.detect(self.root))
        self.assertEqual(len(self.commands), 2)

    def test_preflight_is_read_only(self):
        options = self.options()
        options.command = 'preflight'
        cli.install(options, cli.detect(self.root))
        self.assertEqual(self.commands, [])
        self.assertFalse(cli.ROOT.exists())

    def test_unverified_autostart_is_held_without_starting_or_enabling_kiosk(self):
        cli.install(self.options(profile='kiosk', autostart=True), cli.detect(self.root))
        self.assertNotIn('layr-display.sh', str(self.commands))
        self.assertNotIn('enable', str(self.commands))
        self.assertNotIn('KlipperScreen', str(self.commands))

    def test_autostart_dry_run_does_not_execute_display_switch(self):
        cli.install(self.options(profile='kiosk', autostart=True, dry_run=True), cli.detect(self.root))
        self.assertIn('--dry-run', self.commands[-1][0])
        self.assertNotIn('layr-display.sh', str(self.commands))
        self.assertFalse(cli.ROOT.exists())

    def test_repair_uses_configured_endpoint_instead_of_stale_state(self):
        cli.ROOT.mkdir()
        (cli.ROOT / 'layr.env').write_text('LAYR_MOONRAKER_URL=http://new:7125\n')
        cli.install(self.options(moonraker=None), cli.detect(self.root))
        self.assertIn('http://new:7125', self.commands[-1][0])

    def test_fresh_repeat_upgrade_and_repair_preserve_profile(self):
        facts = cli.detect(self.root)
        cli.install(self.options(profile='desktop'), facts)
        cli.install(self.options(profile=None, moonraker=None), facts)
        state = json.loads((cli.ROOT / 'state/installer.json').read_text())
        self.assertEqual(state, dict(profile='desktop', moonraker='http://printer.local:7125'))
        self.assertIn('--headless', self.commands[-1][0])
        self.assertFalse(any('KlipperScreen' in str(command) for command in self.commands))

    def test_kiosk_is_explicit_and_never_installs_klipperscreen(self):
        cli.install(self.options(profile='kiosk'), cli.detect(self.root))
        self.assertNotIn('chromium', self.commands[0][0])
        self.assertIn('chromium', self.commands[2][0])
        self.assertIn('--headless', self.commands[1][0])
        self.assertIn('--kiosk-only', self.commands[3][0])
        self.assertNotIn('KlipperScreen', str(self.commands))

    def test_desktop_conflict_changes_nothing(self):
        facts = cli.detect(self.root)
        facts['services']['display-manager.service'] = 'active'
        with self.assertRaisesRegex(RuntimeError, 'Desktop'):
            cli.install(self.options(profile='kiosk'), facts)
        self.assertEqual(self.commands, [])

    def test_missing_candidate_changes_nothing(self):
        facts = cli.detect(self.root)
        with patch.object(cli, 'capture', return_value='Candidate: (none)'):
            with self.assertRaisesRegex(RuntimeError, 'No compatible APT candidate'):
                cli.install(self.options(), facts)
        self.assertEqual(self.commands, [])

    def test_unsupported_os_and_arch(self):
        for distro, version, arch in [('ubuntu', '12', 'amd64'), ('debian', '13', 'amd64'), ('debian', '12', 'armel')]:
            (self.root / 'etc/os-release').write_text(f'ID={distro}\nVERSION_ID={version}\n')
            with patch.object(cli, 'capture', return_value=arch):
                facts = cli.detect(self.root)
            with self.assertRaisesRegex(RuntimeError, 'Unsupported'):
                cli.install(self.options(), facts)
        self.assertEqual(self.commands, [])

    def test_dry_run_does_not_write_state(self):
        cli.install(self.options(dry_run=True), cli.detect(self.root))
        self.assertFalse(cli.ROOT.exists())
        self.assertIn('--dry-run', self.commands[-1][0])
        self.assertTrue(self.commands[0][1])

    def test_repair_preserves_existing_web_port(self):
        cli.ROOT.mkdir()
        (cli.ROOT / 'layr.env').write_text('LAYR_PORT=8180\n')
        cli.install(self.options(), cli.detect(self.root))
        args = self.commands[-1][0]
        self.assertEqual(args[args.index('--port') + 1], '8180')

    def test_invalid_saved_port_fails_before_changes(self):
        cli.ROOT.mkdir()
        (cli.ROOT / 'layr.env').write_text('LAYR_PORT=7125\n')
        with self.assertRaisesRegex(RuntimeError, 'Saved LAYR port'):
            cli.install(self.options(), cli.detect(self.root))
        self.assertEqual(self.commands, [])

    def test_endpoint_validation(self):
        self.assertEqual(cli.moonraker('192.168.1.10'), 'http://192.168.1.10:7125')
        self.assertEqual(cli.moonraker('http://[::1]:7125'), 'http://[::1]:7125')
        for value in ('http://a:bad', 'http://user:pass@printer', 'file:///etc/passwd', 'http://printer/\nINJECT=1', 'http://a/extra', 'http://a?x=y'):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                cli.moonraker(value)

    def test_recovery_is_independent_of_detection_or_network(self):
        with patch('sys.argv', ['layr', 'recover', '--dry-run']), patch.object(cli, 'detect', side_effect=AssertionError('must be offline')):
            cli.main()
        self.assertEqual(self.commands, [(['sudo', 'systemctl', 'disable', '--now', 'layr-kiosk.service'], True)])

    def test_configure_does_not_destroy_previous_release(self):
        cli.ROOT.mkdir()
        (cli.ROOT / 'layr.env').write_text('LAYR_PORT=7180\n')
        state = cli.ROOT / 'state'
        state.mkdir()
        (state / 'previous').write_text('/previous/release')
        cli.configure(self.options(profile=None))
        self.assertEqual((state / 'previous').read_text(), '/previous/release')
        self.assertEqual(self.commands, [])

    def test_cursor_configuration_preserves_endpoint(self):
        cli.ROOT.mkdir()
        path = cli.ROOT / 'layr.env'
        path.write_text('LAYR_MOONRAKER_URL=http://printer:7125\nLAYR_HIDE_CURSOR=0\n')
        options = self.options()
        options.cursor = 'hidden'
        with patch.object(cli, 'detect', return_value={}):
            cli.display_config(options)
        self.assertIn('LAYR_HIDE_CURSOR=1', path.read_text())
        self.assertIn('http://printer:7125', path.read_text())
        self.assertEqual(self.commands, [])

    def test_service_controls_only_touch_layr_units(self):
        cli.service_control('start', True)
        cli.service_control('stop', True)
        cli.service_control('restart', True)
        self.assertTrue(all(command[-1].startswith('layr-') for command, dry in self.commands))
        self.assertTrue(all(dry for command, dry in self.commands))

    def test_restart_active_kiosk_and_stop_existing_kiosk(self):
        with patch.object(cli, 'capture', side_effect=lambda *args: 'active' if args[1] == 'is-active' else 'layr-kiosk.service enabled'):
            cli.service_control('restart', True)
            cli.service_control('stop', True)
        self.assertIn((['sudo', 'systemctl', 'restart', 'layr-kiosk.service'], True), self.commands)
        self.assertIn((['sudo', 'systemctl', 'stop', 'layr-kiosk.service'], True), self.commands)

    def test_start_resumes_only_enabled_kiosk(self):
        with patch.object(cli, 'capture', side_effect=lambda *args: 'enabled' if args[1] == 'is-enabled' else ''):
            cli.service_control('start', True)
        self.assertIn('layr-display.sh', self.commands[-1][0][1])
        self.assertTrue(self.commands[-1][1])

    def test_start_does_not_silently_switch_active_klipperscreen(self):
        with patch.object(cli, 'capture', side_effect=lambda *args: 'enabled' if args[1] == 'is-enabled' else 'active'):
            with self.assertRaisesRegex(RuntimeError, 'KlipperScreen is active'):
                cli.service_control('start', True)
        self.assertEqual(len(self.commands), 1)
        self.assertEqual(self.commands[0][0][-1], 'layr-web.service')

    def test_different_owner_cannot_manage_installed_services(self):
        cli.ROOT.mkdir()
        with patch.object(cli.os, 'getuid', return_value=os.getuid() + 1):
            with self.assertRaisesRegex(RuntimeError, 'owner'):
                cli.require_owner()
        self.assertEqual(self.commands, [])

    def test_conflicting_version_is_not_bookworm(self):
        (self.root / 'etc/os-release').write_text('ID=debian\nVERSION_ID=13\nVERSION_CODENAME=bookworm\n')
        self.assertFalse(cli.detect(self.root)['supported'])

    def test_moonraker_probe_rejects_non_api_and_auth_failure(self):
        # Exercise the real probe rather than the fixture replacement.
        patch.stopall()
        for result in [SimpleNamespace(returncode=22, stdout='', stderr='401 unauthorized'), SimpleNamespace(returncode=0, stdout='<html>login</html>', stderr=''), SimpleNamespace(returncode=0, stdout='{"result":{}}', stderr='')]:
            with patch.object(cli.subprocess, 'run', return_value=result):
                self.assertFalse(cli.probe_moonraker('http://printer:7125')[0])
        result = SimpleNamespace(returncode=0, stdout='{"result":{"moonraker_version":"test"}}', stderr='')
        with patch.object(cli.subprocess, 'run', return_value=result):
            self.assertTrue(cli.probe_moonraker('http://printer:7125')[0])
    def menu(self, answers, effect=None):
        output = io.StringIO()
        with patch('sys.argv', ['layr']), patch.object(cli.sys.stdin, 'isatty', return_value=True), patch('builtins.input', side_effect=answers), patch.object(cli, 'dispatch', side_effect=effect) as dispatch, redirect_stdout(output):
            cli.main()
        return dispatch, output.getvalue()

    def test_menu_repeats_successful_navigation_until_exit(self):
        dispatch, output = self.menu(['1', '', '1', '', '0'])
        self.assertEqual([call.args[0].command for call in dispatch.call_args_list], ['status', 'status'])
        self.assertEqual(output.count('LAYR management'), 3)
        self.assertEqual(output.count('Operation completed'), 2)

    def test_backend_menu_returns_to_main_and_does_not_reuse_selection(self):
        dispatch, output = self.menu(['4', '4', '', '1', '', '4', '5', '', '4', '0', '0'])
        calls = [call.args[0] for call in dispatch.call_args_list]
        self.assertEqual([call.command for call in calls], ['backend', 'status', 'backend'])
        self.assertEqual([call.chromium_backend for call in calls], ['x11', None, 'wayland'])
        self.assertEqual(output.count('Operation completed'), 3)
        self.assertIn('0. Back', output)

    def test_backend_selection_defaults_and_recommendation_on_all_architectures(self):
        for arch in ('i386', 'amd64', 'armhf', 'arm64'):
            facts = {'architecture': arch}
            output = io.StringIO()
            with self.subTest(arch=arch), patch.object(cli.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value=''), redirect_stdout(output):
                value = cli.select_chromium_backend(self.options(yes=False), facts, 'kiosk')
                self.assertEqual(value, 'x11' if arch in ('i386', 'amd64') else 'wayland')
            if arch in ('i386', 'amd64'):
                self.assertIn('recommended for touch', output.getvalue())
            with patch.object(cli.sys.stdin, 'isatty', return_value=False):
                self.assertEqual(cli.select_chromium_backend(self.options(), facts, 'kiosk'), 'wayland')

    def test_intel_install_can_explicitly_choose_wayland(self):
        facts = cli.detect(self.root)
        with patch.object(cli.sys.stdin, 'isatty', return_value=True), patch('builtins.input', side_effect=['wayland', 'y']):
            cli.install(self.options(profile='kiosk', yes=False), facts)
        self.assertEqual(cli.configured_chromium_backend(), 'wayland')
        self.assertNotIn('xwayland', str(self.commands))

    def test_intel_interactive_install_accepts_recommended_x11(self):
        with patch.object(cli.sys.stdin, 'isatty', return_value=True), patch('builtins.input', side_effect=['', 'y']):
            cli.install(self.options(profile='kiosk', yes=False), cli.detect(self.root))
        self.assertEqual(cli.configured_chromium_backend(), 'x11')
        self.assertIn('xwayland', self.commands[2][0])
        self.assertNotIn('enable', str(self.commands))

    def test_existing_backend_is_preserved_even_in_interactive_intel_install(self):
        cli.ROOT.mkdir()
        path = cli.ROOT / 'layr.env'
        for backend in ('wayland', 'x11'):
            path.write_text(f'LAYR_CHROMIUM_BACKEND={backend}\n')
            with patch.object(cli.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value='') as prompt:
                self.assertEqual(cli.select_chromium_backend(self.options(yes=False), {'architecture': 'i386'}, 'kiosk'), backend)
                self.assertIn('[' + backend + ']', prompt.call_args.args[0])

    def test_x11_dependencies_are_preflighted_for_each_architecture(self):
        for arch in ('i386', 'amd64', 'armhf', 'arm64'):
            facts = cli.detect(self.root) | {'architecture': arch}
            with self.subTest(arch=arch):
                self.commands.clear()
                cli.install(self.options(profile='kiosk', chromium_backend='x11'), facts)
                self.assertIn('xwayland', self.commands[2][0])
                self.assertIn('polkitd', self.commands[2][0])
                self.assertNotIn('enable', str(self.commands))
                self.assertEqual(cli.configured_chromium_backend(), 'x11')

    def test_missing_xwayland_candidate_blocks_install_before_any_changes(self):
        facts = cli.detect(self.root)
        def capture(*args):
            return 'Candidate: (none)' if args[:3] == ('apt-cache', 'policy', 'xwayland') else self.fake_capture(*args)
        with patch.object(cli, 'capture', side_effect=capture), self.assertRaisesRegex(RuntimeError, 'xwayland'):
            cli.install(self.options(profile='kiosk', chromium_backend='x11'), facts)
        self.assertEqual(self.commands, [])
        self.assertFalse(cli.ROOT.exists())

    def test_invalid_backend_is_rejected_before_changes(self):
        with self.assertRaisesRegex(RuntimeError, 'wayland or x11'):
            cli.install(self.options(profile='kiosk', chromium_backend='auto'), cli.detect(self.root))
        self.assertFalse(cli.ROOT.exists())
        self.assertEqual(self.commands, [])

    def test_environment_backend_selection_and_explicit_cli_override(self):
        with patch.dict(os.environ, {'LAYR_CHROMIUM_BACKEND': 'x11'}):
            self.assertEqual(cli.select_chromium_backend(self.options(), {'architecture': 'i386'}, 'kiosk'), 'x11')
            self.assertEqual(cli.select_chromium_backend(self.options(chromium_backend='wayland'), {'architecture': 'i386'}, 'kiosk'), 'wayland')

    def backend_fixture(self):
        cli.ROOT.mkdir()
        path = cli.ROOT / 'layr.env'
        path.write_text('LAYR_PORT=8180\nLAYR_MOONRAKER_URL=http://192.168.15.14:7125\nLAYR_PROFILE=/home/tablet/browser\nLAYR_HIDE_CURSOR=1\nLAYR_CHROMIUM_BACKEND=wayland\n')
        (cli.ROOT / 'releases/working').mkdir(parents=True)
        (cli.ROOT / 'releases/working/index.html').write_text('working release')
        (cli.ROOT / 'current').symlink_to(cli.ROOT / 'releases/working')
        (cli.ROOT / 'state').mkdir()
        (cli.ROOT / 'state/previous').write_text('/previous/release')
        return path

    def test_backend_management_preserves_configuration_releases_and_current_process(self):
        path = self.backend_fixture()
        with patch.object(cli, 'capture', side_effect=lambda *args: 'layr-kiosk.service disabled' if args[:2] == ('systemctl', 'list-unit-files') else self.fake_capture(*args)):
            cli.backend_config(self.options(chromium_backend='x11'))
        saved = path.read_text()
        for value in ('LAYR_PORT=8180', 'http://192.168.15.14:7125', 'LAYR_PROFILE=/home/tablet/browser', 'LAYR_HIDE_CURSOR=1'):
            self.assertIn(value, saved)
        self.assertEqual(cli.configured_chromium_backend(), 'x11')
        self.assertEqual(saved.count('LAYR_CHROMIUM_BACKEND='), 1)
        self.assertEqual((cli.ROOT / 'current').resolve(), cli.ROOT / 'releases/working')
        self.assertEqual((cli.ROOT / 'state/previous').read_text(), '/previous/release')
        self.assertEqual(self.commands[0][0], ['sudo', 'systemctl', 'disable', 'layr-kiosk.service'])
        self.assertIn('xwayland', self.commands[1][0])
        self.assertNotIn('restart', str(self.commands))
        self.assertNotIn('enable', str(self.commands))

    def test_backend_management_cancellation_dry_run_and_package_failure_preserve_config(self):
        path = self.backend_fixture()
        original = path.read_text()
        with patch.object(cli.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value='n'), self.assertRaisesRegex(RuntimeError, 'Cancelled'):
            cli.backend_config(self.options(chromium_backend='x11', yes=False))
        self.assertEqual(self.commands, [])
        cli.backend_config(self.options(chromium_backend='x11', dry_run=True))
        self.assertTrue(all(dry for _, dry in self.commands))
        self.assertEqual(path.read_text(), original)
        with patch.object(cli, 'execute', side_effect=subprocess.CalledProcessError(1, 'apt-get')), self.assertRaises(subprocess.CalledProcessError):
            cli.backend_config(self.options(chromium_backend='x11'))
        self.assertEqual(path.read_text(), original)

    def test_backend_management_requires_privileges_before_packages_or_configuration(self):
        path = self.backend_fixture()
        original = path.read_text()
        with patch.object(cli, 'require_privileges', side_effect=RuntimeError('sudo authorization failed')), patch.object(cli, 'apt_plan') as plan, self.assertRaisesRegex(RuntimeError, 'sudo authorization failed'):
            cli.backend_config(self.options(chromium_backend='x11'))
        plan.assert_not_called()
        self.assertEqual(path.read_text(), original)
        self.assertEqual(self.commands, [])

    def test_running_service_backend_uses_the_service_process_not_callers_environment(self):
        child = subprocess.Popen([sys.executable, '-u', '-c', "import time; print('ready', flush=True); time.sleep(15)"], env=dict(os.environ, LAYR_CHROMIUM_BACKEND='x11'), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        try:
            readable, _, _ = select.select([child.stdout], [], [], 5)
            self.assertTrue(readable, 'service fixture did not finish exec')
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            with patch.object(cli, 'capture', return_value=str(child.pid)), patch.dict(os.environ, {'LAYR_CHROMIUM_BACKEND': 'wayland'}):
                self.assertEqual(REAL_RUNNING_BACKEND(), 'x11')
        finally:
            child.terminate()
            child.wait(timeout=2)
            child.stdout.close()

    def test_backend_change_invalidates_prior_service_validation_even_if_changed_back(self):
        self.backend_fixture()
        with patch.object(cli, 'capture', return_value='active'), patch.object(cli.sys.stdin, 'isatty', return_value=True), patch('builtins.input', side_effect=['VISIBLE', 'y']):
            cli.enable_kiosk(self.options())
        self.assertTrue(cli.display_confirmed())
        cli.backend_config(self.options(chromium_backend='x11'))
        self.assertFalse(cli.display_confirmed())
        cli.backend_config(self.options(chromium_backend='wayland'))
        self.assertFalse(cli.display_confirmed())
        record = json.loads((cli.ROOT / 'state/display-verification.json').read_text())
        self.assertIn('backend changed', record['invalidated_reason'])

    def test_manual_confirmation_record_never_qualifies_for_boot_startup(self):
        (cli.ROOT / 'state').mkdir(parents=True)
        path = cli.ROOT / 'state/display-verification.json'
        path.write_text(json.dumps(dict(machine_id=Path('/etc/machine-id').read_text().strip(), display='operator-confirmed', chromium_backend='x11', service='manual-cage')))
        self.assertFalse(cli.display_confirmed())

    def test_old_or_unverifiable_service_cannot_validate_new_backend(self):
        self.backend_fixture()
        cli.save_chromium_backend('x11')
        for actual in ('wayland', None):
            with self.subTest(actual=actual), patch.object(cli, 'running_service_backend', return_value=actual), patch.object(cli, 'capture', return_value='active'), patch.object(cli.sys.stdin, 'isatty', return_value=True), patch('builtins.input', side_effect=AssertionError('do not prompt')):
                with self.assertRaisesRegex(RuntimeError, 'Current service backend'):
                    cli.enable_kiosk(self.options())
        self.assertFalse((cli.ROOT / 'state/display-verification.json').exists())
        self.assertEqual(self.commands, [])

    def test_backend_status_and_diagnostics_show_saved_setting(self):
        self.backend_fixture().write_text('LAYR_CHROMIUM_BACKEND="x11"\n')
        with patch.object(cli, 'detect', return_value={}), patch.object(cli, 'run_probe', return_value=dict(returncode=0, stdout='', stderr='')):
            self.assertEqual(cli.status_snapshot()['installation']['chromium_backend'], 'x11')
            self.assertEqual(cli.kiosk_diagnostics()['chromium_backend'], 'x11')
        output = io.StringIO()
        with patch('sys.argv', ['layr', 'backend']), redirect_stdout(output):
            cli.main()
        self.assertIn('Configured Chromium backend: x11', output.getvalue())

    def test_menu_failure_is_acknowledged_and_never_repeats_uninstall(self):
        dispatch, output = self.menu(['9', '', '0'], RuntimeError('permission denied'))
        self.assertEqual(dispatch.call_count, 1)
        self.assertEqual(dispatch.call_args.args[0].command, 'uninstall')
        self.assertIn('Operation failed: permission denied', output)
        self.assertEqual(output.count('LAYR management'), 2)

    def test_menu_ctrl_c_cancels_action_without_retrying(self):
        dispatch, output = self.menu(['9', '', '0'], KeyboardInterrupt())
        self.assertEqual(dispatch.call_count, 1)
        self.assertIn('Operation cancelled', output)

    def test_menu_back_options_perform_no_operations(self):
        dispatch, output = self.menu(['2', '0', '3', '0', '4', '0', '5', '0', '0'])
        dispatch.assert_not_called()
        self.assertIn('0. Back', output)
        self.assertNotIn('2. KlipperScreen', output)

    def test_invalid_selections_do_not_dispatch(self):
        dispatch, output = self.menu(['nonsense', '999', '2', 'bad', '0', '0'])
        dispatch.assert_not_called()
        self.assertIn('Invalid selection', output)

    def test_eof_and_ctrl_c_exit_without_traceback(self):
        for answers in ([EOFError()], [KeyboardInterrupt()], ['2', EOFError()], ['1', EOFError()]):
            with self.subTest(answers=answers):
                dispatch, output = self.menu(answers)
                self.assertNotIn('Traceback', output)
                self.assertLessEqual(dispatch.call_count, 1)

    def test_noninteractive_no_command_never_reads_menu_input(self):
        output = io.StringIO()
        with patch('sys.argv', ['layr']), patch.object(cli.sys.stdin, 'isatty', return_value=False), patch('builtins.input', side_effect=AssertionError('no terminal')), redirect_stdout(output):
            cli.main()
        self.assertIn('usage:', output.getvalue())
        self.assertEqual(self.commands, [])

    def test_status_is_readable_and_json_is_explicit(self):
        for command, json_flag in [('status', False), ('status', True), ('diagnose', False)]:
            output = io.StringIO()
            args = ['layr', command] + (['--json'] if json_flag else [])
            with self.subTest(args=args), patch('sys.argv', args), patch.object(cli, 'detect', return_value={'services': {'layr-kiosk.service': 'active'}}), redirect_stdout(output):
                cli.main()
            if command == 'diagnose' or json_flag:
                data = json.loads(output.getvalue())
                self.assertEqual(data['kiosk_process'], 'running')
                self.assertIn('unverified', data['graphical_display'])
                self.assertIn('unverified', data['touchscreen_function'])
            else:
                self.assertIn('Kiosk process: running', output.getvalue())
                self.assertIn('Graphical display: unverified', output.getvalue())
                self.assertFalse(output.getvalue().lstrip().startswith('{'))

    def test_udev_identifies_generic_digitizer_without_claiming_function(self):
        device = self.root / 'sys/class/input/event3/device'
        device.mkdir(parents=True)
        (device / 'name').write_text('Generic HID Digitizer')
        with patch.object(cli, 'capture', side_effect=lambda *args: 'ID_INPUT_TOUCHSCREEN=1' if args[0] == 'udevadm' else self.fake_capture(*args)):
            facts = cli.detect(self.root)
        self.assertIn('identified by udev', facts['touchscreen'])
        self.assertEqual(facts['touch_devices'][0]['name'], 'Generic HID Digitizer')
        self.assertEqual(facts['touchscreen_function'], 'unverified')

    def test_missing_touchscreen_does_not_prevent_remote_i386_preview_install(self):
        (self.root / 'proc/bus/input/devices').write_text('N: Name="Keyboard"\n')
        with patch.object(cli, 'capture', side_effect=lambda *args: 'i386' if args[0] == 'dpkg' else self.fake_capture(*args)):
            facts = cli.detect(self.root)
            cli.install(self.options(profile='kiosk'), facts)
        self.assertIn('not identified', facts['touchscreen'])
        self.assertEqual(facts['touchscreen_function'], 'unverified')
        self.assertIn('--headless', self.commands[1][0])
        self.assertIn('--kiosk-only', self.commands[-1][0])
        self.assertNotIn('enable', str(self.commands))

    def test_web_http_failure_prevents_all_kiosk_setup(self):
        with patch.object(cli, 'probe_web', return_value=dict(ok=False, error='connection refused')):
            with self.assertRaisesRegex(RuntimeError, 'local HTTP validation failed'):
                cli.install(self.options(profile='kiosk'), cli.detect(self.root))
        self.assertEqual(len(self.commands), 2)
        self.assertNotIn('chromium', str(self.commands))
        self.assertNotIn('--kiosk-only', str(self.commands))

    def test_kiosk_phase_failure_keeps_web_phase_and_never_enables_boot(self):
        calls = []
        def execute(args, dry=False):
            calls.append(list(map(str, args)))
            if len(calls) == 3:
                raise subprocess.CalledProcessError(1, 'apt-get')
        with patch.object(cli, 'execute', side_effect=execute):
            with self.assertRaisesRegex(RuntimeError, 'Web service is installed; kiosk setup failed'):
                cli.install(self.options(profile='kiosk'), cli.detect(self.root))
        self.assertIn('--headless', calls[1])
        self.assertNotIn('enable', str(calls))
        self.assertNotIn('layr-display.sh', str(calls))

    def test_active_process_cannot_enable_boot_without_physical_confirmation(self):
        with patch.object(cli, 'capture', return_value='active'), patch.object(cli.sys.stdin, 'isatty', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'physical display confirmation'):
                cli.enable_kiosk(self.options())
        self.assertEqual(self.commands, [])
        self.assertFalse((cli.ROOT / 'state/display-verification.json').exists())

    def test_flashing_cursor_is_not_a_visible_ui_confirmation(self):
        with patch.object(cli, 'capture', return_value='active'), patch.object(cli.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value='flashing cursor'):
            with self.assertRaisesRegex(RuntimeError, 'not confirmed'):
                cli.enable_kiosk(self.options())
        self.assertEqual(self.commands, [])

    def test_explicit_operator_confirmation_enables_only_own_kiosk(self):
        with patch.object(cli, 'capture', return_value='active'), patch.object(cli.sys.stdin, 'isatty', return_value=True), patch('builtins.input', side_effect=['VISIBLE', 'n']):
            cli.enable_kiosk(self.options())
        self.assertEqual(self.commands[-1][0], ['sudo', 'systemctl', 'enable', 'layr-kiosk.service'])
        record = json.loads((cli.ROOT / 'state/display-verification.json').read_text())
        self.assertEqual(record['touchscreen'], 'unverified')
        self.assertTrue(cli.display_confirmed())
        record['machine_id'] = 'another-device'
        (cli.ROOT / 'state/display-verification.json').write_text(json.dumps(record))
        self.assertFalse(cli.display_confirmed())

    def test_diagnostics_keep_actual_stderr_and_exit_codes(self):
        result = SimpleNamespace(returncode=1, stdout='', stderr='failed to open /dev/dri/card0: Permission denied')
        with patch.object(cli.subprocess, 'run', return_value=result):
            data = cli.kiosk_diagnostics()
        self.assertEqual(data['probes'][0]['returncode'], 1)
        self.assertIn('Permission denied', data['probes'][0]['stderr'])
        self.assertIn('do not establish visible rendering', data['interpretation'])

    def test_local_http_must_serve_the_installed_index(self):
        (cli.ROOT / 'current').mkdir(parents=True)
        (cli.ROOT / 'current/index.html').write_text('<title>LAYR</title>\n')
        with patch.object(cli, 'run_probe', return_value=dict(returncode=0, stdout='<title>Other app</title>', stderr='')):
            self.assertFalse(REAL_PROBE_WEB()['ok'])
        with patch.object(cli, 'run_probe', return_value=dict(returncode=0, stdout='<title>LAYR</title>', stderr='')):
            self.assertTrue(REAL_PROBE_WEB()['ok'])

    def test_fresh_kiosk_only_dry_run_does_not_require_web_files(self):
        env = dict(os.environ, LAYR_HOME=str(cli.ROOT), HOME=str(self.root))
        result = subprocess.run(['bash', str(cli.DEPLOY / 'install.sh'), '--kiosk-only', '--dry-run', '--yes', '--dist', str(self.root / 'dist')], text=True, capture_output=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('disable layr-kiosk.service', result.stdout)
        self.assertFalse(cli.ROOT.exists())

    def test_process_failure_during_physical_confirmation_never_enables_boot(self):
        with patch.object(cli, 'capture', side_effect=['active', 'inactive']), patch.object(cli.sys.stdin, 'isatty', return_value=True), patch('builtins.input', side_effect=['VISIBLE', 'y']):
            with self.assertRaisesRegex(RuntimeError, 'stopped during confirmation'):
                cli.enable_kiosk(self.options())
        self.assertEqual(self.commands, [])
        self.assertFalse((cli.ROOT / 'state/display-verification.json').exists())

    def test_elan_touch_capabilities_on_32_and_64_bit_kernels(self):
        event = self.root / 'sys/class/input/event0/device'
        (event / 'capabilities').mkdir(parents=True)
        (event / 'name').write_text('ELAN1001:00 04F3:2029')
        (event / 'properties').write_text('2')
        (self.root / 'proc/bus/input/devices').write_text('N: Name="ELAN1001:00 04F3:2029"\n')
        for arch, mask in [('i686', '600000 3'), ('x86_64', '60000000000003')]:
            with self.subTest(kernel=arch):
                (event / 'capabilities/abs').write_text(mask)
                with patch.object(cli, 'capture', side_effect=lambda *args: arch if args[0] == 'uname' else self.fake_capture(*args)):
                    facts = cli.detect(self.root)
                self.assertEqual(facts['touch_devices'][0]['node'], '/dev/input/event0')
                self.assertEqual(facts['touch_devices'][0]['name'], 'ELAN1001:00 04F3:2029')
                self.assertIn('kernel input interfaces', facts['touchscreen'])
                self.assertEqual(facts['touchscreen_function'], 'unverified')
        (event / 'properties').write_text('1')  # Touchpad/pointer, not direct touch.
        self.assertEqual(cli.detect(self.root)['touch_devices'], [])


class PrivilegeTests(unittest.TestCase):
    """Run the actual shared Bash validator with isolated escalation executables."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.log = self.root / 'sudo.log'
        for command in ('bash', 'dirname', 'awk', 'grep'):
            (self.bin / command).symlink_to(shutil.which(command))
        (self.bin / 'id').write_text('#!/bin/sh\ncase "$1" in -u) echo 1000 ;; -un) echo tabletuser ;; esac\n')
        (self.bin / 'id').chmod(0o755)
        self.env = dict(PATH=str(self.bin), HOME=str(self.root), LAYR_HOME=str(self.root / 'layr'), SUDO_TEST_LOG=str(self.log))
        self.environ = patch.dict(os.environ, self.env)
        self.environ.start()
        self.addCleanup(self.environ.stop)
        self.root_patch = patch.object(cli, 'ROOT', self.root / 'layr')
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def sudo(self, mode='ok'):
        path = self.bin / 'sudo'
        path.write_text('''#!/bin/sh
printf '%s\\n' "$*" >> "$SUDO_TEST_LOG"
case "$*" in
  '-v' | '-n -v') [ "$SUDO_TEST_MODE" != denied ]; exit $? ;;
  '-n -- id -u')
    [ "$SUDO_TEST_MODE" = cannot_escalate ] && exit 1
    if [ "$SUDO_TEST_MODE" = wrong_uid ]; then echo 1001; else echo 0; fi
    exit 0 ;;
esac
exit 99
''')
        path.chmod(0o755)
        os.environ['SUDO_TEST_MODE'] = mode

    def test_missing_sudo_has_actionable_minimal_debian_instructions(self):
        with self.assertRaises(RuntimeError) as caught:
            cli.require_privileges()
        for text in ('sudo is not installed', 'su -', 'apt-get install sudo', 'usermod -aG sudo tabletuser', 'log back in', 'this check made no changes'):
            self.assertIn(text, str(caught.exception))
        self.assertFalse(cli.ROOT.exists())

    def test_sudo_denied_does_not_attempt_root_command(self):
        self.sudo('denied')
        with self.assertRaisesRegex(RuntimeError, 'authorization failed'):
            cli.require_privileges()
        self.assertEqual(self.log.read_text().splitlines(), ['-n -v'])

    def test_authenticated_sudo_must_actually_execute_as_root(self):
        self.sudo('cannot_escalate')
        with self.assertRaisesRegex(RuntimeError, 'cannot execute commands as root'):
            cli.require_privileges()
        self.assertEqual(self.log.read_text().splitlines(), ['-n -v', '-n -- id -u'])

    def test_non_root_sudo_target_is_rejected(self):
        self.sudo('wrong_uid')
        with self.assertRaisesRegex(RuntimeError, 'UID 1001, not root'):
            cli.require_privileges()

    def test_nopasswd_or_cached_sudo_is_accepted_without_group_assumption(self):
        self.sudo()
        cli.require_privileges()
        self.assertEqual(self.log.read_text().splitlines(), ['-n -v', '-n -- id -u'])
        self.assertFalse(cli.ROOT.exists())

    def test_interactive_terminal_allows_sudo_authentication(self):
        self.sudo()
        master, slave = pty.openpty()
        try:
            result = subprocess.run(['bash', '-c', '. "$1"; LAYR_PRIVILEGE_INTERACTIVE=1; require_not_root', 'test', str(cli.DEPLOY / 'lib.sh')], stdin=slave, capture_output=True, text=True, timeout=10)
        finally:
            os.close(master)
            os.close(slave)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.log.read_text().splitlines(), ['-v', '-n -- id -u'])

    def test_missing_sudo_blocks_preflight_and_install_before_any_prompt(self):
        for command in ('preflight', 'install', 'update', 'repair'):
            with self.subTest(command=command), patch('sys.argv', ['layr', command]), patch('builtins.input', side_effect=AssertionError('must not prompt')), patch.object(cli, 'detect', side_effect=AssertionError('must fail before detection')):
                with self.assertRaisesRegex(RuntimeError, 'sudo is not installed'):
                    cli.main()
        self.assertFalse(cli.ROOT.exists())

    def test_denied_sudo_blocks_every_privileged_cli_operation(self):
        self.sudo('denied')
        for command in ('preflight', 'install', 'update', 'repair', 'start', 'stop', 'restart', 'switch', 'rollback', 'recover', 'uninstall'):
            args = ['layr', command] + (['layr'] if command == 'switch' else []) + ['--yes']
            with self.subTest(command=command), patch('sys.argv', args), patch('builtins.input', side_effect=AssertionError('must not prompt')), patch.object(cli, 'execute', side_effect=AssertionError('must not mutate')):
                with self.assertRaisesRegex(RuntimeError, 'authorization failed'):
                    cli.main()
        self.assertFalse(cli.ROOT.exists())
        self.assertTrue(all(line == '-n -v' for line in self.log.read_text().splitlines()))

    def test_root_cli_execution_is_rejected_before_escalation(self):
        for command in ('preflight', 'install', 'update', 'repair', 'start', 'stop', 'restart', 'switch', 'rollback', 'recover', 'uninstall'):
            args = ['layr', command] + (['layr'] if command == 'switch' else [])
            with self.subTest(command=command), patch('sys.argv', args), patch.object(cli.os, 'geteuid', return_value=0), patch('builtins.input', side_effect=AssertionError('must not prompt')):
                with self.assertRaisesRegex(RuntimeError, 'not root'):
                    cli.main()
        self.assertFalse(self.log.exists())
        self.assertFalse(cli.ROOT.exists())

    def test_shell_install_and_recovery_stop_before_local_mutations(self):
        for script, args in [('install.sh', []), ('rollback.sh', []), ('uninstall.sh', []), ('layr-display.sh', ['to-layr'])]:
            with self.subTest(script=script):
                result = subprocess.run(['bash', str(cli.DEPLOY / script), *args, '--yes'], capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('sudo is not installed', result.stderr)
                self.assertFalse(cli.ROOT.exists())

    def test_read_only_status_does_not_require_sudo(self):
        with patch('sys.argv', ['layr', 'status']), patch.object(cli, 'detect', return_value={}), patch.object(cli, 'execute'):
            cli.main()
        self.assertFalse(cli.ROOT.exists())

    def test_root_privilege_api_is_rejected_without_using_sudo(self):
        with patch.object(cli.os, 'geteuid', return_value=0):
            with self.assertRaisesRegex(RuntimeError, 'not root'):
                cli.require_privileges()
        self.assertFalse(self.log.exists())


class ChromiumLauncherTests(unittest.TestCase):
    """Execute the real launcher with isolated compositor/browser boundaries."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for name in ('bash', 'dirname', 'id', 'mkdir', 'seq', 'sed', 'python3', 'tr', 'readlink', 'basename'):
            (self.bin / name).symlink_to(shutil.which(name))
        self.write('curl', 'exit 0')
        self.write('chromium', 'printf "%s\\n" "$@" > "$TEST_ROOT/browser.args"\nprintf "%s\\n" "${DISPLAY:-unset}" > "$TEST_ROOT/browser.display"')
        self.write('cage', '''printf '%s\\n' "$@" > "$TEST_ROOT/cage.args"
while [ "$1" != -- ]; do shift; done
shift
if [ "${TEST_CAGE_XWAYLAND:-1}" = 1 ]; then export DISPLAY=:77; else unset DISPLAY; fi
exec "$@"
''')
        self.write('Xwayland', 'exit 0')
        self.profile = self.root / 'profile with spaces'
        (self.profile / 'Default').mkdir(parents=True)
        self.preferences = self.profile / 'Default/Preferences'
        self.preferences.write_text('{"exited_cleanly":true,"exit_type":"Normal","touch":"saved"}')
        self.layr_home = self.root / 'layr'
        (self.layr_home / 'releases/working').mkdir(parents=True)
        (self.layr_home / 'releases/working/index.html').write_text('working')
        (self.layr_home / 'current').symlink_to(self.layr_home / 'releases/working')
        self.env = dict(PATH=str(self.bin), HOME=str(self.root), TEST_ROOT=str(self.root), LAYR_HOME=str(self.layr_home), LAYR_PROFILE=str(self.profile), LAYR_PORT='8180', LAYR_MOONRAKER_URL='http://192.168.15.14:7125', LAYR_HIDE_CURSOR='0')

    def write(self, name, code):
        path = self.bin / name
        path.write_text('#!/bin/bash\nset -eu\n' + code + '\n')
        path.chmod(0o755)

    def launch(self, **values):
        return subprocess.run([str(self.bin / 'bash'), str(cli.DEPLOY / 'layr-kiosk.sh')], env=self.env | values, capture_output=True, text=True, timeout=5)

    def test_existing_arm_launch_defaults_to_wayland_without_xwayland(self):
        (self.bin / 'Xwayland').unlink()
        result = self.launch()
        self.assertEqual(result.returncode, 0, result.stderr)
        args = (self.root / 'browser.args').read_text().splitlines()
        self.assertIn('--ozone-platform=wayland', args)
        self.assertNotIn('--ozone-platform=x11', args)

    def test_x11_launcher_uses_cage_display_and_preserves_profile_url_and_release(self):
        previous = self.preferences.read_text()
        result = self.launch(LAYR_CHROMIUM_BACKEND='x11')
        self.assertEqual(result.returncode, 0, result.stderr)
        args = (self.root / 'browser.args').read_text().splitlines()
        self.assertIn('--ozone-platform=x11', args)
        self.assertIn('--user-data-dir=' + str(self.profile), args)
        self.assertIn('--touch-events=enabled', args)
        self.assertIn('moonraker=http%3A%2F%2F192.168.15.14%3A7125&layr_build=working', args[-1])
        self.assertEqual((self.root / 'browser.display').read_text().strip(), ':77')
        self.assertEqual(self.preferences.read_text(), previous)
        self.assertEqual((self.layr_home / 'current').resolve(), self.layr_home / 'releases/working')
        self.assertNotIn('--no-sandbox', args)

    def test_missing_xwayland_fails_before_browser_or_profile_changes(self):
        (self.bin / 'Xwayland').unlink()
        previous = self.preferences.read_text()
        result = self.launch(LAYR_CHROMIUM_BACKEND='x11')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('requires XWayland', result.stderr)
        self.assertFalse((self.root / 'browser.args').exists())
        self.assertEqual(self.preferences.read_text(), previous)

    def test_cage_without_xwayland_display_reports_precise_error(self):
        result = self.launch(LAYR_CHROMIUM_BACKEND='x11', TEST_CAGE_XWAYLAND='0', DISPLAY=':unrelated-desktop')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Cage did not provide an XWayland DISPLAY', result.stderr)
        self.assertFalse((self.root / 'browser.args').exists())

    def test_invalid_or_empty_backend_never_silently_falls_back(self):
        for value in ('', 'invalid', 'X11'):
            result = self.launch(LAYR_CHROMIUM_BACKEND=value)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('must be wayland or x11', result.stderr)
            self.assertFalse((self.root / 'browser.args').exists())


class KioskSessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.runtime = Path(self.temp.name)
        self.runtime.chmod(0o700)
        self.env = dict(XDG_RUNTIME_DIR=str(self.runtime), XDG_SESSION_ID='c42', XDG_SESSION_TYPE='wayland', XDG_SESSION_CLASS='user', XDG_SEAT='seat0', XDG_VTNR='7')
        self.properties = dict(User=str(os.getuid()), Leader=str(os.getpid()), Seat='seat0', VTNr='7', Type='wayland', Class='user', Remote='no')

    def validate(self, properties=None, env=None):
        values = properties or self.properties
        result = '\n'.join(f'{key}={value}' for key, value in values.items())
        with patch.object(session.os, 'isatty', return_value=True), patch.object(session.os, 'ttyname', return_value='/dev/tty7'), patch.object(session, 'checked', side_effect=[result, '']) as checked, patch.object(session.subprocess, 'run', return_value=SimpleNamespace(returncode=3)):
            value = session.validate_session(env or self.env)
        return value, checked

    def test_local_logind_session_activated_once_as_its_owner(self):
        value, checked = self.validate()
        self.assertEqual(value, 'c42')
        self.assertEqual(checked.call_count, 2)
        self.assertEqual(checked.call_args.args[0], ['loginctl', 'activate', 'c42'])

    def test_rejects_borrowed_remote_or_wrong_vt_session_before_activation(self):
        for key, value in [('User', str(os.getuid() + 1)), ('Leader', '1'), ('Seat', ''), ('VTNr', '1'), ('Remote', 'yes'), ('Type', 'tty'), ('Class', 'background')]:
            with self.subTest(key=key):
                values = self.properties | {key: value}
                with self.assertRaisesRegex(RuntimeError, 'Wrong logind session'):
                    self.validate(values)

    def test_missing_session_id_never_borrows_an_ssh_session(self):
        with self.assertRaisesRegex(RuntimeError, 'XDG_SESSION_ID'):
            self.validate(env=self.env | {'XDG_SESSION_ID': ''})

    def test_refuses_root_renderer_session(self):
        with patch.object(session.os, 'getuid', return_value=0), self.assertRaisesRegex(RuntimeError, 'not root'):
            session.validate_session(self.env)

    def test_refuses_direct_launch_from_ssh_tty(self):
        with patch.object(session.os, 'isatty', return_value=True), patch.object(session.os, 'ttyname', return_value='/dev/pts/2'), self.assertRaisesRegex(RuntimeError, 'controlling /dev/tty7'):
            session.validate_session(self.env)

    def test_private_runtime_directory_is_required_without_chmod_workaround(self):
        self.runtime.chmod(0o755)
        with self.assertRaisesRegex(RuntimeError, 'private directory'):
            self.validate()
        self.assertEqual(self.runtime.stat().st_mode & 0o777, 0o755)

    def test_logind_activation_denial_is_not_hidden_by_seatd_fallback(self):
        values = '\n'.join(f'{key}={value}' for key, value in self.properties.items())
        with patch.object(session.os, 'isatty', return_value=True), patch.object(session.os, 'ttyname', return_value='/dev/tty7'), patch.object(session, 'checked', side_effect=[values, RuntimeError('Could not activate session: Permission denied')]), patch.object(session.subprocess, 'run', return_value=SimpleNamespace(returncode=3)):
            with self.assertRaisesRegex(RuntimeError, 'Permission denied'):
                session.validate_session(self.env)

    def test_backend_override_is_rejected_before_session_activation(self):
        with patch.dict(os.environ, {'LIBSEAT_BACKEND': 'seatd'}), patch.object(session, 'validate_session') as validate:
            with self.assertRaisesRegex(RuntimeError, 'seatd fallback is not used'):
                session.main()
        validate.assert_not_called()

    def runner(self, child_code, extra=''):
        loader = f"import importlib.util,sys,subprocess; s=importlib.util.spec_from_file_location('session', {str(cli.DEPLOY / 'layr-session.py')!r}); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
        return loader + extra + f"sys.exit(m.supervise([sys.executable, '-u', '-c', {child_code!r}], grace=0.2))"

    def test_actual_renderer_failure_status_and_stderr_propagate(self):
        result = subprocess.run([sys.executable, '-c', self.runner("import sys; print('Unable to create the wlroots backend', file=sys.stderr); sys.exit(17)")], text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 17)
        self.assertIn('Unable to create the wlroots backend', result.stderr)
        self.assertIn('exit=17', result.stderr)

    def test_unexpected_clean_renderer_exit_is_not_a_startup_success(self):
        result = subprocess.run([sys.executable, '-c', self.runner('pass')], text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertIn('graphical readiness was not established', result.stderr)

    def test_pam_like_sibling_does_not_block_failed_renderer_reaping(self):
        pid_file = self.runtime / 'pam-child.pid'
        loader = f"import importlib.util,sys,subprocess,pathlib; s=importlib.util.spec_from_file_location('session', {str(cli.DEPLOY / 'layr-session.py')!r}); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)"
        code = loader + f"\nhelper=subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\npathlib.Path({str(pid_file)!r}).write_text(str(helper.pid))\ntry:\n result=m.supervise([sys.executable, '-c', 'import sys; sys.exit(23)'], grace=0.2)\nfinally:\n helper.terminate()\n helper.wait(timeout=2)\nsys.exit(result)\n"
        try:
            result = subprocess.run([sys.executable, '-c', code], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=5)
        except subprocess.TimeoutExpired:
            if pid_file.exists():
                os.kill(int(pid_file.read_text()), signal.SIGKILL)
            raise
        self.assertEqual(result.returncode, 23, result.stderr)

    def test_shutdown_is_bounded_when_renderer_ignores_sigterm(self):
        code = self.runner("import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print('ready', flush=True); time.sleep(60)")
        process = subprocess.Popen([sys.executable, '-u', '-c', code], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            readable, _, _ = select.select([process.stdout], [], [], 5)
            self.assertTrue(readable, 'renderer did not start')
            self.assertEqual(process.stdout.readline().strip(), 'ready')
            start = time.monotonic()
            process.terminate()
            stdout, stderr = process.communicate(timeout=4)
            self.assertEqual(process.returncode, 0, stderr)
            self.assertLess(time.monotonic() - start, 3)
            self.assertIn('stop grace expired', stderr)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()

    def test_unit_uses_owned_pam_logind_and_bounded_shutdown(self):
        unit = (cli.DEPLOY / 'systemd/layr-kiosk.service.in').read_text()
        pam = (cli.DEPLOY / 'pam/layr-kiosk').read_text()
        self.assertIn('User=@USER@', unit)
        self.assertIn('PAMName=layr-kiosk', unit)
        self.assertIn('Environment=LIBSEAT_BACKEND=logind', unit)
        self.assertIn('Environment=XDG_SEAT=seat0', unit)
        self.assertIn('Environment=XDG_VTNR=7', unit)
        self.assertIn('layr-session.py', unit)
        self.assertIn('KillMode=mixed', unit)
        self.assertIn('TimeoutStopSec=10s', unit)
        self.assertIn('Restart=no', unit)
        self.assertNotIn('chvt', unit)
        self.assertNotIn('User=root', unit)
        self.assertNotIn('--no-sandbox', unit)
        self.assertNotIn('SupplementaryGroups=video', unit)
        self.assertIn('session required pam_systemd.so type=wayland class=user', pam)
        self.assertNotIn('pam_permit', pam)


class ShellLifecycleTests(unittest.TestCase):
    def test_real_shell_fresh_repeat_upgrade_and_rollback(self):
        deploy = Path(__file__).resolve().parents[1] / 'deploy'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home = root / 'home'
            binary = root / 'bin'
            home.mkdir()
            binary.mkdir()
            log = root / 'commands'
            # Only sudo's external boundary is mocked. File releases, env writes,
            # management copies and rollback symlinks execute normally.
            (binary / 'sudo').write_text('''#!/bin/bash
printf '%s\\n' "$*" >> "$TEST_LOG"
case "$*" in
  '-n -v' | '-v') exit 0 ;;
  '-n -- id -u') printf '0\\n'; exit 0 ;;
esac
case "$1" in
  ln) shift; exec /usr/bin/ln -sfn "$2" "$TEST_BIN/layr" ;;
  rm) if [ "$3" = /usr/local/bin/layr ]; then exec /usr/bin/rm -f "$TEST_BIN/layr"; fi ;;
esac
exit 0
''')
            (binary / 'readlink').write_text('''#!/bin/bash
if [ "$1" = /usr/local/bin/layr ]; then
  exec /usr/bin/readlink "$TEST_BIN/layr"
fi
exec /usr/bin/readlink "$@"
''')
            (binary / 'systemctl').write_text('#!/bin/bash\nexit 1\n')
            for script in binary.iterdir():
                script.chmod(0o755)
            env = dict(os.environ, HOME=str(home), PATH=str(binary) + ':' + os.environ['PATH'], TEST_LOG=str(log), TEST_BIN=str(binary))
            env.pop('LAYR_HOME', None)
            def run(script, *args):
                result = subprocess.run(['bash', str(deploy / script), *args], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return result
            dist = root / 'dist'
            dist.mkdir()
            (dist / 'index.html').write_text('version one')
            run('install.sh', '--dist', str(dist), '--headless', '--yes')
            current = home / 'layr/current'
            first = current.resolve()
            self.assertEqual((first / 'index.html').read_text(), 'version one')
            self.assertTrue((home / 'layr/management/layr').exists())
            self.assertTrue(os.access(binary / 'layr', os.X_OK))
            self.assertEqual((binary / 'layr').resolve(), home / 'layr/management/layr')
            master, slave = pty.openpty()
            try:
                os.write(master, b'1\n\n1\n\n4\n0\n0\n')
                menu = subprocess.run(['layr'], env=env, stdin=slave, capture_output=True, text=True, timeout=15)
                self.assertEqual(menu.returncode, 0, menu.stderr)
                for label in ('LAYR status', 'Start / stop / restart', 'Configure Moonraker', 'Display and touchscreen', '0. Exit'):
                    self.assertIn(label, menu.stdout)
                self.assertEqual(menu.stdout.count('LAYR management'), 4)
                self.assertEqual(menu.stdout.count('Operation completed'), 2)
            finally:
                os.close(master)
                os.close(slave)
            other_home = root / 'other-home'
            other_home.mkdir()
            bound = subprocess.run(['layr', 'recover', '--dry-run'], env=dict(env, HOME=str(other_home)), capture_output=True, text=True)
            self.assertEqual(bound.returncode, 0, bound.stderr)

            run('install.sh', '--dist', str(dist), '--headless', '--yes')
            second = current.resolve()
            self.assertNotEqual(first, second)
            (dist / 'index.html').write_text('version two')
            run('install.sh', '--dist', str(dist), '--headless', '--moonraker', 'http://remote:7125', '--yes')
            self.assertEqual((current / 'index.html').read_text(), 'version two')
            run('rollback.sh', '--yes')
            self.assertEqual(current.resolve(), second)
            self.assertEqual((current / 'index.html').read_text(), 'version one')
            self.assertIn('http://remote:7125', (home / 'layr/layr.env').read_text())
            self.assertNotIn('KlipperScreen', log.read_text())
            self.assertNotIn('layr-kiosk.service', log.read_text())
            result = subprocess.run(['bash', str(deploy / 'layr-display.sh'), 'to-klipperscreen', '--yes'], env=env, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('current display was left unchanged', result.stderr)
            # Kiosk-only staging must not create another web release or lose rollback history.
            before_release = current.resolve()
            previous_file = home / 'layr/state/previous'
            before_previous = previous_file.read_text()
            run('install.sh', '--kiosk-only', '--dist', str(dist), '--yes')
            self.assertEqual(current.resolve(), before_release)
            self.assertEqual(previous_file.read_text(), before_previous)
            self.assertIn('systemctl disable layr-kiosk.service', log.read_text())
            self.assertNotIn('systemctl enable layr-kiosk.service', log.read_text())
            run('uninstall.sh', '--yes')
            self.assertFalse((binary / 'layr').exists())
            self.assertTrue((home / 'layr/current/index.html').exists())



if __name__ == '__main__':
    unittest.main()
