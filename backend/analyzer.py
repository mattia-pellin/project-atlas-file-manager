import os
import re
from typing import Any

from .api_clients import TMDBClient, TVDBClientV4, calculate_padding
from .models import MediaItem
from .parser import parse_filename


def sanitize_name(name: str) -> str:
    if not name:
        return ""
    # Convert ':', '\', '/' to space
    name = re.sub(r"[:\\/]", " ", name)
    # Convert '|' to ' - '
    name = re.sub(r"\|", " - ", name)
    # Remove '*', '?', '"', '<', '>'
    name = re.sub(r'[*?"<>]', "", name)
    name = re.sub(r"\s+", " ", name)
    name = name.strip(" -")
    return name


LOWERCASE_WORDS = {
    "è",
    "il",
    "lo",
    "la",
    "i",
    "gli",
    "le",
    "un",
    "uno",
    "una",
    "di",
    "a",
    "da",
    "in",
    "con",
    "su",
    "per",
    "tra",
    "fra",
    "del",
    "dello",
    "della",
    "dei",
    "degli",
    "delle",
    "dell",
    "al",
    "allo",
    "alla",
    "ai",
    "agli",
    "alle",
    "all",
    "si",
    "dal",
    "dallo",
    "dalla",
    "dai",
    "dagli",
    "dalle",
    "dall",
    "nel",
    "nello",
    "nella",
    "nei",
    "negli",
    "nelle",
    "nell",
    "sul",
    "sullo",
    "sulla",
    "sui",
    "sugli",
    "sulle",
    "sull",
    "e",
    "ed",
    "o",
    "od",
    "ma",
    "che",
    "se",
    "an",
    "and",
    "but",
    "for",
    "or",
    "nor",
    "at",
    "by",
    "of",
    "on",
    "to",
    "with",
    "from",
    "into",
    "the",
}

# Italian words that elide before a vowel. They govern both sides of their apostrophe:
# the elision itself stays lowercase mid-sentence and what follows keeps its capital —
# "All'Ombra", "dell'Amore", "il Codice d'Onore". A one-letter word followed by an
# apostrophe that is *not* in here is a name particle, not an elision: "Patrick O'Brien".
ITALIAN_ELISIONS = {
    "l",
    "un",
    "d",
    "c",
    "n",
    "s",
    "t",
    "v",
    "m",
    "all",
    "dell",
    "dall",
    "nell",
    "sull",
    "coll",
    "quell",
    "bell",
    "sant",
    "gran",
}

# English contraction suffixes. These stay lowercase after an apostrophe, which is
# what `str.title()` gets wrong: "A Bug's Life", not "A Bug'S Life".
CONTRACTION_SUFFIXES = {"s", "t", "ll", "re", "ve", "m", "d"}


WORD_RE = re.compile(r"[A-Za-z\u00C0-\u00FF]+")
TRAILING_WORD_RE = re.compile(r"[A-Za-z\u00C0-\u00FF]+$")
# Both the ASCII apostrophe and the typographic one turn up in real filenames.
APOSTROPHES = "'\u2019"


def format_smart_title(text: str) -> str:
    """Title-cases `text`, keeping articles and prepositions lowercase mid-sentence.

    `str.title()` alone is wrong in two ways this corrects: it capitalises every
    minor word, and it capitalises the letter after an apostrophe. The second is
    resolved by looking at both sides of the apostrophe \u2014 see `_after_apostrophe`.
    """
    if not text:
        return ""

    text = text.title()

    def replacer(match):
        word = match.group(0)
        word_lower = word.lower()
        start = match.start()

        if start == 0:
            return word

        if text[start - 1] in APOSTROPHES:
            return _after_apostrophe(text, start, word)

        prefix = text[:start].rstrip()
        if prefix and prefix[-1] in [":", "-"]:
            return word

        # A word sitting directly before an apostrophe is an elision or a name
        # particle, not an ordinary minor word, so LOWERCASE_WORDS does not decide it.
        if match.end() < len(text) and text[match.end()] in APOSTROPHES:
            return word_lower if word_lower in ITALIAN_ELISIONS else word

        if word_lower in LOWERCASE_WORDS:
            return word_lower

        return word

    return WORD_RE.sub(replacer, text)


