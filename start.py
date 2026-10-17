"""Start the app detached, preserving the process across SSH disconnects."""
import os
import subprocess
import sys
import time
from pathlib import Path

root = Path(__file__).resolve().parent
pid_file = root / 'server.pid'
if pid_file.exists():
    try:
        pid = int(pid_file.read_text())
        command = Path(f'/proc/{pid}/cmdline').read_bytes()
        if str(root / 'serve.py').encode() in command:
            print(f'Warehouse app is already running (PID {pid}).')
            raise SystemExit(0)
    except (FileNotFoundError, ValueError, ProcessLookupError):
        pass
with (root / 'server.log').open('ab') as log:
    process = subprocess.Popen([str(root / '.venv/bin/python'), str(root / 'serve.py')],
                               cwd=root, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                               start_new_session=True)
pid_file.write_text(str(process.pid))
time.sleep(1)
if process.poll() is not None:
    print('Server exited. Read server.log for details.')
    raise SystemExit(1)
print(f'Started warehouse app on 127.0.0.1:8765 (PID {process.pid}).')
