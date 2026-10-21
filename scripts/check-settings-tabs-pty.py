#!/usr/bin/env python3
"""Exercise production settings rendering/keys in a PTY with synthetic services."""
import argparse
import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import termios
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--columns', type=int, default=80)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
stats = out / 'state.json'
ready = Path(str(stats) + '.ready')
stats.unlink(missing_ok=True)
ready.unlink(missing_ok=True)
pid, master = pty.fork()
if pid == 0:
    os.chdir(root)
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', 24, args.columns, 0, 0))
    os.execvpe('node', ['node', '--import', 'tsx', 'tui-render/tests/fixtures/performance-audit.tsx', str(stats), 'settings', '25', 'settings-tabs'], {
        'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(Path.home()),
        'TERM': 'xterm-256color', 'COLORTERM': 'truecolor', 'LANG': 'C.UTF-8',
    })
capture = bytearray()
phases = []

def drain(seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if select.select([master], [], [], max(0, min(.02, deadline - time.monotonic())))[0]:
            try:
                chunk = os.read(master, 262144)
            except OSError:
                break
            if not chunk:
                break
            capture.extend(chunk)

def keys(value):
    os.write(master, value.encode())
    drain(.15)

def screen(name):
    os.kill(pid, signal.SIGUSR2)
    for _ in range(500):
        drain(.01)
        try:
            state = json.loads(stats.read_text())
            if state['snapshots'] > len(phases):
                break
        except (FileNotFoundError, json.JSONDecodeError):
            pass
    else:
        raise AssertionError('Fixture snapshot timed out')
    (out / f'{name}.ansi').write_bytes(capture)
    subprocess.run(['node', 'scripts/render-terminal-capture.mjs', str(out / f'{name}.ansi'), str(out / f'{name}.png'), str(args.columns), '24'], cwd=root, check=True)
    text = (out / f'{name}.txt').read_text()
    assert 'TUI performance audit' in text, (name, text)
    assert 'fixture' in text, (name, text)
    phases.append({'name': name, 'settings': state['settings']})
    return state['settings'], text

try:
    for _ in range(600):
        drain(.05)
        if ready.exists():
            break
    assert ready.exists(), capture[-2000:].decode(errors='replace')
    state, text = screen('initial')
    assert state['activeCategory'] == 'group:appearance' and '[外观与输入]' in text
    keys('\t'); keys('\r'); keys('\r')
    state, text = screen('providers')
    assert state['rowCount'] == 26 and '[模型与凭据]' in text
    keys('\r'); keys('jjjjj'); keys('\r'); keys('\r'); keys('jj')
    state, text = screen('model-field')
    original = state['breadcrumb']
    assert state['fields'][state['selected']]['field'].endswith('.contextWindow')
    keys('\t')
    screen('other-category')
    keys('\x1b[Z')
    state, text = screen('restored')
    assert state['breadcrumb'] == original and state['fields'][state['selected']]['field'].endswith('.contextWindow')
    keys('/'); keys('contextWindow'); keys('\x1b[B')
    state, text = screen('search')
    selected = state['selected']
    assert selected == 1 and '搜索结果' in text
    keys('\r')
    state, _ = screen('search-accepted')
    assert state['selected'] == selected and not state['searching']
    keys('\x1b')
    state, _ = screen('search-cleared')
    assert state['breadcrumb'] == original and state['filter'] == ''
    keys('\r')
    state, text = screen('editing')
    assert state['editing'] and '设置值' in text and 'Enter 发送' not in text
    keys('\x7f' * 5); keys('131072'); keys('\r')
    state, text = screen('saved')
    assert not state['editing'] and state['fields'][state['selected']]['value'] == '131072'
    assert '131072' in text and state['breadcrumb'] == original
    keys('\x1b'); keys('\x1b'); keys('\x1b[H'); keys('j'); keys('\r')
    keys('\x15'); keys('https://gateway.example/' + 'route/' * 50)
    state, _ = screen('long-value-editor')
    assert state['editing']
    keys('\x1b')
    state, _ = screen('long-value-cancelled')
    assert not state['editing']
    (out / 'result.json').write_text(json.dumps({'status': 'PASS', 'columns': args.columns, 'rows': 24, 'phases': phases}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': 'PASS', 'columns': args.columns, 'phases': len(phases), 'output': str(out)}))
finally:
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    drain(.1)
    os.close(master)
    os.waitpid(pid, 0)
