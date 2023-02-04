from os import path

from src.log_invocation import log_invocation


@log_invocation
def get_rendered_name(template_path: str) -> str:
    """
    Given a template path, returns what the name should be for the generated file as an absolute path.
    """
    # We're assuming that the path ends with a .j2
    return path.splitext(template_path)[0]
