#!/usr/bin/env python3
"""Production renderer in an OS PTY. Measures host output, not monitor paint."""
import argparse, fcntl, json, os, pty, select, signal, statistics, struct, termios, time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--scene', default='chat')
parser.add_argument('--count', type=int, default=500)
parser.add_argument('--columns', type=int, default=120)
parser.add_argument('--rows', type=int, default=40)
parser.add_argument('--variant', default='default')
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--cpu-profile', action='store_true')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
stats_path = out / 'raw.json'
stats_path.unlink(missing_ok=True)
ready_path = Path(str(stats_path) + '.ready')
ready_path.unlink(missing_ok=True)
pid, master = pty.fork()
if pid == 0:
    os.chdir(repo)
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', args.rows, args.columns, 0, 0))
    profile = ['--cpu-prof', f'--cpu-prof-dir={out}', '--cpu-prof-name=audit.cpuprofile'] if args.cpu_profile else []
    os.execvpe('node', ['node', *profile, '--import', 'tsx', str(repo / 'tui-render/tests/fixtures/performance-audit.tsx'),
                       str(stats_path), args.scene, str(args.count), args.variant],
               {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(Path.home()),
                'TERM': 'xterm-256color', 'COLORTERM': 'truecolor', 'LANG': 'C.UTF-8'})
capture = bytearray()
read_log = []
serial = 0

def drain(seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], min(.01, max(0, deadline-time.monotonic())))
        if ready:
            try: chunk = os.read(master, 262144)
            except OSError: break
            if not chunk: break
            read_log.append((time.monotonic(), len(chunk)))
            capture.extend(chunk)

def snapshot():
    global serial
    serial += 1
    os.kill(pid, signal.SIGUSR2)
    for _ in range(3000):
        drain(.01)
        try:
            data = json.loads(stats_path.read_text())
            if data['snapshots'] >= serial: return data
        except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError): pass
    raise RuntimeError('No fixture snapshot: ' + capture[-3000:].decode(errors='replace'))

def summary(values):
    if not values: return None
    values = sorted(values)
    return {'n': len(values), 'median': statistics.median(values), 'p95': values[min(len(values)-1, int(.95*len(values)))], 'max': max(values)}

phases = []
def phase(name, reports=0, hz=0, direction=64, settle=.4):
    before = snapshot()
    start = time.monotonic()
    byte_start = len(capture)
    sends = []
    report = f'\x1b[<{direction};20;15M'.encode()
    if reports and hz == 0:
        sends.append(time.monotonic())
        os.write(master, report * reports)
    else:
        for i in range(reports):
            drain(max(0, start + i / hz - time.monotonic()))
            sends.append(time.monotonic())
            os.write(master, report)
    drain(settle)
    after = snapshot()
    events = after['events'][len(before['events']):]
    inputs = [e for e in events if e['kind'] == 'input' and e['wheelReports']]
    writes = [e for e in events if e['kind'] == 'write' and e['sync']]
    commits = [e['actualDuration'] for e in events if e['kind'] == 'commit']
    previous_signature = next((e.get('signature') for e in reversed(before['events']) if e['kind'] == 'write' and e.get('signature')), None)
    moving = []
    for e in writes:
        if e.get('signature') and e['signature'] != previous_signature:
            moving.append(e)
            previous_signature = e['signature']
    firsts = []
    for e in inputs:
        next_frame = next((w for w in moving if w['t'] >= e['t']), None)
        if next_frame: firsts.append(next_frame['t']-e['t'])
    reads = [t for t, _ in read_log if t >= start]
    phases.append({
        'name': name, 'reportsSent': reports, 'inputChunks': len(inputs), 'reportsReceived': sum(e['wheelReports'] for e in inputs),
        'bytes': len(capture)-byte_start, 'commits': len(commits), 'reactRenderMs': summary(commits),
        'syncWrites': len(writes), 'motionFrames': len(moving),
        'inputToNextMotionWriteMs': summary(firsts),
        'motionFrameIntervalMs': summary([b['t']-a['t'] for a,b in zip(moving, moving[1:])]),
        'tailAfterLastInputMs': max(0, moving[-1]['t']-inputs[-1]['t']) if moving and inputs else None,
        'firstPtyOutputMs': (reads[0]-sends[0])*1000 if reads and sends else None,
        'lastMotionFirstRow': moving[-1].get('first') if moving else None,
        'settingsSelected': after['settings']['selected'],
        'cpuUs': {key: after['cpu'][key]-before['cpu'][key] for key in ['user', 'system']},
        'rssMiB': after['memory']['rss']/1048576,
        'heapUsedMiB': after['memory']['heapUsed']/1048576,
    })

