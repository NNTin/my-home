#!/usr/bin/env python3
"""Write published image digests into the chart so a packaged chart deploys without extra values.

Usage: stamp-chart-digests.py API_DIGEST WEB_DIGEST [VALUES_FILE]
"""
import pathlib
import re
import sys

DIGEST = re.compile(r'^sha256:[a-f0-9]{64}$')
digests = {'api': sys.argv[1], 'web': sys.argv[2]}
values = pathlib.Path(sys.argv[3] if len(sys.argv) > 3 else 'charts/my-home/values.yaml')
for role, digest in digests.items():
    if not DIGEST.match(digest):
        sys.exit(f'{role}: unexpected digest {digest!r}')

lines = values.read_text().splitlines(keepends=True)
role = None
stamped = set()
for index, line in enumerate(lines):
    header = re.match(r'^  (\w+):\s*$', line)
    if header:
        role = header.group(1)
        continue
    if not line.startswith('  '):
        role = None
        continue
    if role in digests and re.match(r'''^    digest: (""|'')\s*$''', line):
        lines[index] = f'    digest: "{digests[role]}"\n'
        stamped.add(role)

if stamped != set(digests):
    sys.exit(f'Expected empty digests for api and web; stamped only {sorted(stamped)}')
values.write_text(''.join(lines))
print('Stamped chart digests: api, web')
