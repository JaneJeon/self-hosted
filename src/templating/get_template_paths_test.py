from src.templating.get_template_paths import get_template_paths


def test_get_template_paths():
    """
    Test that the globbing works as expected.
    """
    expected_result = [
        "fixtures/templates/foo.yml.j2",
        "fixtures/templates/nested/bar.yml.j2",
    ]
    result = get_template_paths("fixtures")

    assert result == expected_result