try:
    # Startup/transpilation and initial projection are excluded from scrolling.
    drain(4 if args.count < 5000 else 12)
    # A busy test host can spend longer importing modules. SIGUSR2 before the
    # fixture installs its handler would terminate Node instead of sampling it.
    for _ in range(600):
        if ready_path.exists(): break
        drain(.05)
    if not ready_path.exists(): raise RuntimeError('Fixture did not become ready: ' + capture[-3000:].decode(errors='replace'))
    ready = snapshot()
    (out / 'initial.ansi').write_bytes(capture)
    phase('idle', settle=.5)
    if args.scene == 'settings':
        def keys(value):
            os.write(master, value.encode())
            drain(.15)
        def screen(name):
            state = snapshot()['settings']
            (out / f'{name}.ansi').write_bytes(capture)
            (out / f'{name}.json').write_text(json.dumps(state, ensure_ascii=False, indent=2)+'\n')
            return state
        screen('categories')
        keys('j'); keys('\r'); keys('\r'); keys('\r')
        assert screen('providers')['rowCount'] == args.count + 1
        keys('\r')
        assert screen('provider')['breadcrumb'][-1] == 'provider-0-long-route-name'
        keys('jjjjj'); keys('\r')
        assert screen('models')['rowCount'] == 65
        phase('wheel-down-30', 30, 60, 65)
        phase('wheel-up-30', 30, 60, 64)
        keys('\r'); keys('jj')
        state = screen('model-detail')
        assert state['fields'][state['selected']]['field'].endswith('.contextWindow')
        keys('\r'); keys('\x7f' * len(state['fields'][state['selected']]['value'])); keys('131072'); keys('\r')
        state = screen('model-saved')
        assert state['fields'][state['selected']]['value'] == '131072' and not state['editing']
    elif args.scene == 'live-markdown':
        phase('untouched-streaming', settle=10)
    elif args.scene in ('overlap', 'resize'):
        phase('follow-and-cycle', settle=2)
        os.write(master, ('长草稿输入保持在输入区内。'*30).encode())
        phase('long-draft-and-cycle', settle=2)
        if args.scene == 'resize':
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
            phase('narrow-streaming', settle=2)
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', args.rows, args.columns, 0, 0))
            phase('restored-streaming', settle=2)
        phase('wheel-up', 60, 60, settle=.6)
        os.write(master, b'\x15')
        phase('draft-cleared', settle=2)
        phase('wheel-down', 80, 60, 65, settle=.6)
    else:
        for index in range(5): phase(f'single-{index}', 1)
        phase('burst-3', 3)
        phase('burst-10', 10)
        phase('burst-40', 40)
        phase('continuous-60hz', 60, 60, settle=.6)
        phase('reverse-60hz', 30, 60, 65, settle=.6)
        phase('continuous-120hz', 120, 120, settle=.6)
    end = snapshot()
    result = {'scene': args.scene, 'count': args.count, 'columns': args.columns, 'rows': args.rows,
              'variant': args.variant, 'phases': phases, 'frameMetrics': end['frameMetrics'],
              'eventLoop': end['eventLoop'], 'settings': end['settings']}
    (out / 'summary.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    (out / 'final.ansi').write_bytes(capture)
    print(json.dumps({'output': str(out), 'phases': len(phases), 'settings': end['settings']}))
finally:
    (out / 'capture.ansi').write_bytes(capture)
    try: os.kill(pid, signal.SIGTERM)
    except ProcessLookupError: pass
    drain(.2)
    os.close(master)
    os.waitpid(pid, 0)
