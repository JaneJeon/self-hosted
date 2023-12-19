from src.log_invocation import log_invocation
from src.requests_session import get_session

CLOUDFLARE_IPV4_LIST_URL = "https://www.cloudflare.com/ips-v4"
CLOUDFLARE_IPV6_LIST_URL = "https://www.cloudflare.com/ips-v6"


@log_invocation
def get_cloudflare_ips() -> str:
    """
    Returns a concatenated list of Cloudflare's IPs (both IPv4 and IPv6).
    Useful for whitelisting IPs, as we want to make sure all connections are proxied by Cloudflare,
    and block off anyone trying to bypass Cloudflare's protections by making direct connections to the server.
    """
    session = get_session()

    # with the requests upgrade, urllib3 broke and I need to specify super short timeout for requests to actually work?
    ipv4s = session.get(CLOUDFLARE_IPV4_LIST_URL, timeout=1).text.split("\n")
    ipv6s = session.get(CLOUDFLARE_IPV6_LIST_URL, timeout=1).text.split("\n")

    return sorted(ipv4s + ipv6s)
