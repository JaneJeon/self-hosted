import logging
import sys

from src.get_cloudflare_ips import get_cloudflare_ips
from src.set_logging_defaults import set_logging_defaults
from src.templating.get_env_context import get_env_context
from src.templating.get_rendered_name import get_rendered_name
from src.templating.get_template_paths import get_template_paths
from src.templating.render_template import render_template

set_logging_defaults()

logger = logging.getLogger(__name__)


def render_all(env_file: str = ".env", folder="services"):
    """
    Function to actually render all templates within a folder (by default, only transforms services/).
    """
    logger.info("Generating context...")
    context = {"env": get_env_context(env_file), "cloudflare_ips": get_cloudflare_ips()}

    logger.info("Searching directory %s for templates...", folder)
    template_paths = get_template_paths(folder)

    for template_path in template_paths:
        with open(template_path, "r") as template_file:
            logger.info("Reading template %s", template_path)
            template_str = template_file.read()

        logger.info("Rendering template %s", template_path)
        rendered_str = render_template(template_str, context)
        rendered_path = get_rendered_name(template_path)

        with open(rendered_path, "w") as rendered_file:
            logger.info("Writing rendered file %s", rendered_path)
            rendered_file.write(rendered_str)

    if not template_paths:
        logger.info("No templates found.")


if __name__ == "__main__":
    # When calling it from CLI, just execute "as-is".
    folder = sys.argv[1] if len(sys.argv) > 1 else "services"

    render_all(folder=folder)
