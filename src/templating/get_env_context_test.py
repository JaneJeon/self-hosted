from pyfakefs.fake_filesystem import FakeFilesystem

from src.templating.get_env_context import get_env_context


def test_get_env_context(fs: FakeFilesystem):
    """
    Test that the correct environment variables are loaded from the .env we specify.
    """
    # Create a fake .env so that when the dotenv is called, it reads from that instead.
    # For one, we don't want to read the production .env file, but that's possible by
    # passing in fixtures/.env as the argument into get_env_context().
    # The real reason is that I want to avoid *actually* hitting the filesystem
    # and otherwise making real I/O in a unit test.
    fs.create_file(".env", contents="FOO=BAR")

    result = get_env_context()

    # We know that the dotenv module loaded the .env file correctly,
    # because I locally don't have FOO=BAR set, and so it's reading the value of that
    # "fake" .env file (which is the only place where I have FOO=BAR set) and parsing it.
    assert result["FOO"] == "BAR"
