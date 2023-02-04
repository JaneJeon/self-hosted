from src.templating.get_rendered_name import get_rendered_name


def test_get_rendered_name():
    """
    Test that the .j2 file extension is stripped away
    """
    expected_result = "fixtures/templates/foo.yml"
    result = get_rendered_name("fixtures/templates/foo.yml.j2")

    assert result == expected_result
