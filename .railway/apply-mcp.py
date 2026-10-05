#!/usr/bin/env python3
"""Apply one pinned MCP plan, allowing only retired bootstrap variable removal."""

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

PROJECT = "1ca64bca-3c33-4155-9ad5-104306f5119e"
ENVIRONMENT = "f9b71e64-8a4c-4f0d-a68e-576fa3ca016b"
BOOTSTRAP_VARIABLES = {
    "KC_BOOTSTRAP_ADMIN_CLIENT_ID",
    "KC_BOOTSTRAP_ADMIN_CLIENT_SECRET",
}


def validate_plan(preview, pinned):
    scope = preview.get("currentEnvironment", {})
    if scope.get("projectId") != PROJECT or scope.get("environmentId") != ENVIRONMENT:
        raise RuntimeError("MCP plan targets an unexpected project or environment")
    if (
        pinned.get("kind") != "railway.config.plan"
        or pinned.get("version") != 1
        or pinned.get("cliVersion") != "5.54.1"
        or pinned.get("environmentId") != ENVIRONMENT
    ):
        raise RuntimeError("Unexpected pinned MCP plan format or CLI version")
    changes = pinned.get("changeSet", {}).get("changes")
    if not isinstance(changes, list):
        raise RuntimeError("Pinned MCP plan has no change list")
    destructive = []
    for change in changes:
        severity = change.get("severity")
        if severity not in ("safe", "destructive"):
            raise RuntimeError("MCP plan contains an unknown change severity")
        if severity == "destructive":
            variable = change.get("variable")
            if (
                change.get("kind") != "variable.delete"
                or change.get("address") != "service.Keycloak"
                or variable not in BOOTSTRAP_VARIABLES
                or change.get("path")
                != f"resources.service.Keycloak.variables.{variable}"
            ):
                raise RuntimeError(
                    "MCP plan contains an unauthorized destructive change"
                )
            destructive.append(variable)
        elif change.get("kind", "").endswith(".delete"):
            raise RuntimeError("MCP plan mislabeled a deletion as safe")
    if len(destructive) != len(set(destructive)):
        raise RuntimeError("MCP plan repeats a bootstrap variable deletion")
    if pinned.get("destructive") is not bool(destructive):
        raise RuntimeError("MCP plan's destructive flag disagrees with its changes")
    return len(changes), len(destructive)


def validate_apply_result(report):
    # --plan returns ChangeSetApplyResult directly, not RunnerResponse.ok.
    if report.get("status") not in ("applied", "noop"):
        raise RuntimeError("Railway did not confirm the pinned apply")
    changes = report.get("changes")
    if not isinstance(changes, list) or any(
        change.get("status") not in ("applied", "noop") for change in changes
    ):
        raise RuntimeError("Pinned MCP apply has unconfirmed operation results")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    executable = shutil.which("railway")
    if not executable:
        raise RuntimeError("Railway CLI is unavailable")
    command_env = dict(os.environ)
    # The SDK uses this executable for its minimum-CLI-version probe.
    command_env["_"] = executable
    with tempfile.TemporaryDirectory(prefix="mcp-pinned-plan-") as temporary:
        pinned_path = Path(temporary) / "plan.json"
        preview = subprocess.run(
            [executable, "config", "plan", "--json", "--out", str(pinned_path)],
            capture_output=True,
            text=True,
            check=True,
            env=command_env,
            timeout=180,
        )
        pinned_path.chmod(0o600)
        count, removals = validate_plan(
            json.loads(preview.stdout), json.loads(pinned_path.read_text())
        )
        print(f"Validated {count} MCP changes; {removals} retired bootstrap removals")
        if args.check_only:
            return
        command = [
            executable,
            "config",
            "apply",
            "--plan",
            str(pinned_path),
            "--yes",
            "--json",
        ]
        if removals:
            command.append("--confirm-destructive")
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
            env=command_env,
            timeout=300,
        )
        validate_apply_result(json.loads(result.stdout))
        print("Pinned MCP configuration applied")


if __name__ == "__main__":
    main()
