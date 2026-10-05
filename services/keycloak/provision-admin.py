#!/usr/bin/env python3
"""Provision and verify the private Keycloak maintenance client.

The bootstrap client creates this client and grants the service account the
master realm admin role. Retirement is an explicit, guarded second step.
"""

import argparse
import base64
import hmac
import json
import os
import subprocess
import urllib.parse

from private_api import request

ADMIN_ROLE = "admin"
MAINTENANCE_CLIENT_ID = "mcp-maintenance"
RETIRABLE_BOOTSTRAP_ID = "migration-bootstrap"
CLIENT_SETTINGS = {
    "protocol": "openid-connect",
    "enabled": True,
    "clientAuthenticatorType": "client-secret",
    "publicClient": False,
    "standardFlowEnabled": False,
    "directAccessGrantsEnabled": False,
    "implicitFlowEnabled": False,
    "serviceAccountsEnabled": True,
    "fullScopeAllowed": False,
}


def _one_client(request, base, client_id, token):
    query = urllib.parse.urlencode({"clientId": client_id, "exact": "true"})
    clients = request(base, "/admin/realms/master/clients?" + query, token=token)
    if not isinstance(clients, list) or len(clients) > 1:
        raise RuntimeError("Unexpected client lookup result; refusing to proceed")
    if any(client.get("clientId") != client_id for client in clients):
        raise RuntimeError("Client lookup returned a different ID; refusing to proceed")
    return clients[0] if clients else None


def _client_secret(request, base, internal_id, token):
    result = request(
        base,
        f"/admin/realms/master/clients/{internal_id}/client-secret",
        token=token,
    )
    value = result.get("value") if isinstance(result, dict) else None
    return value if isinstance(value, str) else None


def _verify_client(request, base, client, expected_id, expected_secret, token):
    if client.get("clientId") != expected_id or any(
        client.get(name) != value for name, value in CLIENT_SETTINGS.items()
    ):
        raise RuntimeError(
            "Maintenance client settings do not match; refusing to modify it"
        )
    actual_secret = _client_secret(request, base, client["id"], token)
    if actual_secret is None or not hmac.compare_digest(actual_secret, expected_secret):
        raise RuntimeError(
            "Maintenance client secret does not match; refusing to reset it"
        )


def _access_token(request, base, client_id, client_secret):
    result = request(
        base,
        "/realms/master/protocol/openid-connect/token",
        "POST",
        {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        },
        form=True,
    )
    token = result.get("access_token") if isinstance(result, dict) else None
    if not isinstance(token, str) or not token:
        raise RuntimeError("Client credentials grant returned no access token")
    return token


def _jwt_claims(token):
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        result = json.loads(base64.urlsafe_b64decode(payload))
    except (IndexError, ValueError, json.JSONDecodeError):
        raise RuntimeError("Keycloak returned an invalid access token") from None
    if not isinstance(result, dict):
        raise RuntimeError("Keycloak returned an invalid access token")
    return result


def _role_names(mappings):
    if not isinstance(mappings, list):
        return set()
    return {item.get("name") for item in mappings if isinstance(item, dict)}


def _ensure_role(request, base, path, role, token):
    mappings = request(base, path, token=token)
    if role["name"] not in _role_names(mappings):
        request(base, path, "POST", [role], token)


def _verify_admin_access(request, base, client_id, client_secret):
    token = _access_token(request, base, client_id, client_secret)
    claims = _jwt_claims(token)
    realm_roles = claims.get("realm_access", {}).get("roles", [])
    if ADMIN_ROLE not in realm_roles:
        raise RuntimeError("Maintenance token lacks the master realm admin role")
    for realm_name in ("master", "personal"):
        result = request(base, f"/admin/realms/{realm_name}", token=token)
        if not isinstance(result, dict) or result.get("realm") != realm_name:
            raise RuntimeError(
                f"Maintenance token could not verify {realm_name} admin state"
            )
    return token


def _is_auth_rejection(error):
    status = getattr(error, "status", None)
    if status is not None:
        return status in (400, 401)
    message = str(error)
    return "HTTP 400" in message or "HTTP 401" in message


def _retire_bootstrap(
    request,
    base,
    bootstrap_id,
    bootstrap_secret,
    maintenance_client,
    admin_id,
    admin_secret,
    maintenance_token,
):
    bootstrap = _one_client(request, base, bootstrap_id, maintenance_token)
    if bootstrap is None:
        raise RuntimeError("Bootstrap client is absent; refusing retirement")
    if bootstrap["id"] == maintenance_client["id"]:
        raise RuntimeError("Bootstrap and maintenance client UUIDs must differ")

    request(
        base,
        f"/admin/realms/master/clients/{bootstrap['id']}",
        "DELETE",
        token=maintenance_token,
    )

    try:
        _access_token(request, base, bootstrap_id, bootstrap_secret)
    except Exception as error:
        if not _is_auth_rejection(error):
            raise RuntimeError(
                "Could not confirm bootstrap client rejection after retirement"
            ) from None
    else:
        raise RuntimeError("Retired bootstrap client still obtained an access token")

    maintenance = _one_client(
        request,
        base,
        admin_id,
        _access_token(request, base, admin_id, admin_secret),
    )
    if maintenance is None or maintenance.get("id") != maintenance_client.get("id"):
        raise RuntimeError("Maintenance client is missing after bootstrap retirement")
    _verify_admin_access(request, base, admin_id, admin_secret)


