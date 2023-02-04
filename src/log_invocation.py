import functools
import logging

logger = logging.getLogger(__name__)


def log_invocation(func):
    """
    A decorator to log when the function is called (more specifically, when it returns).
    Mainly for debugging.
    """
    function_name = func.__name__

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        logger.debug("Calling %s", function_name)
        return_value = func(*args, **kwargs)
        logger.debug("%s returned %s", function_name, return_value)

        return return_value

    return wrapper


# NOTE: can't test this
