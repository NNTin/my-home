#!/usr/bin/env python3
"""Delete old pull request images and staging charts from GHCR (see .github/workflows/cleanup-packages.yml).

A version is deleted only when it is older than MAX_AGE_DAYS and not among the KEEP newest candidates, so
whatever staging currently runs stays pullable.
  images (my-home-api, my-home-web): versions with a pr-* tag and no main, v* or latest tag
  chart (charts/my-home): versions tagged 0.1.0-staging.*
"""
import datetime
import json
import os
import subprocess

OWNER = os.environ.get('OWNER', 'NNTin')
DRY_RUN = bool(os.environ.get('DRY_RUN'))
MAX_AGE_DAYS = 14
KEEP = 10


def gh(*args):
    result = subprocess.run(['gh', 'api', *args], check=True, capture_output=True, text=True)
    return json.loads(result.stdout) if result.stdout.strip() else None


def versions(package):
    name = package.replace('/', '%2F')
    page, found = 1, []
    while True:
        batch = gh(f'/users/{OWNER}/packages/container/{name}/versions?per_page=100&page={page}')
        found += batch
        if len(batch) < 100:
            return found
        page += 1


def is_pr_image(tags):
    return any(t.startswith('pr-') for t in tags) and not any(
        t == 'main' or t == 'latest' or t.startswith('v') for t in tags
    )


def is_staging_chart(tags):
    return bool(tags) and all(t.startswith('0.1.0-staging.') for t in tags)


cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=MAX_AGE_DAYS)
for package, candidate in [('my-home-api', is_pr_image), ('my-home-web', is_pr_image), ('charts/my-home', is_staging_chart)]:
    try:
        pages = versions(package)
    except subprocess.CalledProcessError as error:
        print(f'{package}: cannot list versions ({error.stderr.strip()}); skipped')
        continue
    found = [v for v in pages if candidate(v['metadata']['container']['tags'])]
    found.sort(key=lambda v: v['created_at'], reverse=True)
    for version in found[KEEP:]:
        created = datetime.datetime.fromisoformat(version['created_at'].replace('Z', '+00:00'))
        if created >= cutoff:
            continue
        tags = ','.join(version['metadata']['container']['tags'])
        print(f'{"would delete" if DRY_RUN else "deleting"} {package} {tags} ({version["created_at"]})')
        if not DRY_RUN:
            name = package.replace('/', '%2F')
            gh('-X', 'DELETE', f'/users/{OWNER}/packages/container/{name}/versions/{version["id"]}')
    print(f'{package}: {len(found)} candidates, kept the newest {KEEP} and everything younger than {MAX_AGE_DAYS} days')
