import inspect
import os

import pytest
import responses

from scripts.render_all import render_all
from src.get_cloudflare_ips_mock import mock_cloudflare_ips


@responses.activate
@pytest.mark.usefixtures("fixtures_directory")
def test_integration_execute():
    """
    An integration test, checking that the script renders all templates within a folder as expected.
    Note that this test is NOT safe to run concurrently with any other test that touches fixtures folder.
    """

    FILE_TO_CHECK = "fixtures/templates/foo.yml"
    EXPECTED_VALUE = """
    default:
      ENVIRONMENT: test

    cloudflare:
      ips: 1.1.1.1/20,2.2.2.2/18,3.3.3.3/16,4444:5555::/32,6666:7777::/26
    """

    # Before running the mock execute, delete the file so that we *know* the file gets generated by calling execute().
    os.remove(FILE_TO_CHECK)

    mock_cloudflare_ips()

    # Run the render_all() like normal with two exceptions:
    # 1. Pass in a fixture .env file instead of our local, "production" .env file,
    # which has all sorts of secrets that we don't want to expose our tests (and the test artifacts) to!
    # 2. Instead of rendering down the contents of the services/ folder (which is generally what we want),
    # render the contents of the fixtures/ folder so we can actually test on it in a reproducible manner.
    render_all(env_file="fixtures/.env", folder="fixtures")

    # Check the contents of the rendered file to see that:
    # 1. the file was actually rendered (checking for presence of file),
    # 2. the file was rendered properly (checking for contents of file).

    with open(FILE_TO_CHECK, "r") as fixture_file:
        result = fixture_file.read()
        expected_result = inspect.cleandoc(EXPECTED_VALUE)

        assert result == expected_result
