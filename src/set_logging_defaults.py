"""
Module that, when imported, sets some logging defaults:
- logging level of default INFO, but can be overridden by the LOG_LEVEL environment variable
- logging format that makes it easier to separate the log caller from the log message
"""

import logging
import os


def set_logging_defaults() -> None:
    log_level = os.environ.get("LOG_LEVEL", "INFO")

    # https://docs.python.org/3/library/logging.html#logrecord-attributes
    logging_format = "[%(levelname)s] %(name)s: %(message)s"

    logging.basicConfig(level=log_level, format=logging_format)
