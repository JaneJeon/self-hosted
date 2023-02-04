import responses

from fixtures.mocks.cloudflare_ips import mock_cloudflare_ips
from src.get_cloudflare_ips import get_cloudflare_ips


@responses.activate
def test_get_cloudflare_ips():
    """
    Test that the get_cloudflare_ips() function returns the list of IP addresses correctly.
    """
    EXPECTED_RESULT = "1.1.1.1/20,2.2.2.2/18,3.3.3.3/16,4444:5555::/32,6666:7777::/26"

    mock_cloudflare_ips()

    result = get_cloudflare_ips()

    assert result == EXPECTED_RESULT


# NOTE: not testing any "failure cases" here because we expect any HTTP errors to immediately throw anyway,
# halting execution.
