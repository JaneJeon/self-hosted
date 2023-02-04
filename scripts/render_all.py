import logging
import os

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
    # Wrap render_all such that we can conditionally mock .env files and HTTP requests.
    if os.environ.get("MOCK") == "1":
        # We want to NOT load responses in "production" if possible,
        # as it is a devDependency.
        import responses

        from fixtures.mocks.cloudflare_ips import mock_cloudflare_ips

        mock_cloudflare_ips()

        # Since decorators are just function wrappers, we can conditionally decorate the function,
        # and call it directly.
        wrapped_func = responses.activate(render_all)
        wrapped_func(env_file="fixtures/.env", folder="fixtures")
    else:
        render_all()
