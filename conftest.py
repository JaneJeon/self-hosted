import os
import shutil
import tempfile
from typing import List

import pytest


def pytest_collection_modifyitems(items: List[pytest.Item]) -> None:
    """
    Automatically add pytest markers (based on test name) to differentiate between unit and integration tests.
    """
    for item in items:
        if "integration" in item.nodeid:
            item.add_marker(pytest.mark.integration)
        else:
            item.add_marker(pytest.mark.unit)


@pytest.fixture
def fixtures_directory():
    """
    Creates a local, unique copy of the fixtures/ directory for each (integration) test
    that requires this fixture.

    This allows for multiple integration tests to interact with the fixture folder concurrently
    without having to worry about race conditions - because each test will be working
    with its own *copy* of its fixture folder!
    """

    # This folder is automatically deleted when the context is over,
    # so we don't need to worry about cleaning it up:
    # https://docs.python.org/3/library/tempfile.html#tempfile.TemporaryDirectory
    with tempfile.TemporaryDirectory() as newpath:
        # Workspace root
        old_cwd = os.getcwd()

        # Copy over the fixtures folder in the exact same placement
        original_fixture_path = os.path.join(old_cwd, "fixtures")
        copy_fixture_path = os.path.join(newpath, "fixtures")
        shutil.copytree(original_fixture_path, copy_fixture_path)

        os.chdir(newpath)

        yield

        os.chdir(old_cwd)