def provision(
    request,
    base,
    bootstrap_id,
    bootstrap_secret,
    admin_id,
    admin_secret,
    retire_bootstrap=False,
):
    """Create or verify the maintenance client using an injected API requester."""
    if not all(
        isinstance(value, str) and value
        for value in (
            base,
            bootstrap_id,
            bootstrap_secret,
            admin_id,
            admin_secret,
        )
    ):
        raise RuntimeError("Required Keycloak provisioning input is missing")
    if (
        bootstrap_secret != bootstrap_secret.strip()
        or admin_secret != admin_secret.strip()
    ):
        raise RuntimeError(
            "Keycloak client secrets must not have leading or trailing whitespace"
        )
    if admin_id != MAINTENANCE_CLIENT_ID:
        raise RuntimeError("Maintenance client ID must be mcp-maintenance")
    if bootstrap_id == admin_id:
        raise RuntimeError("Bootstrap and maintenance client IDs must differ")
    if retire_bootstrap and bootstrap_id != RETIRABLE_BOOTSTRAP_ID:
        raise RuntimeError("Bootstrap retirement is restricted to migration-bootstrap")

    bootstrap_token = _access_token(request, base, bootstrap_id, bootstrap_secret)
    client = _one_client(request, base, admin_id, bootstrap_token)
    created = client is None
    if created:
        representation = {
            "clientId": admin_id,
            "secret": admin_secret,
            **CLIENT_SETTINGS,
        }
        request(
            base,
            "/admin/realms/master/clients",
            "POST",
            representation,
            token=bootstrap_token,
        )
        client = _one_client(request, base, admin_id, bootstrap_token)
        if client is None:
            raise RuntimeError("Maintenance client creation was not observable")
        try:
            _verify_client(
                request, base, client, admin_id, admin_secret, bootstrap_token
            )
        except Exception:
            # This UUID was created by this invocation; remove only that new client.
            request(
                base,
                f"/admin/realms/master/clients/{client['id']}",
                "DELETE",
                token=bootstrap_token,
            )
            raise
    else:
        _verify_client(request, base, client, admin_id, admin_secret, bootstrap_token)

    service_account = request(
        base,
        f"/admin/realms/master/clients/{client['id']}/service-account-user",
        token=bootstrap_token,
    )
    if not isinstance(service_account, dict) or not service_account.get("id"):
        raise RuntimeError("Maintenance client service account is unavailable")

    admin_role = request(
        base,
        f"/admin/realms/master/roles/{ADMIN_ROLE}",
        token=bootstrap_token,
    )
    _ensure_role(
        request,
        base,
        f"/admin/realms/master/users/{service_account['id']}/role-mappings/realm",
        admin_role,
        bootstrap_token,
    )
    _ensure_role(
        request,
        base,
        f"/admin/realms/master/clients/{client['id']}/scope-mappings/realm",
        admin_role,
        bootstrap_token,
    )

    # Mint and use the new client's token before any optional bootstrap removal.
    maintenance_token = _verify_admin_access(request, base, admin_id, admin_secret)
    if retire_bootstrap:
        _retire_bootstrap(
            request,
            base,
            bootstrap_id,
            bootstrap_secret,
            client,
            admin_id,
            admin_secret,
            maintenance_token,
        )
    return {"clientId": admin_id, "retiredBootstrap": bool(retire_bootstrap)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--retire-bootstrap",
        action="store_true",
        help="Retire migration-bootstrap after verifying maintenance access",
    )
    args = parser.parse_args()

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
    result = provision(
        request,
        base,
        os.environ["KC_BOOTSTRAP_ADMIN_CLIENT_ID"],
        os.environ["KC_BOOTSTRAP_ADMIN_CLIENT_SECRET"],
        os.environ["KC_ADMIN_CLIENT_ID"],
        os.environ["KC_ADMIN_CLIENT_SECRET"],
        retire_bootstrap=args.retire_bootstrap,
    )
    if result["retiredBootstrap"]:
        print("Maintenance client verified; migration-bootstrap retired")
    else:
        print("Maintenance client provisioned and verified")


if __name__ == "__main__":
    main()
