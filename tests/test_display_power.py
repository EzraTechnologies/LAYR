"""Display-power tests use private sysfs/input fixtures; never host backlights/systemd."""
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
from contextlib import redirect_stdout
from types import SimpleNamespace
import unittest
from unittest.mock import patch

DEPLOY = Path(__file__).resolve().parents[1] / 'deploy'


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


power = load('power_test', DEPLOY / 'layr-display-power.py')
cli = load('power_cli_test', DEPLOY / 'layr')


class HardwareFixture:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.paths = power.Paths(self.root)
        patch.object(power, 'ROOT_UID', os.getuid()).start()
        self.addCleanup(patch.stopall)
        for path in ('etc', 'proc', 'sys/class/backlight', 'sys/class/input', 'sys/class/drm/card0-eDP-1', 'dev/input'):
            (self.root / path).mkdir(parents=True)
        (self.root / 'etc/os-release').write_text('ID=debian\nVERSION_ID=12\n')
        (self.root / 'etc/machine-id').write_text('test-machine\n')
        (self.root / 'proc/cpuinfo').write_text('vendor_id : GenuineIntel\n')
        (self.root / 'sys/class/drm/card0-eDP-1/status').write_text('connected\n')
        self.panel = self.root / 'sys/devices/pci0000:00/0000:00:02.0/panel/backlight/vendor_panel'
        self.panel.mkdir(parents=True)
        (self.panel.parents[2] / 'driver').symlink_to(self.root / 'sys/bus/pci/drivers/i915')
        (self.root / 'sys/class/backlight/vendor_panel').symlink_to(self.panel)
        for name, value in [('max_brightness',7812),('brightness',7812),('bl_power',0)]:
            (self.panel / name).write_text(str(value))
        self.add_input('event17', 'gpio-keys', [116])
        self.add_input('event2', 'ELAN1001:00 04F3:2029', [330], [0,1,47,53,54,57], 2)
        self.commands = []
        self.arch = 'i386'

    def add_input(self, event, name, keys, absolute=(), properties=0, relative=0):
        device = self.root / f'sys/class/input/{event}/device'
        (device / 'capabilities').mkdir(parents=True,exist_ok=True)
        (device / 'name').write_text(name)
        (device / 'properties').write_text(format(properties,'x'))
        for field, values in [('key', keys), ('abs', absolute)]:
            value = sum(1 << key for key in values)
            bits = 64 if power.platform.machine() in ('x86_64','aarch64','arm64') else 32
            words=[]
            while value:
                words.append(format(value & ((1 << bits)-1),'x'));value >>= bits
            (device / ('capabilities/'+field)).write_text(' '.join(reversed(words)) or '0')
        (device / 'capabilities/rel').write_text(format(relative,'x'))

    def probe(self, args, check=True):
        self.commands.append(args)
        code, output = 0, ''
        if args[0] == 'dpkg': output = self.arch
        elif args[0] == 'udevadm': output = 'ID_SEAT=seat0\n'
        elif args[:3] == ['systemctl','is-active','--quiet']:
            code = 0 if args[-1] == power.KIOSK else 3
        return SimpleNamespace(returncode=code, stdout=output, stderr='')

    def support(self):
        return power.discover(self.root,self.probe)

    def manager(self):
        return power.Manager(self.paths,self.probe)

    def journal(self):
        device = self.support()['selected']
        power.save_json(self.paths.state,dict(machine_id='test-machine',name=device['name'],path=device['path'],maximum=7812,brightness=7812,bl_power=0,needs_restore=True))


