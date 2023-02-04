import inspect

from src.templating.render_template import render_template


def test_render_template():
    """
    Test that a Jinja2 template is rendered correctly with the given context.
    """
    template_str = """
    var 1's value is {{ var1 }},
    and var 2's value is {{ var2 }}.
    """
    context = {
        "var1": "val1",
        "var2": "val2",
    }
    expected_result = """
    var 1's value is val1,
    and var 2's value is val2.
    """
    result = render_template(inspect.cleandoc(template_str), context)

    assert result == inspect.cleandoc(expected_result)
