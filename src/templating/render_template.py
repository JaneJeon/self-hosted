from typing import Any, Dict

from jinja2 import Template

from src.log_invocation import log_invocation


@log_invocation
def render_template(template_str: str, context: Dict[str, Any]) -> str:
    """
    Renders a template with the given context and returns the raw string value of the generated file.
    """
    template = Template(template_str, trim_blocks=True, lstrip_blocks=True)

    return template.render(context)