def _after_apostrophe(text: str, start: int, word: str) -> str:
    """Decides the case of a word that directly follows an apostrophe.

    Three-way, because the apostrophe means different things in the two languages
    this library holds, and the same suffix can be either:

    - Italian elision  -> the noun keeps its capital: "dell'Amore", "d'Onore"
    - English contraction -> the suffix is lowercase:  "A Bug's Life", "I'm Luffy"
    - Neither (an Irish surname, say) -> leave `str.title()` alone: "O'Brien"

    Italian is checked first so "d'Onore" wins over reading `d` as "I'd".
    """
    preceding = TRAILING_WORD_RE.search(text[: start - 1])
    previous_word = preceding.group(0).lower() if preceding else ""

    if previous_word in ITALIAN_ELISIONS:
        # The elided article does not make the next word a sentence start, so a minor
        # word after it stays minor: "non c'è", not "non c'È".
        return word.lower() if word.lower() in LOWERCASE_WORDS else word
    if word.lower() in CONTRACTION_SUFFIXES:
        return word.lower()
    return word


def parse_episode_range(episode: Any) -> tuple[int, int] | None:
    """Normalises a `MediaItem.episode` value to an inclusive `(start, end)` pair.

    Accepts an int, a bare numeric string, or the "10-12" range `parse_filename`
    produces. A single episode comes back as `(n, n)`.

    Returns None when the value is missing, non-numeric, or descending. The caller
    must then decline to propose a name — the previous behaviour of falling back to
    episode 1 produced a plausible filename for the wrong episode.
    """
    if episode is None:
        return None

    raw = str(episode).strip()
    if not raw:
        return None

    try:
        numbers = [int(part) for part in raw.split("-")]
    except ValueError:
        return None

    if len(numbers) == 1:
        return numbers[0], numbers[0]
    if len(numbers) == 2 and numbers[0] <= numbers[1]:
        return numbers[0], numbers[1]
    return None


