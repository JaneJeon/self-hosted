import logging
import os
from typing import Dict

from dotenv import load_dotenv

from src.log_invocation import log_invocation

logger = logging.getLogger(__name__)


@log_invocation
def get_env_context(dotenv_path: str = ".env") -> Dict[str, str]:
    """
    Returns all environment variables (also loaded from .env file) as a context object.
    """
    load_dotenv(dotenv_path)  # this will load .env from the workspace root
    logger.debug("Loaded environment variables from .env")

    return dict(os.environ)