class HardwareTests(HardwareFixture, unittest.TestCase):
    def test_power_key_bitmaps_on_32_and_64_bit_kernels(self):
        for kernel in ('i686','x86_64'):
            with patch.object(power.platform,'machine',return_value=kernel):
                self.add_input('event17','gpio-keys',[116])
                self.assertTrue(self.support()['supported'])
                self.assertEqual([d['node'] for d in self.support()['inputs'] if d['power']],['/dev/input/event17'])

    def test_ambiguous_backlights_require_explicit_selection(self):
        (self.root/'sys/class/backlight/second_panel').symlink_to(self.panel)
        self.assertFalse(self.support()['supported'])
        self.assertTrue(power.discover(self.root,self.probe,'vendor_panel')['supported'])

    def test_i386_and_amd64_detect_i915_backlight_without_name_or_event_assumptions(self):
        for arch in ('i386','amd64'):
            self.arch=arch
            value=self.support()
            self.assertTrue(value['supported'],value['reasons'])
            self.assertEqual(value['selected']['name'],'vendor_panel')
            self.assertEqual([d['node'] for d in value['inputs'] if d['power']],['/dev/input/event17'])
            self.assertEqual(value['selected']['maximum'],7812)

    def test_raspberry_pi_armhf_arm64_and_amd_cpu_are_not_activated(self):
        for arch in ('armhf','arm64'):
            self.arch=arch
            self.assertFalse(self.support()['supported'])
            with self.assertRaisesRegex(RuntimeError,'Raspberry Pi/ARM'):
                self.manager().configure({},enable=True)
        self.arch='amd64'
        (self.root/'proc/cpuinfo').write_text('vendor_id : AuthenticAMD\n')
        self.assertFalse(self.support()['supported'])
        self.assertEqual((self.panel/'bl_power').read_text(),'0')
        self.assertFalse(self.paths.config.exists())

    def test_missing_power_button_or_bl_power_prevents_activation(self):
        (self.root/'sys/class/input/event17/device/capabilities/key').write_text('0')
        self.assertFalse(self.support()['supported'])
        with self.assertRaisesRegex(RuntimeError,'KEY_POWER'):
            self.manager().configure({},enable=True)
        (self.panel/'bl_power').unlink()
        self.assertFalse(self.support()['supported'])
        self.assertFalse(self.paths.unit.exists())

    def test_other_seat_and_accelerometers_do_not_count_as_user_activity(self):
        self.add_input('event8','motion sensor',[30,28],[0,1])
        def probe(args,check=True):
            if args[0]=='udevadm':
                return SimpleNamespace(returncode=0,stdout='ID_SEAT=seat1\n' if 'event17' in args[-1] else 'ID_INPUT_ACCELEROMETER=1\n',stderr='')
            return self.probe(args,check)
        value=power.discover(self.root,probe)
        self.assertFalse(value['supported'])
        self.assertEqual(value['inputs'],[])

    def test_configure_disabled_has_no_running_service_or_persistent_logind_edit(self):
        config=self.manager().configure({'timeout_minutes':10,'dim_percent':35})
        self.assertFalse(config['enabled'])
        self.assertEqual(config['normal_brightness'],7812)
        self.assertIn(['systemctl','disable',power.UNIT],self.commands)
        self.assertNotIn(['systemctl','start',power.UNIT],self.commands)
        self.assertFalse((self.root/'etc/systemd/logind.conf').exists())
        self.assertFalse((self.root/'etc/systemd/logind.conf.d').exists())
        self.assertEqual((self.panel/'brightness').read_text(),'7812')

    def test_active_desktop_is_not_taken_over(self):
        def desktop(args,check=True):
            if args==['systemctl','is-active','--quiet','display-manager.service']:
                return SimpleNamespace(returncode=0,stdout='active',stderr='')
            return self.probe(args,check)
        with self.assertRaisesRegex(RuntimeError,'display-manager'):
            power.Manager(self.paths,desktop).configure({},enable=True)
        self.assertFalse(self.paths.config.exists())
        self.assertFalse(self.paths.unit.exists())

    def test_unit_is_narrow_and_stops_with_kiosk_without_root_browser_or_suspend(self):
        self.manager().configure({},enable=True)
        unit=self.paths.unit.read_text()
        for required in ('BindsTo=layr-kiosk.service','WantedBy=layr-kiosk.service','ProtectHome=yes','CapabilityBoundingSet=','RestrictAddressFamilies=AF_UNIX','DeviceAllow=char-input r','NoNewPrivileges=yes','Restart=no','TimeoutStopSec=5s','ExecStopPost=', '--what=handle-power-key --mode=block', '/usr/bin/python3 -I /usr/local/lib/layr-display-power/controller.py run'):
            self.assertIn(required,unit)
        for banned in ('chromium','suspend','hibernate','HandlePowerKey=','/home/','chmod','char-drm','CAP_SYS_ADMIN','CAP_SYS_PTRACE'):
            self.assertNotIn(banned,unit)
        writes=[line for line in unit.splitlines() if line.startswith('ReadWritePaths=')]
        self.assertEqual(len(writes),1)
        self.assertTrue(writes[0].endswith('/brightness '+self.support()['selected']['path']+'/bl_power'))

    def test_restore_is_exact_idempotent_and_does_not_clobber_later_user_brightness(self):
        self.journal()
        (self.panel/'brightness').write_text('1562')
        (self.panel/'bl_power').write_text('4')
        self.assertTrue(power.restore_saved(self.paths))
        self.assertEqual((self.panel/'brightness').read_text().strip(),'7812')
        self.assertEqual((self.panel/'bl_power').read_text().strip(),'0')
        (self.panel/'brightness').write_text('5000')
        self.assertFalse(power.restore_saved(self.paths))
        self.assertEqual((self.panel/'brightness').read_text(),'5000')

    def test_restore_rejects_other_machine_or_device_without_writes(self):
        self.journal()
        record=json.loads(self.paths.state.read_text())
        for changes in ({'machine_id':'another-machine'},{'path':'/sys/devices/unrelated'},{'maximum':9000},{'brightness':0}):
            power.save_json(self.paths.state,dict(record,**changes))
            with self.assertRaises(RuntimeError): power.restore_saved(self.paths)
            self.assertEqual((self.panel/'brightness').read_text(),'7812')

    def test_failed_service_start_rolls_back_to_disabled_and_restores_backlight(self):
        original=self.probe
        def failing(args,check=True):
            if args==['systemctl','start',power.UNIT]:
                self.journal()
                (self.panel/'brightness').write_text('1562')
                (self.panel/'bl_power').write_text('4')
                raise RuntimeError('inhibitor/start failed')
            return original(args,check)
        with self.assertRaisesRegex(RuntimeError,'start failed'):
            power.Manager(self.paths,failing).configure({},enable=True)
        self.assertFalse(json.loads(self.paths.config.read_text())['enabled'])
        self.assertIn(['systemctl','disable','--now',power.UNIT],self.commands)
        self.assertEqual((self.panel/'bl_power').read_text().strip(),'0')
        self.assertEqual((self.panel/'brightness').read_text().strip(),'7812')

    def test_partial_settings_change_preserves_other_settings_and_original_normal(self):
        self.manager().configure({'timeout_minutes':10,'dim_percent':35},enable=True)
        config=self.manager().configure({'dim':False})
        self.assertEqual(config['timeout_minutes'],10)
        self.assertEqual(config['dim_percent'],35)
        self.assertTrue(config['enabled'])
        self.assertFalse(config['dim'])

    def test_foreign_units_and_untrusted_or_symlinked_state_are_not_overwritten(self):
        self.paths.unit.parent.mkdir(parents=True)
        self.paths.unit.write_text('unrelated unit')
        with self.assertRaisesRegex(RuntimeError,'unrelated'):
            self.manager().configure({},enable=True)
        self.assertEqual(self.paths.unit.read_text(),'unrelated unit')
        self.paths.state.parent.mkdir(parents=True)
        other=self.root/'foreign.json';other.write_text('{}')
        self.paths.state.symlink_to(other)
        with self.assertRaisesRegex(RuntimeError,'untrusted'):
            power.restore_saved(self.paths)

    def test_disable_restores_even_if_systemctl_fails_and_preserves_external_logind_settings(self):
        self.manager().configure({},enable=True)
        self.journal();(self.panel/'bl_power').write_text('4')
        logind=self.root/'etc/systemd/logind.conf'
        logind.write_text('[Login]\nHandlePowerKey=ignore\n')
        def failed(args,check=True):
            if args==['systemctl','disable','--now',power.UNIT]: raise RuntimeError('systemctl unavailable')
            return self.probe(args,check)
        with self.assertRaisesRegex(RuntimeError,'unavailable'):
            power.Manager(self.paths,failed).disable()
        self.assertEqual((self.panel/'bl_power').read_text().strip(),'0')
        self.assertEqual(logind.read_text(),'[Login]\nHandlePowerKey=ignore\n')

    def test_uninstall_restores_backlight_removes_only_owned_files_and_keeps_logind(self):
        self.manager().configure({},enable=True)
        self.journal();(self.panel/'bl_power').write_text('4')
        helper=self.root/'root-helper/controller.py';helper.parent.mkdir();helper.write_text('owned')
        foreign=helper.parent/'unrelated';foreign.write_text('keep')
        logind=self.root/'etc/systemd/logind.conf';logind.write_text('HandlePowerKey=ignore\n')
        with patch.object(power,'HELPER',helper): self.manager().uninstall()
        self.assertFalse(helper.exists());self.assertTrue(foreign.exists())
        self.assertFalse(self.paths.config.exists());self.assertFalse(self.paths.unit.exists())
        self.assertFalse(self.paths.state.exists())
        self.assertEqual((self.panel/'bl_power').read_text().strip(),'0')
        self.assertEqual(logind.read_text(),'HandlePowerKey=ignore\n')


