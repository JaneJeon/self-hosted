import pytest
import requests
import responses

from src.requests_session import get_session


@responses.activate
def test_request_session_throws_by_default():
    """
    Test the default behaviour of the session that it throws on 4xx and 5xx HTTP status codes.
    """
    TEST_URL = "https://www.example.com"

    responses.get(TEST_URL, status=404)

    session = get_session()

    # Assert that HTTP errors are thrown, and not silently returned.
    with pytest.raises(requests.exceptions.HTTPError):
        session.get(TEST_URL)
