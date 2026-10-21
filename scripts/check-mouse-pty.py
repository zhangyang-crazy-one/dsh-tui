#!/usr/bin/env python3
"""Exercise the production mouse/render stack in an OS PTY without model/network calls."""
import argparse
import base64
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import subprocess
import termios
import time
from pathlib import Path
from typing import NotRequired, TypedDict


class Phase(TypedDict):
    name: str
    bytes: int
    commits: int
    full_row_erases: int
    display_erases: int
    sync_starts: int
    sync_ends: int
    nested_sync_starts: int
    outside_sync_cells: int
    copied: NotRequired[list[str]]

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--columns', type=int, default=120)
parser.add_argument('--rows', type=int, default=40)
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
metrics_path = output / 'react.json'
metrics_path.unlink(missing_ok=True)
pid, master = pty.fork()
if pid == 0:
    os.chdir(repo)
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', args.rows, args.columns, 0, 0))
    os.execvpe('node', ['node', '--import', 'tsx', 'tui-render/tests/fixtures/mouse-pty.tsx', str(metrics_path)], {
        'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(Path.home()),
        'TERM': 'xterm-256color', 'COLORTERM': 'truecolor', 'LANG': 'C.UTF-8',
    })

capture = bytearray()
phases: list[Phase] = []
snapshot_number = 0
sync_open = False
controls = re.compile(r'\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b\[([0-?]*)([ -/]*)([@-~])|[^\x1b]+|\x1b.', re.S)

def drain(seconds):
    result = bytearray()
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], min(0.025, max(0, deadline - time.monotonic())))
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            result.extend(chunk)
    capture.extend(result)
    return bytes(result)

def commits():
    global snapshot_number
    snapshot_number += 1
    os.kill(pid, signal.SIGUSR2)
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        try:
            data = json.loads(metrics_path.read_text())
            if data['snapshots'] >= snapshot_number:
                return data['commits']
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        drain(0.01)
    raise AssertionError('The renderer did not acknowledge the metrics request')

def phase(name, reports='', duration=0.2):
    global sync_open
    before = commits()
    if reports:
        os.write(master, reports.encode())
    raw = drain(duration)
    after = commits()
    text = raw.decode('utf-8', errors='replace')
    counts: Phase = {
        'name': name, 'bytes': len(raw), 'commits': after-before,
        'full_row_erases': 0, 'display_erases': 0, 'sync_starts': 0, 'sync_ends': 0,
        'nested_sync_starts': 0, 'outside_sync_cells': 0,
    }
    for token in controls.finditer(text):
        params, _, final = token.groups()
        if params is None:
            if not token[0].startswith('\x1b') and not sync_open:
                counts['outside_sync_cells'] += len(token[0].replace('\r', '').replace('\n', ''))
            continue
        if params == '?2026' and final == 'h':
            counts['nested_sync_starts'] += 1 if sync_open else 0
            sync_open = True
            counts['sync_starts'] += 1
        elif params == '?2026' and final == 'l':
            sync_open = False
            counts['sync_ends'] += 1
        elif final == 'K' and params == '2':
            counts['full_row_erases'] += 1
        elif final == 'J':
            counts['display_erases'] += 1
    copied = []
    for encoded in re.findall(r'\x1b\]52;[^;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)', text):
        copied.append(base64.b64decode(encoded).decode('utf-8'))
    if copied:
        counts['copied'] = copied
    phases.append(counts)
    (output / f'{name}.ansi').write_bytes(capture)
    return counts

try:
    drain(2)
    # Start after mount, measurement and the initial viewport have settled.
    sync_open = False
    phase('idle')
    center = max(5, args.rows // 2)
    start = min(args.rows - 5, center + 6)
    phase('inside-drag', f'\x1b[<0;1;{start}M\x1b[<32;30;{center}M')
    phase('duplicate-drag', f'\x1b[<32;30;{center}M' * 100)
    phase('inside-move', ''.join(f'\x1b[<32;{col};{center}M' for col in range(31, 51)))
    phase('copy-release', f'\x1b[<0;50;{center}m')
    for index in range(3):
        phase(f'wheel-{index}', f'\x1b[<64;20;{center}M', 0.25)
    phase('edge-up', f'\x1b[<0;1;{start}M\x1b[<32;30;1M', 0.65)
    phase('edge-release', '\x1b[<0;30;1m', 0.25)
    report = {'columns': args.columns, 'rows': args.rows, 'phases': phases, 'synchronized_frame_open': sync_open}
    (output / 'metrics.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    for name in ['idle', 'inside-drag', 'edge-up', 'edge-release']:
        subprocess.run(['node', 'scripts/render-terminal-capture.mjs', str(output / f'{name}.ansi'),
                        str(output / f'{name}.png'), str(args.columns), str(args.rows)], cwd=repo, check=True)
    if args.check:
        assert not sync_open, 'An output frame was left open'
        assert next(row for row in phases if row['name'] == 'duplicate-drag')['bytes'] == 0
        for row in phases:
            assert row['display_erases'] == 0, row
            assert row['outside_sync_cells'] == 0, row
            assert row['nested_sync_starts'] == 0, row
            if row['name'].startswith('inside') or row['name'] == 'duplicate-drag':
                assert row['commits'] == 0, row
            assert row['full_row_erases'] == 0, row
        copies = [text for row in phases for text in row.get('copied', [])]
        assert len(copies) == 2 and all(text.strip() for text in copies), copies
        assert any('中文复制验证' in text for text in copies), copies
        for text in copies:
            row_numbers = [int(value) for value in re.findall(r'Row (\d+)', text)]
            assert row_numbers == sorted(row_numbers), 'Copy order reversed'
            assert not any(hint in text for hint in ['↓ 底部', '↓ 最新消息', 'End/G']), text
            headers = list(re.finditer(r'Row (\d+)', text))
            for index, header in enumerate(headers):
                end = headers[index + 1].start() if index + 1 < len(headers) else len(text)
                content = text[header.start():end]
                assert 'Provider settings and subagent output.' in content, content
                if index + 1 < len(headers):
                    assert f'Second line {int(header[1])}: stable terminal rendering.' in content, content
        for name in ['idle', 'inside-drag', 'edge-up', 'edge-release']:
            lines = (output / f'{name}.txt').read_text().splitlines()
            assert lines[0].startswith('Mouse performance fixture'), (name, lines[0])
            assert any('Draft preserved while selecting' in line for line in lines), name
    print(json.dumps(report, ensure_ascii=False, indent=2))
finally:
    os.kill(pid, signal.SIGTERM)
    drain(0.1)
    os.close(master)
    os.waitpid(pid, 0)
