import responses

from get_cloudflare_ips import (
    CLOUDFLARE_IPV4_LIST_URL,
    CLOUDFLARE_IPV6_LIST_URL,
    get_cloudflare_ips,
)


@responses.activate
def test_get_cloudflare_ips():
    IPV4_LIST_MOCK = "1.1.1.1/20\n2.2.2.2/18\n3.3.3.3/16"
    IPV6_LIST_MOCK = "4444:5555::/32\n6666:7777::/26"
    EXPECTED_RESULT = "1.1.1.1/20,2.2.2.2/18,3.3.3.3/16,4444:5555::/32,6666:7777::/26"

    responses.get(CLOUDFLARE_IPV4_LIST_URL, body=IPV4_LIST_MOCK)
    responses.get(CLOUDFLARE_IPV6_LIST_URL, body=IPV6_LIST_MOCK)

    result = get_cloudflare_ips()

    assert result == EXPECTED_RESULT
