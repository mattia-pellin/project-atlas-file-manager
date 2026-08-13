"""Tests for `describe_error`: a provider failure must not print the API key.

TMDB authenticates with `api_key` in the query string, and `httpx.HTTPStatusError`
stringifies to the whole request URL — so the obvious `print(f"... {error}")` wrote the
live key to the container's stdout on every failed search. A logged key is a key that
has to be rotated, so this is pinned rather than left to review.
"""

import httpx
import pytest

from backend.api_clients import describe_error

KEY = "0123456789abcdef0123456789abcdef"
URL = f"https://api.themoviedb.org/3/search/movie?query=Matrix&language=it-IT&api_key={KEY}"


def _status_error(status: int, url: str = URL) -> httpx.HTTPStatusError:
    """The error exactly as `_request` raises it — `raise_for_status`, not hand-built.

    The message that leaks is the one httpx composes here; passing our own would test
    a string this app never produces.
    """
    response = httpx.Response(status, request=httpx.Request("GET", url))
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as error:
        return error
    raise AssertionError(f"{status} did not raise")


def test_the_key_is_not_in_the_line_that_gets_logged() -> None:
    error = _status_error(401)
    # The failure mode this exists to prevent, spelled out: the plain rendering leaks.
    assert KEY in str(error)
    assert KEY not in describe_error(error)


def test_the_whole_query_string_goes_not_just_the_key() -> None:
    """Dropping the query wholesale is the point.

    Redacting `api_key` by name would put the next secret parameter one commit away
    from being logged, and TVDB already sends a PIN. Nothing in a query string is worth
    a log line here.
    """
    described = describe_error(_status_error(401))
    assert "api_key" not in described
    assert "query=Matrix" not in described


def test_what_a_reader_actually_needs_survives() -> None:
    described = describe_error(_status_error(404))
    assert "404" in described
    assert "/3/search/movie" in described


def test_a_transport_error_names_the_endpoint_without_its_query() -> None:
    request = httpx.Request("GET", URL)
    described = describe_error(httpx.ConnectTimeout("timed out", request=request))
    assert described == "ConnectTimeout on https://api.themoviedb.org/3/search/movie"


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectError("no route to host"),  # httpx, but constructed without a request
        ValueError("something else went wrong"),
    ],
)
def test_an_error_with_no_request_still_says_something(error: Exception) -> None:
    """Falling back to the message is safe: the key only ever reaches an httpx URL."""
    described = describe_error(error)
    assert type(error).__name__ in described
    assert str(error) in described
