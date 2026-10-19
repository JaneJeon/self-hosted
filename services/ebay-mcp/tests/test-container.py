#!/usr/bin/env python3
"""Container-level checks for the official eBay MCP image."""

from __future__ import annotations

import os
import subprocess
import time
import unittest
import uuid
from pathlib import Path

IMAGE = os.environ.get("EBAY_MCP_TEST_IMAGE", "codex-official-ebay:20261019")
SERVICE_DIR = Path(__file__).resolve().parents[1]


def docker(*args: str, timeout: int = 90) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        check=False,
    )


class EbayMcpContainerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = docker("image", "inspect", IMAGE, timeout=20)
        if result.returncode:
            raise RuntimeError(f"Test image is unavailable: {IMAGE}")

    def test_raw_and_encoded_repeated_path_variables_are_encoded(self) -> None:
        script = r"""
import assert from 'node:assert/strict';
import { buildFinalUrl } from '/app/dist/helper/http-helper.js';

const variables = {
  item_id: '123/child?x=1&y=a+b',
  query: 'a b/?&=+',
};
const expected = 'https://api.example/v1/items/123%2Fchild%3Fx%3D1%26y%3Da%2Bb'
  + '?q=a%20b%2F%3F%26%3D%2B&path=123%2Fchild%3Fx%3D1%26y%3Da%2Bb'
  + '&again=123%2Fchild%3Fx%3D1%26y%3Da%2Bb';

assert.equal(
  buildFinalUrl(
    'https://api.example/v1/items/{item_id}?q={query}'
      + '&path=%7Bitem_id%7D&again={item_id}',
    variables,
  ),
  expected,
);
console.log('URL substitution assertions passed');
"""
        result = docker(
            "run",
            "--rm",
            "--entrypoint",
            "node",
            IMAGE,
            "--input-type=module",
            "-e",
            script,
        )
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("URL substitution assertions passed", result.stdout)

    def test_missing_credentials_wait_without_listening_on_8080(self) -> None:
        name = f"ebay-mcp-test-{uuid.uuid4().hex[:12]}"
        started = docker("run", "--detach", "--name", name, IMAGE, timeout=30)
        self.assertEqual(started.returncode, 0, started.stdout)
        try:
            time.sleep(1.5)
            state = docker("inspect", "--format", "{{.State.Status}}", name, timeout=20)
            self.assertEqual(state.returncode, 0, state.stdout)
            self.assertEqual(state.stdout.strip(), "running")

            for table in ("tcp", "tcp6"):
                listeners = docker(
                    "exec",
                    name,
                    "awk",
                    'NR > 1 && $2 ~ /:1F90$/ && $4 == "0A" { found=1 } END { exit !found }',
                    f"/proc/net/{table}",
                    timeout=20,
                )
                self.assertEqual(
                    listeners.returncode,
                    1,
                    f"Unexpected /proc check result for {table}: {listeners.stdout}",
                )

            logs = docker("logs", name, timeout=20)
            self.assertEqual(logs.returncode, 0, logs.stdout)
            self.assertIn("Waiting for eBay application credentials", logs.stdout)
        finally:
            docker("rm", "--force", name, timeout=30)

    def test_whitespace_credentials_fail_without_echoing_values(self) -> None:
        synthetic_id = " synthetic-ebay-client-id-marker "
        synthetic_secret = "synthetic-ebay-secret-marker"
        result = docker(
            "run",
            "--rm",
            "--entrypoint",
            "/usr/local/bin/entrypoint",
            "--env",
            f"EBAY_CLIENT_ID={synthetic_id}",
            "--env",
            f"EBAY_CLIENT_SECRET={synthetic_secret}",
            IMAGE,
            timeout=30,
        )
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn(
            "EBAY_CLIENT_ID is missing or has surrounding whitespace", result.stdout
        )
        self.assertNotIn(synthetic_id, result.stdout)
        self.assertNotIn(synthetic_secret, result.stdout)

    def test_runtime_must_remain_production_application_mode(self) -> None:
        result = docker(
            "run",
            "--rm",
            "--entrypoint",
            "/usr/local/bin/entrypoint",
            "--env",
            "EBAY_CLIENT_ID=synthetic-client-id",
            "--env",
            "EBAY_CLIENT_SECRET=synthetic-client-secret",
            "--env",
            "EBAY_API_ENV=sandbox",
            IMAGE,
            timeout=30,
        )
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn(
            "This deployment requires production application-token mode",
            result.stdout,
        )
        self.assertNotIn("synthetic-client-id", result.stdout)
        self.assertNotIn("synthetic-client-secret", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
