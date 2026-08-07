from typing import Any

from guessit import guessit


def parse_filename(filename: str) -> dict[str, Any]:
    """
    Uses GuessIt to extract metadata from the original filename.
    Returns a dictionary containing properties like:
    type (movie/episode), title, year, season, episode, format, etc.
    """
    guess = guessit(filename)

    def format_episode(ep_data: Any) -> Any:
        """A multi-episode list becomes "start-end"; a single episode stays a plain int.

        A one-element list must not become "5-5": `isEpisodeValid` in the frontend
        requires start < end and would reject the row, making it unrenameable.
        """
        if isinstance(ep_data, list):
            if len(ep_data) == 1:
                return ep_data[0]
            if len(ep_data) > 1:
                return f"{ep_data[0]}-{ep_data[-1]}"
        return ep_data

    def full_title(parsed: Any) -> str:
        """Title plus any `alternative_title`, which is where guessit puts the tail
        of a title split by a separator it treats as structural.

        "The Matrix | Reloaded | 2003" parses as title="The Matrix",
        alternative_title="Reloaded". Searching for "The Matrix" finds the 1999 film.
        """
        title = parsed.get("title", "")
        alt = parsed.get("alternative_title")
        if not alt:
            return title
        parts = alt if isinstance(alt, list) else [alt]
        return " ".join([title, *parts]).strip()

    # Normalize the output dictionary for our models
    result = {
        "media_type": guess.get("type", "unknown"),  # Returns 'movie' or 'episode' usually
        "clean_title": full_title(guess),
        "year": guess.get("year"),
        "season": guess.get("season"),
        "episode": format_episode(guess.get("episode")),
        "episode_title": guess.get("episode_title"),
    }

    # Sometimes tv shows are parsed as unknown if there's no clear S01E01 but
    # they have 'season' or 'episode' properties
    if result["media_type"] == "unknown" and (result["season"] is not None or result["episode"] is not None):
        result["media_type"] = "episode"

    return result
