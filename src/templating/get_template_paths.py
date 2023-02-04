import logging
from glob import glob
from os import path
from typing import List

from src.log_invocation import log_invocation

logger = logging.getLogger(__name__)


@log_invocation
def get_template_paths(folder_to_check: str = ".") -> List[str]:
    """
    Given a folder, searches for .j2 template files and returns them as a list of absolute paths.
    """
    pattern = path.join(folder_to_check, "**/*.j2")

    logger.info("Searching templates that match %s", pattern)

    return sorted(glob(pattern, recursive=True))
