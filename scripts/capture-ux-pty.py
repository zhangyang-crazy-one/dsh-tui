#!/usr/bin/env python3
"""Capture production TuiLoop input flows with synthetic services in a real OS PTY."""
import argparse
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
from contextlib import suppress
from pathlib import Path

steps = {
    'child': [('typed', '中文'), ('steer', '\x1b[13;5u'), ('stop', 's'), ('back', '\x1b')],
    'browser': [('selected', '\x1b[6~'), ('source', '\r'), ('end', '\x1b[4~'), ('list', '\x1b'), ('back', '\x1b')],
    'selection': [('selected', '\x1b[1;2D'), ('copy', '\x19'), ('replace', '好'), ('send', '\r')],
    'split': [('single', 'v'), ('split-again', 'v'), ('back', '\x1b'), ('back-root', '\x1b')],
    'help': [('help', '\x1bh'), ('paste-ignored', '\x1b[200~MUST_NOT_EDIT\x1b[201~'), ('return-dialog', '\x1b')],
    'light': [('typed', ' · Light theme')],
    'key': [('selected', '\x1b[B'), ('editing', '\r'), ('chooser-again', '\x1b'), ('back', '\x1b')],
    'palette': [('suggestions', '/key '), ('next-candidate', '\x1b[B')],
    'agents': [('selected', '\x1b[B'), ('inspect', '\r'), ('inspect-home', '\x1b[1~'), ('inspect-page', '\x1b[6~'), ('inspect-end', '\x1b[4~'), ('inspect-up', 'k'), ('table-again', '\x1b'), ('back', '\x1b')],
    'todos': [('page', '\x1b[6~'), ('end', '\x1b[4~'), ('home', '\x1b[1~'), ('back', '\x1b')],
    'approval': [('details', 'i'), ('page', '\x1b[6~'), ('end', '\x1b[4~'), ('back', 'Y')],
    'question': [('details', 'i'), ('end', '\x1b[4~'), ('next-option', '\x1b[B'), ('options', 'i'), ('back', '\r')],
    'plan': [('page', '\x1b[6~'), ('end', '\x1b[4~'), ('back', 'Y')],
    'deliveries': [('page', '\x1b[6~'), ('preview', '\r'), ('preview-page', '\x1b[6~'), ('open-system', 'o'), ('list-again', '\x1b'), ('no-path-edit', 'e'), ('back', '\x1b')],
    'schedules': [('page', '\x1b[6~'), ('details', '\r'), ('end', '\x1b[4~'), ('read-up', '\x1b[A'), ('cancel-prompt', 'd'), ('keep', 'n'), ('list', '\x1b'), ('back', '\x1b')],
    'secret': [('editing', '\r'), ('typed', 'sk-fixture_DO_NOT_RENDER'), ('caret', '\x1b[D'), ('delete', '\x7f'), ('chooser-again', '\x1b'), ('back', '\x1b')],
    'question-custom': [('selected', ' '), ('next', '\x1b[B'), ('selected-second', ' '), ('custom', 'c'), ('typed', '自定义回答i'), ('text-full', '\t'), ('end', '\x1b[4~'), ('editor-again', '\t'), ('save', '\r'), ('back', '\r')],
}
parser = argparse.ArgumentParser()
parser.add_argument('--scene', choices=steps, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--columns', type=int, default=80)
parser.add_argument('--rows', type=int, default=24)
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
stats_path = output / 'state.json'
stats_path.unlink(missing_ok=True)
pid, master = pty.fork()
if pid == 0:
    os.chdir(repo)
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', args.rows, args.columns, 0, 0))
    os.execvpe('node', ['node', '--import', 'tsx', 'tui-render/tests/fixtures/ux-pty.tsx', args.scene, str(stats_path)], {
        'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(Path.home()),
        'TERM': 'xterm-256color', 'COLORTERM': 'truecolor', 'LANG': 'C.UTF-8',
    })

capture = bytearray()
phases = []

def drain(seconds):
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
            capture.extend(chunk)

def snapshot(name, keys=''):
    if keys:
        os.write(master, keys.encode())
    drain(0.25)
    os.kill(pid, signal.SIGUSR2)
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        try:
            state = json.loads(stats_path.read_text())
            if state.get('snapshots', 0) >= len(phases) + 1:
                break
        except (FileNotFoundError, json.JSONDecodeError):
            drain(0.01)
            continue
        drain(0.01)
    else:
        raise AssertionError('The renderer did not acknowledge the state snapshot')
    (output / f'{name}.ansi').write_bytes(capture)
    subprocess.run(['node', 'scripts/render-terminal-capture.mjs', str(output / f'{name}.ansi'),
                    str(output / f'{name}.png'), str(args.columns), str(args.rows)], cwd=repo, check=True)
    text = (output / f'{name}.txt').read_text()
    assert 'TUI 交互验证' in text, (name, text)
    phases.append({'name': name, 'state': state})
    return text

try:
    drain(2)
    initial = snapshot('initial')
    if args.scene == 'deliveries':
        assert '交付文件' in initial and '系统打开' in initial, initial
    if args.scene in ('approval', 'question', 'plan'):
        assert '目标' in initial, initial
        assert ('[Y]' if args.scene == 'approval' else 'Enter' if args.scene == 'question' else '[y]') in initial, initial
    for name, keys in steps[args.scene]:
        text = snapshot(name, keys)
        if args.scene in ('approval', 'question', 'plan') and name != 'back':
            assert '目标' in text, text
            assert ('[Y]' if args.scene == 'approval' else 'Enter' if args.scene == 'question' else '[y]') in text, text
        if args.scene == 'child':
            if name != 'back': assert '渲染检查' in text, text
            if name == 'typed': assert phases[-1]['state']['childPrompt'] == 'CHILD_DRAFT中文' and 'CHILD_DRAFT中文' in text, text
            if name == 'steer': assert phases[-1]['state']['childSent'] == 'CHILD_DRAFT中文' and phases[-1]['state']['childDelivery'] == 'steer', phases[-1]
            if name == 'stop': assert '已请求停止' in text, text
        if args.scene == 'browser':
            if name == 'selected': assert 'EVENT_' in text, text
            if name == 'end': assert 'END_EVENT_JSON' in text, text
        if args.scene == 'selection':
            if name == 'copy': assert phases[-1]['state']['copied'] == '🙂', phases[-1]
            if name == 'send': assert phases[-1]['state']['sent'] == '选择中好', phases[-1]
        if args.scene == 'help':
            if name in ('help', 'paste-ignored'): assert '只读帮助' in text, text
            assert phases[-1]['state']['questionCustom'] == 'ANSWER_DRAFT', phases[-1]
        if args.scene == 'split' and args.columns >= 100:
            if name == 'split-again': assert 'CHILD_END' in text and phases[-1]['state']['hubSplit'], text
        if args.scene == 'light':
            assert b'\x1b[48;2;250;250;252m' in capture, 'Missing light theme background'
        if args.scene == 'agents':
            if name in ('inspect', 'inspect-end'):
                assert '子代理记录 59' in text, text
            if name == 'inspect-home':
                assert '子代理记录 00' in text, text
            if name == 'inspect-up':
                position = re.search(r'\((\d+)-(\d+)/(\d+)\)', text)
                assert '阅读中' in text and position and int(position[2]) < int(position[3]), text
            if name != 'back':
                assert 'Esc' in text, text
        if args.scene == 'deliveries':
            if name in ('page', 'list-again', 'no-path-edit'):
                assert '交付_020.md' in text and '交付文件' in text, text
            if name in ('preview', 'preview-page', 'open-system'):
                assert '预览:' in text and '正文' in text and '系统打开' in text, text
            if name == 'open-system':
                assert 'workspace-open-system' in phases[-1]['state']['actions']
            if name == 'back':
                assert '交付_001.md' in text and '已完成' in text, text
        if args.scene == 'schedules':
            if name == 'page':
                marker = f"REMINDER_{phases[-1]['state']['scheduleSelection']:04}"
                assert marker in text, text
            if name == 'cancel-prompt':
                assert 'y 确认取消' in text and 'n/Esc 保留' in text, text
            if name == 'read-up':
                assert phases[-1]['state']['scheduleOffset'] < phases[-2]['state']['scheduleOffset']
        if args.scene == 'secret':
            assert b'sk-fixture' not in capture, (name, 'credential leaked into terminal output')
            if name in ('typed', 'caret', 'delete'):
                assert '••••' in text, text
        if args.scene == 'question-custom':
            if name == 'selected-second':
                assert phases[-1]['state']['questionSelections'] == [0, 1]
            if name in ('typed', 'editor-again'):
                assert phases[-1]['state']['questionCustom'] == '自定义回答i'
                assert '自定义回答i' in text, text
            if name == 'save':
                assert phases[-1]['state']['questionOpen'] and not phases[-1]['state']['questionEditing']
        if name == 'end':
            marker = {'approval': 'END_APPROVAL', 'question': 'END_QUESTION', 'plan': 'END_PLAN', 'todos': 'TODO_1999', 'schedules': 'END_REMINDER', 'question-custom': 'END_CUSTOM_PROMPT', 'browser': 'END_EVENT_JSON'}[args.scene]
            assert marker in text.replace('\n', ''), (marker, text)
        if name == 'back' and args.scene != 'split' or name == 'back-root':
            assert 'DRAFT_PRESERVED' in text, text
    (output / 'metrics.json').write_text(json.dumps({'scene': args.scene, 'columns': args.columns, 'rows': args.rows, 'phases': phases}, ensure_ascii=False, indent=2) + '\n')
    print(f'{args.scene}: {len(phases)} PTY captures passed at {args.columns}x{args.rows}; {output}')
finally:
    with suppress(ProcessLookupError):
        os.kill(pid, signal.SIGTERM)
    drain(0.1)
    os.close(master)
    os.waitpid(pid, 0)