async def enrich_media_item(item: MediaItem, language_prefs: list[str], bypass_cache: bool = False) -> MediaItem:
    # If standard scan, we parse the filename here. If re-analyzing, we use user overrides.
    if not item.media_type or item.media_type == "unknown":
        parsed = parse_filename(item.original_name)
        item.media_type = parsed.get("media_type")
        item.clean_title = parsed.get("clean_title")
        item.year = parsed.get("year")
        item.season = parsed.get("season")
        item.episode = parsed.get("episode")
        item.episode_title = parsed.get("episode_title")

    # Initialize clients lazily or globally (using env vars)
    tmdb_key = os.getenv("TMDB_API_KEY")
    tvdb_key = os.getenv("TVDB_API_KEY")
    tvdb_pin = os.getenv("TVDB_PIN")

    ext = os.path.splitext(item.original_name)[1]

    # Why the API declined to produce a name, when it did. Kept out of the branches
    # so the final "no name" path can say something better than "Could not find a match".
    match_reason: str | None = None

    if item.media_type == "movie" and tmdb_key:
        client = TMDBClient(tmdb_key)
        decision = await client.search_movie(item.clean_title, item.year, language_prefs, bypass_cache)
        movie_data = decision.payload
        if movie_data:
            title = movie_data.get("title") or movie_data.get("original_title")
            # Format: Title Case, replace slashes with dashes, remove illegal chars
            title = sanitize_name(format_smart_title(title))

            # Map API year to item. Safe to overwrite only because the parsed year has
            # already been scored against this candidate: a disagreement has cost the
            # match confidence by now, instead of being laundered into a tidy name.
            parsed_year = item.year
            api_year = movie_data.get("release_date", "")[:4]
            if api_year and api_year.isdigit():
                item.year = int(api_year)

            item.proposed_name = f"{title}"
            if item.year:
                item.proposed_name += f" ({item.year})"
            item.proposed_name += ext
            item.tmdb_id = movie_data.get("id")
            item.confidence = round(decision.confidence, 3)
            item.status = decision.verdict
            item.message = decision.reason or None

            if parsed_year and item.year and parsed_year != item.year:
                note = f"Filename says {parsed_year}, TMDB says {item.year}"
                item.message = f"{item.message} — {note}" if item.message else note
        else:
            match_reason = decision.reason

    elif item.media_type == "episode" and tvdb_key:
        # Resolved before the search, both because a bad episode number is a better
        # error than a failed match and because the number is the evidence that tells
        # two same-named series apart.
        ep_range = parse_episode_range(item.episode)
        if ep_range is None:
            # Refuse rather than default to episode 1. A name built on an invented
            # number looks correct and files the episode in the wrong place.
            item.status = "error"
            item.message = "Could not determine the episode number"
            return item
        start_ep, end_ep = ep_range

        # When the season is unknown we assume S01, so we size and search against S01 too.
        season_number = item.season if item.season is not None else 1

        client = TVDBClientV4(tvdb_key, tvdb_pin)
        decision = await client.search_series(
            item.clean_title,
            language_prefs,
            year=item.year,
            season=season_number,
            episode=ep_range,
            bypass_cache=bypass_cache,
        )
        series_data = decision.payload
        if series_data:
            series_name = sanitize_name(format_smart_title(series_data.get("name", "")))

            # Padding comes from this season's episode count, not the series total.
            pad = calculate_padding(series_data.get("season_episode_counts", {}).get(season_number, 0))
            s_str = f"{season_number:02d}"

            ep_titles = []
            for num in range(start_ep, end_ep + 1):
                ep_id = None
                ep_title = ""
                for ep in series_data.get("episodes_raw", []):
                    if ep.get("seasonNumber") == season_number and ep.get("number") == num:
                        ep_id = ep.get("id")
                        ep_title = ep.get("name", "")
                        break
                if ep_id:
                    # Ask API to pull prioritized translation for this specific episode
                    translated_title = await client.get_episode_translation(ep_id, language_prefs, bypass_cache)
                    if translated_title:
                        ep_title = format_smart_title(translated_title)
                # Only for a single episode: the filename carries one title, so it
                # cannot stand in for any particular member of a range.
                if not ep_title and start_ep == end_ep and item.episode_title:
                    ep_title = format_smart_title(item.episode_title)
                ep_title = sanitize_name(ep_title)
                if ep_title:
                    ep_titles.append(ep_title)

            # A range gets Plex's documented S01E01-E02 form: the second number carries
            # its own 'E'. The bare S01E01-02 is widely matched but is not the convention.
            e_str = f"{start_ep:0{pad}d}" if start_ep == end_ep else f"{start_ep:0{pad}d}-E{end_ep:0{pad}d}"

            proposed = f"{series_name} - S{s_str}E{e_str}"
            if ep_titles:
                proposed += " - " + " - ".join(ep_titles)
            proposed += ext
            # Map API year to item
            api_year = series_data.get("year")
            if api_year:
                try:
                    item.year = int(api_year)
                except ValueError:
                    pass

            item.proposed_name = proposed
            item.confidence = round(decision.confidence, 3)
            item.status = decision.verdict
            item.message = decision.reason or None
        else:
            match_reason = decision.reason

    if not item.proposed_name:
        item.status = "error"
        # The scoring reason when there is one: "no candidate cleared the bar" and
        # "the API key is missing" both used to read as "Could not find a match".
        item.message = match_reason or "Could not find a match"

    return item
