#!/usr/bin/env python3
"""Cold-launch an installed app and fail if it exits during the observation window.

Use a disposable, already booted simulator. This terminates only the specified app.
Example: DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer python3 \
  ios_next/scripts/check-simulator-launch.py DEVICE_UUID --output /tmp/cpu-launch-qa
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('device')
parser.add_argument('--bundle', default='cn.cputime.mobile')
parser.add_argument('--rounds', type=int, default=3)
parser.add_argument('--seconds', type=int, default=10)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
if args.rounds < 1 or args.seconds < 1:
    parser.error('rounds and seconds must be positive')
args.output.mkdir(parents=True, exist_ok=True)


def sim(*command, check=True):
    return subprocess.run(['xcrun', 'simctl', *command], text=True, capture_output=True, check=check)


def alive(pid):
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'stat=,comm='], text=True, capture_output=True)
    return result.returncode == 0 and result.stdout.strip() and not result.stdout.lstrip().startswith('Z')


report = {'device': args.device, 'bundle': args.bundle, 'rounds': [], 'passed': False}
try:
    for index in range(args.rounds):
        sim('terminate', args.device, args.bundle, check=False)
        result = sim('launch', args.device, args.bundle)
        match = re.search(r': (\d+)\s*$', result.stdout)
        if not match:
            raise RuntimeError(f'No process ID in launch response: {result.stdout} {result.stderr}')
        pid = int(match.group(1))
        for _ in range(args.seconds):
            time.sleep(1)
            if not alive(pid):
                raise RuntimeError(f'App exited in cold-launch round {index + 1} (PID {pid})')
        report['rounds'].append({'round': index + 1, 'pid': pid, 'observedSeconds': args.seconds})
        print(f'Cold launch {index + 1}: alive after {args.seconds}s (PID {pid})', flush=True)
    sim('io', args.device, 'screenshot', str(args.output / 'screen.png'))
    report['passed'] = True
finally:
    (args.output / 'launch.json').write_text(json.dumps(report, indent=2) + '\n')
    logs = sim('spawn', args.device, 'log', 'show', '--last', '3m', '--style', 'compact',
               '--predicate', 'process == "CpuTime"', check=False)
    (args.output / 'app.log').write_text(logs.stdout + logs.stderr)
