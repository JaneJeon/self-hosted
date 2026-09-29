#!/usr/bin/env python3
"""Provision the temporary migration user through Railway's private network.

Run with `direnv exec services/keycloak python3
services/keycloak/provision-test-user.py` after Keycloak starts. Secrets travel
through subprocess stdin only. The bootstrap administrator stays private.
"""

import json
import os
import subprocess
import urllib.parse
from pathlib import Path

PROJECT = "1ca64bca-3c33-4155-9ad5-104306f5119e"


def request(base, path, method="GET", body=None, token=None, form=False):
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
            "\\n%{http_code}",
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
    payload, separator, status = output.rpartition("\n")
    if not separator:
        payload, status = "", output
    if int(status) not in (200, 201, 204):
        raise RuntimeError(f"Private API returned HTTP {status} for {method} {path}")
    return json.loads(payload) if payload.strip() else None


def main():
    values = json.loads(
        subprocess.run(
            ["railway", "variable", "list", "--service", "Keycloak", "--json"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    )
    base = values["PRIVATE_URL"]
    if not isinstance(base, str) or "${{" in base:
        raise RuntimeError("Keycloak private URL did not resolve")
    token = request(
        base,
        "/realms/master/protocol/openid-connect/token",
        "POST",
        {
            "grant_type": "client_credentials",
            "client_id": os.environ["KC_BOOTSTRAP_ADMIN_CLIENT_ID"],
            "client_secret": os.environ["KC_BOOTSTRAP_ADMIN_CLIENT_SECRET"],
        },
        form=True,
    )["access_token"]
    realm = "/admin/realms/personal"
    # Keycloak's basic scope supplies sub. Existing realms are not updated by
    # startup imports, so reconcile the two already-registered clients too.
    basic = next(
        scope
        for scope in request(base, realm + "/client-scopes", token=token)
        if scope["name"] == "basic"
    )
    oauth_clients = []
    for client_name in ("codex", "claude"):
        client = request(base, realm + "/clients?clientId=" + client_name, token=token)[
            0
        ]
        oauth_clients.append(client)
        request(
            base,
            realm + f"/clients/{client['id']}/default-client-scopes/{basic['id']}",
            "PUT",
            token=token,
        )
    username = os.environ["MCP_TEST_USERNAME"]
    query = "?" + urllib.parse.urlencode({"username": username, "exact": "true"})
    users = request(base, realm + "/users" + query, token=token)
    if not users:
        request(
            base,
            realm + "/users",
            "POST",
            {
                "username": username,
                "enabled": True,
                "firstName": "Migration",
                "lastName": "Test",
                "email": "migration-test@example.invalid",
                "emailVerified": False,
                "credentials": [
                    {
                        "type": "password",
                        "temporary": False,
                        "value": os.environ["MCP_TEST_PASSWORD"],
                    }
                ],
            },
            token=token,
        )
        users = request(base, realm + "/users" + query, token=token)
    # Default Keycloak user profiles discard unmanaged custom attributes.
    # Match the dedicated test identity's managed fields instead.
    expected = {
        "username": username,
        "email": "migration-test@example.invalid",
        "firstName": "Migration",
        "lastName": "Test",
    }
    if len(users) != 1 or any(users[0].get(k) != v for k, v in expected.items()):
        raise RuntimeError("Refusing to modify an unexpected user")
    subject = users[0]["id"]
    role = request(base, realm + "/roles/mcp-use", token=token)
    request(
        base, realm + f"/users/{subject}/role-mappings/realm", "POST", [role], token
    )
    for oauth_client in oauth_clients:
        request(
            base,
            realm + f"/clients/{oauth_client['id']}/scope-mappings/realm",
            "POST",
            [role],
            token,
        )
    client = request(base, realm + "/clients?clientId=realm-management", token=token)[0]
    roles = [
        request(base, realm + f"/clients/{client['id']}/roles/{name}", token=token)
        for name in ("view-realm", "view-clients", "query-clients")
    ]
    request(
        base,
        realm + f"/users/{subject}/role-mappings/clients/{client['id']}",
        "POST",
        roles,
        token,
    )
    for oauth_client in oauth_clients:
        request(
            base,
            realm
            + f"/clients/{oauth_client['id']}/scope-mappings/clients/{client['id']}",
            "POST",
            roles,
            token,
        )
    target = Path(__file__).with_name(".env")
    lines = [
        line
        for line in target.read_text().splitlines()
        if not line.startswith("MCP_TEST_SUB=")
    ]
    target.write_text("\n".join(lines + ["MCP_TEST_SUB=" + subject]) + "\n")
    target.chmod(0o600)
    print(f"Temporary user {username} provisioned. Subject: {subject}")


if __name__ == "__main__":
    main()
