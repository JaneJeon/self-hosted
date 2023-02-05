import responses

from src.get_cloudflare_ips import CLOUDFLARE_IPV4_LIST_URL, CLOUDFLARE_IPV6_LIST_URL

IPV4_LIST_MOCK = "1.1.1.1/20\n2.2.2.2/18\n3.3.3.3/16"
IPV6_LIST_MOCK = "4444:5555::/32\n6666:7777::/26"


def mock_cloudflare_ips():
    """
    Returns a mocked cloudflare IPs list so that we don't end up hitting the endpoint for testing.
    It's to be a good citizen, and to keep the tests consistent.
    """
    responses.get(CLOUDFLARE_IPV4_LIST_URL, body=IPV4_LIST_MOCK)
    responses.get(CLOUDFLARE_IPV6_LIST_URL, body=IPV6_LIST_MOCK)
