#!/usr/bin/env python3
"""Prepare the owner's private browser console using cached direnv credentials.

This creates a distinct master-realm user. Public personal-realm MCP users,
roles and passwords are not modified. Existing passwords are never reset.
"""

import argparse
import json
import os
import subprocess
import urllib.parse
import uuid
from pathlib import Path

from private_api import request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-record", required=True, type=Path)
    args = parser.parse_args()
    record = args.owner_record
    if record.is_symlink():
        raise RuntimeError("Owner receipt must not be a symlink")
    values = json.loads(
        subprocess.run(
            ["railway", "variable", "list", "--service", "Keycloak", "--json"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    )
    base = values["PRIVATE_URL"]
    console_base = values["KC_HOSTNAME_ADMIN"]
    address = urllib.parse.urlsplit(console_base)
    if (
        address.scheme != "https"
        or not address.hostname.endswith(".ts.net")
        or address.port != 8443
        or address.path != "/auth"
    ):
        raise RuntimeError("Expected the configured private HTTPS console URL")

    def admin_token():
        return request(
            base,
            "/realms/master/protocol/openid-connect/token",
            "POST",
            {
                "grant_type": "client_credentials",
                "client_id": os.environ["KC_ADMIN_CLIENT_ID"],
                "client_secret": os.environ["KC_ADMIN_CLIENT_SECRET"],
            },
            form=True,
        )["access_token"]

    token = admin_token()
    realm = "/admin/realms/master"
    username = os.environ["MCP_PERMANENT_USERNAME"]
    query = urllib.parse.urlencode({"username": username, "exact": "true"})
    users = request(base, realm + "/users?" + query, token=token)
    if users:
        if len(users) != 1 or users[0]["username"].casefold() != username.casefold():
            raise RuntimeError("Unexpected console identity; refusing modification")
        if not record.exists():
            raise RuntimeError("Existing console identity has no ownership receipt")
        saved = json.loads(record.read_text())
        if saved != {
            "realm": "master",
            "username": username,
            "subject": users[0]["id"],
        }:
            raise RuntimeError("Console identity does not match its ownership receipt")
    else:
        if record.exists():
            raise RuntimeError(
                "Recorded console owner disappeared; refusing recreation"
            )
        _, location = request(
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
                    {
                        "type": "password",
                        "temporary": False,
                        "value": os.environ["MCP_PERMANENT_PASSWORD"],
                    }
                ],
            },
            token,
            return_location=True,
        )
        created_id = str(
            uuid.UUID(urllib.parse.urlsplit(location).path.rsplit("/", 1)[-1])
        )
        users = request(base, realm + "/users?" + query, token=token)
        if len(users) != 1 or users[0]["id"] != created_id:
            raise RuntimeError(
                "Created console identity changed before role assignment"
            )
        record.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(record, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as receipt:
            json.dump(
                {"realm": "master", "username": username, "subject": created_id},
                receipt,
            )
    if len(users) != 1 or not users[0]["enabled"]:
        raise RuntimeError("Console identity is unavailable")
    role = request(base, realm + "/roles/admin", token=token)
    mapping = realm + f"/users/{users[0]['id']}/role-mappings/realm"
    request(base, mapping, "POST", [role], token)
    if not any(r["id"] == role["id"] for r in request(base, mapping, token=token)):
        raise RuntimeError("Private console owner role was not assigned")
    settings = request(base, realm, token=token)
    attributes = settings.get("attributes", {})
    if attributes.get("frontendUrl") != console_base:
        # Master browser authorization must remain on the private hostname.
        # The public personal realm's issuer remains unchanged.
        request(
            base,
            realm,
            "PUT",
            {"attributes": {**attributes, "frontendUrl": console_base}},
            token,
        )
        token = admin_token()
    if request(base, realm, token=token)["attributes"]["frontendUrl"] != console_base:
        raise RuntimeError("Private master browser origin was not retained")
    personal = request(base, "/realms/personal/.well-known/openid-configuration")
    if personal["issuer"] != "https://mcp.janejeon.dev/auth/realms/personal":
        raise RuntimeError("Public MCP issuer unexpectedly changed")
    print(
        "Private console owner and master origin verified; existing passwords preserved"
    )
    print(console_base + "/admin/master/console/")


if __name__ == "__main__":
    main()