class PolicyTests(unittest.TestCase):
    def test_session_metadata_uses_logind_leader_not_proc_or_ssh_default(self):
        uid=os.getuid();owner=power.pwd.getpwuid(uid).pw_name
        def probe(args,check=True):
            if args[0]=='systemctl': text=f'ActiveState=active\nMainPID=42\nUser={owner}\n'
            elif args[1]=='list-sessions': text='c1 1000 owner seat0\nc2 1000 owner seat0\n'
            else:
                text=f'Leader={41 if args[2]=="c1" else 42}\nActive=yes\nSeat=seat0\nVTNr=7\nRemote=no\nUser={uid}\n'
            return SimpleNamespace(returncode=0,stdout=text,stderr='')
        with patch.object(Path,'read_bytes',side_effect=AssertionError('no user environ access')):
            self.assertTrue(power.kiosk_session(probe))

    def test_defaults_dim_at_four_minutes_then_off_at_five(self):
        policy=power.IdlePolicy({},0)
        self.assertEqual(policy.tick(239.9),'active')
        self.assertEqual(policy.tick(240),'dimmed')
        self.assertEqual(policy.tick(300),'dimmed')
        self.assertEqual(policy.tick(300.25),'off')
        self.assertEqual(policy.activity(310,power=True),'active')
        self.assertEqual(policy.tick(549.9),'active')

    def test_timeouts_never_and_disabled_dimming(self):
        for minutes in (1,5,10):
            p=power.IdlePolicy({'timeout_minutes':minutes},0)
            self.assertEqual(p.tick(minutes*48),'dimmed')
        never=power.IdlePolicy({'timeout_minutes':None},0)
        self.assertEqual(never.tick(100000),'active')
        nodim=power.IdlePolicy({'dim':False},0)
        self.assertEqual(nodim.tick(299),'active')
        nodim.tick(300)
        self.assertEqual(nodim.tick(300.25),'off')

    def test_actual_input_held_contacts_and_inactive_console_keep_display_awake(self):
        p=power.IdlePolicy({},0)
        self.assertEqual(p.tick(300,held=True),'active')
        self.assertEqual(p.tick(599.9,held=True),'active')
        self.assertEqual(p.tick(600,session_active=False),'active')
        p.activity(700)
        self.assertEqual(p.tick(939.9),'active')

    def test_queued_input_cancels_pending_off_and_no_double_power_toggle(self):
        p=power.IdlePolicy({},0)
        p.tick(300)
        p.activity(300.1)
        self.assertEqual(p.tick(300.3),'active')
        p.tick(601);p.tick(601.3)
        self.assertEqual(p.state,'off')
        p.activity(602,power=True)
        previous=p.last_activity
        p.activity(602.01,power=True)
        self.assertEqual(p.state,'active')
        self.assertEqual(p.last_activity,previous)
        self.assertEqual(p.tick(603),'active')

    def test_dark_touch_does_not_toggle_power_button_wake(self):
        p=power.IdlePolicy({},0);p.tick(300);p.tick(300.3)
        self.assertEqual(p.activity(301),'off')
        self.assertEqual(p.activity(302,power=True),'active')

    def test_input_rising_edges_repeat_and_multitouch(self):
        state=power.InputState(dict(touch=True))
        self.assertEqual(state.event(1,116,1),(True,True))
        self.assertEqual(state.event(1,116,2),(False,False))
        self.assertEqual(state.event(1,116,0),(False,False))
        state.event(3,47,2);state.event(3,57,42)
        self.assertTrue(state.held)
        self.assertEqual(state.event(3,53,200),(True,False))
        state.event(3,57,-1)
        self.assertFalse(state.held)
        self.assertEqual(state.event(3,53,200),(False,False))
        self.assertEqual(state.event(2,0,0),(False,False))

    def test_lost_input_events_fail_open_instead_of_guessing(self):
        with self.assertRaisesRegex(RuntimeError,'dropped'):
            power.InputState(dict(touch=True)).event(0,3,0)

    def test_evdev_32_and_64_bit_records_and_partial_reads(self):
        for fmt in ('=iiHHi','=qqHHi'):
            event=struct.Struct(fmt); decoder=power.EventDecoder(event)
            data=event.pack(100,42,1,116,1)+event.pack(100,45,1,116,0)
            self.assertEqual(decoder.feed(data[:5]),[])
            self.assertEqual(decoder.feed(data[5:]),[(1,116,1),(1,116,0)])

    def test_unknown_settings_bad_paths_and_percentages_fail(self):
        for values in ({'timeout_minutes':2},{'dim_percent':0},{'dim_percent':101},{'backlight':'../../etc'},{'wake_method':'touch'},{'shell':'poweroff'},{'dim':'yes'}):
            with self.assertRaises(RuntimeError): power.settings(values)

    def test_already_held_keys_are_snapshotted_without_grabbing(self):
        state=power.InputState(dict(multitouch=False))
        def ioctl(fd,request,buf,mutate):
            self.assertEqual(request & 0xff,0x18)
            buf[30//8]|=1 << (30%8)
        with patch.object(power.fcntl,'ioctl',side_effect=ioctl):
            power.initial_input_state(123,state)
        self.assertTrue(state.held)


class DaemonRecoveryTests(HardwareFixture, unittest.TestCase):
    # Integration tests execute the real selector/decoder/policy/sysfs writes in
    # a separate process with FIFO input and an accelerated monotonic test clock.
    def child(self):
        self.manager().configure({},enable=True)
        self.support_data=self.support()
        for spec in self.support_data['inputs']:
            if not spec['power']:
                continue
            node=self.root/spec['node'].lstrip('/')
            os.mkfifo(node)
            writer=os.open(node,os.O_RDWR|os.O_NONBLOCK)
        (self.root/'session').write_text('active')
        support_json=json.dumps(dict(self.support_data,inputs=[d for d in self.support_data['inputs'] if d['power']]))
        code=f'''import importlib.util,os,time,pathlib
s=importlib.util.spec_from_file_location('power',{str(DEPLOY/'layr-display-power.py')!r});p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
p.ROOT_UID=os.getuid()
p.discover=lambda *a,**k: {support_json}
p.initial_input_state=lambda fd,state: None
root=pathlib.Path({str(self.root)!r})
p.inputs=lambda *a,**k: __import__('json').loads((root/'input-specs.json').read_text())
clock=lambda: time.monotonic()*600
p.Daemon(p.Paths(root),clock=clock,session=lambda: True if (root/'session').read_text()=='active' else None,guard=lambda:None).run()
'''
        # JSON booleans become Python literals for the injected fixture only.
        code=code.replace(support_json,repr(json.loads(support_json)))
        (self.root/'input-specs.json').write_text(json.dumps(json.loads(support_json)['inputs']))
        log=(self.root/'child.log').open('w')
        process=subprocess.Popen([sys.executable,'-u','-c',code],stdout=log,stderr=log)
        self.addCleanup(log.close)
        def close_writer():
            try: os.close(writer)
            except OSError: pass
        self.addCleanup(close_writer)
        self.addCleanup(lambda: (process.kill(),process.wait()) if process.poll() is None else None)
        return process,writer

    def wait_value(self,path,value,process):
        deadline=time.monotonic()+4
        while time.monotonic()<deadline:
            if path.read_text().strip()==str(value): return
            if process.poll() is not None: break
            time.sleep(.01)
        self.fail(f'Expected {path.name}={value}; '+(self.root/'child.log').read_text())

    def test_real_off_power_wake_and_term_restore(self):
        child,writer=self.child()
        self.wait_value(self.panel/'bl_power',4,child)
        self.assertEqual((self.panel/'brightness').read_text().strip(),'1562')
        event=struct.Struct('@llHHi')
        os.write(writer,event.pack(1,1,1,116,1)+event.pack(1,2,1,116,0))
        self.wait_value(self.panel/'bl_power',0,child)
        child.terminate();self.assertEqual(child.wait(timeout=3),0)
        self.assertEqual((self.panel/'brightness').read_text().strip(),'7812')
        self.assertFalse(self.paths.socket.exists())

    def test_sigkill_exec_stop_post_restore_is_idempotent(self):
        child,_=self.child();self.wait_value(self.panel/'bl_power',4,child)
        child.kill();child.wait(timeout=3)
        self.assertTrue(power.restore_saved(self.paths)) # same code as ExecStopPost
        self.assertEqual((self.panel/'bl_power').read_text().strip(),'0')
        self.assertFalse(power.restore_saved(self.paths))

    def test_ssh_wake_protocol_restores_without_restarting_any_services(self):
        child,_=self.child();self.wait_value(self.panel/'bl_power',4,child)
        before=len(self.commands)
        self.manager().wake()
        self.wait_value(self.panel/'bl_power',0,child)
        self.assertEqual(len(self.commands),before)
        child.terminate();child.wait(timeout=3)

    def test_stale_socket_after_crash_can_recover_over_ssh(self):
        child,_=self.child();self.wait_value(self.panel/'bl_power',4,child)
        child.kill();child.wait(timeout=3)
        self.manager().wake()
        self.assertEqual((self.panel/'bl_power').read_text().strip(),'0')

    def test_fragmented_and_cancelled_ssh_requests_do_not_break_the_controller(self):
        child,_=self.child();self.wait_value(self.panel/'bl_power',4,child)
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(2);client.connect(str(self.paths.socket))
            client.sendall(b'wa');time.sleep(.02);client.sendall(b'ke\n')
            self.assertEqual(client.recv(16),b'ok\n')
        self.wait_value(self.panel/'bl_power',0,child)
        with socket.socket(socket.AF_UNIX) as client:
            client.connect(str(self.paths.socket));client.sendall(b'w')
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(2);client.connect(str(self.paths.socket));client.sendall(b'suspend\n')
            self.assertEqual(client.recv(16),b'error\n')
        time.sleep(.05)
        self.assertIsNone(child.poll())
        child.terminate();child.wait(timeout=3)

    def test_new_keyboard_is_monitored_and_held_input_prevents_timeout(self):
        child,_=self.child();self.wait_value(self.panel/'bl_power',4,child)
        node=self.root/'dev/input/event31';os.mkfifo(node)
        writer=os.open(node,os.O_RDWR|os.O_NONBLOCK)
        try:
            specs=json.loads((self.root/'input-specs.json').read_text())
            specs.append(dict(event='event31',node='/dev/input/event31',name='USB keyboard',power=False,touch=False,multitouch=False,btn_touch=False))
            temp=self.root/'input-specs.next';temp.write_text(json.dumps(specs));temp.replace(self.root/'input-specs.json')
            (self.root/'sys/class/input/event31').mkdir()
            event=struct.Struct('@llHHi');os.write(writer,event.pack(1,1,1,30,1))
            self.wait_value(self.panel/'bl_power',0,child)
            time.sleep(.8) # more than a whole accelerated idle timeout
            self.assertEqual((self.panel/'bl_power').read_text().strip(),'0')
            child.terminate();child.wait(timeout=3)
        finally:
            os.close(writer)

    def test_lost_power_input_restores_the_display(self):
        child,writer=self.child();self.wait_value(self.panel/'bl_power',4,child)
        os.close(writer)
        self.assertNotEqual(child.wait(timeout=3),0)
        self.assertEqual((self.panel/'bl_power').read_text().strip(),'0')

    def test_kiosk_exit_restores_without_suspending_or_stopping_web(self):
        child,_=self.child();self.wait_value(self.panel/'bl_power',4,child)
        (self.root/'session').write_text('gone')
        self.assertNotEqual(child.wait(timeout=3),0)
        self.assertEqual((self.panel/'bl_power').read_text().strip(),'0')
        self.assertEqual((self.panel/'brightness').read_text().strip(),'7812')


class CliTests(unittest.TestCase):
    def options(self,**changes):
        return SimpleNamespace(**(dict(target='enable',yes=True,dry_run=False,json=False)|changes))

    def test_privilege_failure_precedes_install_or_any_input(self):
        with patch.object(cli,'power_module',return_value=power),patch.object(cli,'require_privileges',side_effect=RuntimeError('sudo unavailable')),patch.object(cli,'execute') as execute,patch('builtins.input',side_effect=AssertionError('must not prompt')):
            with self.assertRaisesRegex(RuntimeError,'sudo unavailable'):
                cli.display_power(self.options())
        execute.assert_not_called()

    def test_root_frontend_cli_execution_is_rejected_before_helper_setup(self):
        with patch('sys.argv',['layr','display-power','enable']),patch.object(cli.os,'geteuid',return_value=0),patch.object(cli,'execute') as execute:
            with self.assertRaisesRegex(RuntimeError,'not root'): cli.main()
        execute.assert_not_called()

    def test_unsupported_pi_enable_never_copies_root_helper(self):
        module=SimpleNamespace(settings=power.settings,Manager=power.Manager,discover=lambda **kwargs:dict(supported=False,reasons=['ARM is unsupported']))
        with patch.object(cli,'power_module',return_value=module),patch.object(cli,'require_privileges'),patch.object(cli,'saved',return_value={'profile':'kiosk'}),patch.object(cli,'execute') as execute:
            with self.assertRaisesRegex(RuntimeError,'ARM'):
                cli.display_power(self.options())
        execute.assert_not_called()

    def test_enable_dry_run_installs_only_root_owned_helper_and_does_not_enable_kiosk(self):
        selected=[]
        module=SimpleNamespace(settings=power.settings,Manager=lambda:SimpleNamespace(config=lambda:dict(backlight='saved_panel')),discover=lambda **kwargs:selected.append(kwargs['selected']) or dict(supported=True))
        calls=[]
        with patch.object(cli,'power_module',return_value=module),patch.object(cli,'require_privileges'),patch.object(cli,'trusted_power_helper'),patch.object(cli,'saved',return_value={'profile':'kiosk'}),patch.object(cli,'capture',return_value='active'),patch.object(cli.shutil,'which',return_value='/usr/bin/tool'),patch.object(cli,'execute',side_effect=lambda args,dry=False:calls.append((list(map(str,args)),dry))):
            cli.display_power(self.options(dry_run=True,idle_minutes='10',dim_percent=30))
        self.assertTrue(all(dry for _,dry in calls))
        self.assertEqual(calls[-1][0][0:3],['sudo','/usr/bin/python3','-I'])
        self.assertIn(str(cli.POWER_HELPER),calls[-1][0])
        self.assertNotIn('systemctl enable layr-kiosk',str(calls))
        self.assertNotIn('HandlePowerKey',str(calls))
        self.assertEqual(selected,['saved_panel'])

    def test_wake_and_disable_reject_user_writable_root_code_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            helper=Path(directory)/'controller.py'
            helper.write_text('not a trusted root helper')
            helper.chmod(0o666)
            for action in ('wake','disable'):
                with self.subTest(action=action),patch.object(cli,'power_module',return_value=power),patch.object(cli,'require_privileges'),patch.object(cli,'POWER_HELPER',helper),patch.object(cli,'execute') as execute:
                    with self.assertRaisesRegex(RuntimeError,'not trusted'):
                        cli.display_power(self.options(target=action))
                    execute.assert_not_called()

    def test_readonly_diagnostics_are_available_without_sudo(self):
        module=SimpleNamespace(diagnostics=lambda:dict(settings=power.DEFAULTS,support=dict(supported=False,reasons=['ARM'],backlights=[],inputs=[]),runtime=dict(state='not running'),logind_policy='runtime only',note='no suspend'))
        with patch.object(cli,'power_module',return_value=module),patch.object(cli,'require_privileges',side_effect=AssertionError('must not elevate')),redirect_stdout(io.StringIO()) as output:
            cli.display_power(self.options(target='status'))
        self.assertIn('disabled (default)',output.getvalue())
        self.assertIn('ARM',output.getvalue())

    def test_power_submenu_back_and_timeout_return_without_repeating_operations(self):
        answers=['4','6','0','4','6','4','2','','0']
        with patch('sys.argv',['layr']),patch.object(cli.sys.stdin,'isatty',return_value=True),patch('builtins.input',side_effect=answers),patch.object(cli,'dispatch') as dispatch,redirect_stdout(io.StringIO()) as output:
            cli.main()
        self.assertEqual(dispatch.call_count,1)
        value=dispatch.call_args.args[0]
        self.assertEqual((value.command,value.target,value.idle_minutes),('display-power','configure','5'))
        self.assertIn('0. Back',output.getvalue())
        self.assertEqual(output.getvalue().count('LAYR management'),3)


if __name__=='__main__': unittest.main()
