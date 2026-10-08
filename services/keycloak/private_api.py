"""Private Keycloak API transport through Railway SSH.

Curl configuration and credentials travel through stdin. Errors report only
HTTP status and request path, never secret values or response bodies.
"""

import json
import subprocess
import urllib.parse

PROJECT = "1ca64bca-3c33-4155-9ad5-104306f5119e"


def request(
    base, path, method="GET", body=None, token=None, form=False, return_location=False
):
    config = [
        "url = " + json.dumps(base + path),
        "request = " + json.dumps(method),
        'header = "X-Forwarded-Proto: https"',
        'header = "X-Forwarded-Host: mcp.janejeon.dev"',
    ]
    if token:
        config.append("header = " + json.dumps("Authorization: Bearer " + token))
    if body is not None:
        content_type = (
            "application/x-www-form-urlencoded" if form else "application/json"
        )
        config.append("header = " + json.dumps("Content-Type: " + content_type))
        data = urllib.parse.urlencode(body) if form else json.dumps(body)
        config.append("data = " + json.dumps(data))
    result = subprocess.run(
        [
            "railway",
            "ssh",
            "--project",
            PROJECT,
            "--environment",
            "production",
            "--service",
            "Whatsapp MCP",
            "--",
            "curl",
            "--config",
            "-",
            "--silent",
            "--show-error",
            "--write-out",
            "\\n%{http_code}" + ("\\n%header{location}" if return_location else ""),
        ],
        input="\n".join(config) + "\n",
        text=True,
        capture_output=True,
        timeout=45,
    )
    if result.returncode:
        raise RuntimeError(f"Private request transport failed for {method} {path}")
    output = "\n".join(
        line
        for line in result.stdout.splitlines()
        if not line.startswith("Using SSH key from agent:")
    ).strip()
    location = None
    if return_location:
        output, separator, location = output.rpartition("\n")
        if not separator or not location:
            raise RuntimeError("Private API did not identify the created resource")
    payload, separator, status = output.rpartition("\n")
    if not separator:
        payload, status = "", output
    if int(status) not in (200, 201, 204):
        raise RuntimeError(f"Private API returned HTTP {status} for {method} {path}")
    value = json.loads(payload) if payload.strip() else None
    return (value, location) if return_location else value
