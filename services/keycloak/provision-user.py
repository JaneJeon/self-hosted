#!/usr/bin/env python3
"""Provision the authorized permanent MCP identity through the private API.

Use direnv for credentials. The password never enters argv or tool output.
Existing identities are not reset by this script.
"""

import importlib.util
import json
import os
import subprocess
import urllib.parse
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "private_api", Path(__file__).with_name("provision-test-user.py")
)
private_api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(private_api)
request = private_api.request


def main():
    username = os.environ["MCP_PERMANENT_USERNAME"]
    password = os.environ["MCP_PERMANENT_PASSWORD"]
    values = json.loads(
        subprocess.run(
            ["railway", "variable", "list", "--service", "Keycloak", "--json"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    )
    base = values["PRIVATE_URL"]
    admin_prefix = (
        "KC_ADMIN" if os.environ.get("KC_ADMIN_CLIENT_ID") else "KC_BOOTSTRAP_ADMIN"
    )
    token = request(
        base,
        "/realms/master/protocol/openid-connect/token",
        "POST",
        {
            "grant_type": "client_credentials",
            "client_id": os.environ[admin_prefix + "_CLIENT_ID"],
            "client_secret": os.environ[admin_prefix + "_CLIENT_SECRET"],
        },
        form=True,
    )["access_token"]
    realm = "/admin/realms/personal"
    users = request(
        base,
        realm
        + "/users?"
        + urllib.parse.urlencode({"username": username, "exact": "true"}),
        token=token,
    )
    if users:
        if len(users) != 1 or users[0]["username"].casefold() != username.casefold():
            raise RuntimeError("Unexpected identity; refusing to modify it")
        print("Permanent identity already exists; password was not changed")
    else:
        # Email is not needed for this username/password-only service. Password
        # reset and public registration remain disabled. Preserve other profile
        # requirements and validators, rather than disabling profile validation.
        profile = request(base, realm + "/users/profile", token=token)
        for attribute in profile["attributes"]:
            if attribute["name"] == "email":
                attribute.pop("required", None)
        request(base, realm + "/users/profile", "PUT", profile, token)
        request(
            base,
            realm + "/users",
            "POST",
            {
                "username": username,
                "enabled": True,
                "firstName": os.environ["MCP_PERMANENT_FIRST_NAME"],
                "lastName": os.environ["MCP_PERMANENT_LAST_NAME"],
                "requiredActions": [],
                "credentials": [
                    {"type": "password", "temporary": False, "value": password}
                ],
            },
            token,
        )
        users = request(
            base,
            realm
            + "/users?"
            + urllib.parse.urlencode({"username": username, "exact": "true"}),
            token=token,
        )
    subject = users[0]["id"]
    role = request(base, realm + "/roles/mcp-use", token=token)
    request(
        base, realm + f"/users/{subject}/role-mappings/realm", "POST", [role], token
    )
    management = request(
        base, realm + "/clients?clientId=realm-management", token=token
    )[0]
    roles = [
        request(base, realm + f"/clients/{management['id']}/roles/{name}", token=token)
        for name in ("view-realm", "view-clients", "query-clients")
    ]
    request(
        base,
        realm + f"/users/{subject}/role-mappings/clients/{management['id']}",
        "POST",
        roles,
        token,
    )
    target = Path(__file__).with_name(".env")
    lines = [
        line
        for line in target.read_text().splitlines()
        if not line.startswith("MCP_PERMANENT_SUB=")
    ]
    target.write_text("\n".join(lines + ["MCP_PERMANENT_SUB=" + subject]) + "\n")
    target.chmod(0o600)
    print(
        "Permanent identity and MCP read roles provisioned; subject recorded privately"
    )


if __name__ == "__main__":
    main()
