#!/usr/bin/env python3
"""Drive the production output boundary through a real PTY, without typing a draft."""
import argparse, fcntl, json, os, pty, select, signal, struct, subprocess, termios, time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--seconds', type=float, default=300)
parser.add_argument('--columns', type=int, default=80)
parser.add_argument('--rows', type=int, default=24)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
prefix = args.output.resolve()
prefix.parent.mkdir(parents=True, exist_ok=True)
Path(str(prefix)+'.ready').unlink(missing_ok=True)
source = subprocess.check_output(['node', '--input-type=module', '-e',
    "import {sourceIdentity} from './scripts/validation.js'; console.log(JSON.stringify(sourceIdentity(process.cwd())))"], cwd=root, text=True)
record = dict(source=json.loads(source), columns=args.columns, rows=args.rows,
              requestedSeconds=args.seconds, node=subprocess.check_output(['node', '--version'], text=True).strip())
pid, master = pty.fork()
if pid == 0:
    os.chdir(root)
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', args.rows, args.columns, 0, 0))
    os.execvpe('node', ['node', '--import', 'tsx', 'tui-render/tests/fixtures/output-soak.tsx', str(prefix)],
               dict(os.environ, TERM='xterm-256color', COLORTERM='truecolor'))

capture = bytearray()
def drain(seconds):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        ready, _, _ = select.select([master], [], [], min(.02, max(0, until-time.monotonic())))
        if ready:
            try: part = os.read(master, 262144)
            except OSError: return
            if not part: return
            capture.extend(part)

try:
    ready = Path(str(prefix)+'.ready')
    for _ in range(600):
        if ready.exists(): break
        drain(.05)
    if not ready.exists(): raise RuntimeError(capture[-4000:].decode(errors='replace'))
    start = time.monotonic()
    step = 0
    while time.monotonic()-start < args.seconds:
        elapsed = time.monotonic()-start
        next_step = int(elapsed / 3)
        if next_step != step:
            step = next_step
            # Selection never changes the canonical composer. Release before resize.
            os.write(master, b'\x1b[<0;3;3M\x1b[<32;8;3M\x1b[<0;8;3m')
            columns = args.columns if step % 2 == 0 else max(40, args.columns-8)
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', args.rows, columns, 0, 0))
        drain(.05)
    os.kill(pid, signal.SIGTERM)
    drain(.6)
    record['elapsedSeconds'] = time.monotonic()-start
finally:
    Path(str(prefix)+'.ansi').write_bytes(capture)
    Path(str(prefix)+'.run.json').write_text(json.dumps(record, indent=2)+'\n')
    try: os.kill(pid, signal.SIGTERM)
    except ProcessLookupError: pass
    os.close(master)
    os.waitpid(pid, 0)
print(str(prefix))
