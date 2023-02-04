from src.templating.get_env_context import get_env_context


def test_get_env_context():
    """
    Test that the correct environment variables are loaded from the .env we specify.
    """
    result = get_env_context("fixtures/.env")

    assert result["FOO"] == "BAR"
