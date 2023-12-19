import requests
from fake_useragent import UserAgent

ua = UserAgent()


def _raise_on_status(r: requests.Response, *args, **kwargs) -> None:
    """
    A middleware to throw on HTTP status errors.
    """
    r.raise_for_status()


def get_session() -> requests.Session:
    """
    Returns a requests.Session object with the following defaults:
    - throwing on HTTP status 4xx and 5xx
    """
    session = requests.Session()

    # Note: no need to log requests, as urllib3 already does it if we set the logging level to DEBUG
    session.hooks = {"response": [_raise_on_status]}
    session.timeout = 10
    session.headers = {"User-Agent": ua.chrome}

    return session
