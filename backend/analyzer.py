import os
import re
from typing import Any

from . import matching
from .api_clients import TMDBClient, TVDBClientV4, calculate_padding, candidates_for_ui
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
}
# "the" is deliberately *not* in that set. English style would lowercase it mid-title,
# and it was in here for exactly that reason, but the library this app writes to spells
# it "The" everywhere and the user asked for one rule rather than a position-dependent
# one: "The Lord of The Rings". It is a convention choice, so it lives here rather than
# in a comment somewhere downstream — and it is pinned by
# `test_the_is_always_capitalised`.

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
# A dotted initialism \u2014 "S.H.I.E.L.D.", "U.S.A.", "J.R.R. Tolkien". `WORD_RE` sees one
# word per letter, and the acronym rule below cannot save them because a single letter
# is never `len(source) > 1`; so the letters that happen to spell a minor word were
# demoted and TVDB's "Marvel's Agents of S.H.I.E.L.D." was written to disk as
# "Marvel's Agents of S.H.i.e.L.D.". Two or more single letters each followed by a full
# stop, with nothing between them, is a shape ordinary prose does not have \u2014 "Mr. Smith"
# and "Monkey D. Luffy" are one pair each and do not match.
INITIALISM_RE = re.compile(r"(?:[A-Za-z\u00C0-\u00FF]\.){2,}")
# Both the ASCII apostrophe and the typographic one turn up in real filenames.
APOSTROPHES = "'\u2019"


def format_smart_title(text: str) -> str:
    """Title-cases `text`, keeping articles and prepositions lowercase mid-sentence.

    `str.title()` alone is wrong in three ways this corrects: it capitalises every
    minor word, it capitalises the letter after an apostrophe, and it destroys
    acronyms. The second is resolved by looking at both sides of the apostrophe
    \u2014 see `_after_apostrophe`.
    """
    if not text:
        return ""

    original = text
    # An offset into the title-cased result is used below to index the same word in
    # the source, which holds only while the two are the same length.
    text = text.title()
    # `str.title()` is length-preserving for everything that reaches a real title, but
    # not for a ligature: "ﬁ" becomes "Fi", one character becoming two. Every offset
    # after one slips by a character, so the rules below read a *different* word's
    # letters out of the source and return them verbatim — "ﬂying 3rd Rock" came out
    # "Flying 3d Rock", a letter short and looking perfectly plausible. When the lengths
    # disagree the source cannot be consulted at all, so plain title-casing stands.
    if len(original) != len(text):
        return text

    # A word the source wrote in full capitals is an acronym or a numeral, and
    # title-casing it produces a name Plex does not have: "Stargate Sg-1" instead of
    # "Stargate SG-1", "The Office (Us)" instead of "(US)", "Rocky Ii". A title that
    # is *entirely* capitals is shouting rather than an acronym, so there nothing is
    # preserved and the old behaviour stands.
    keep_capitals = any(character.islower() for character in original)
    initialisms = [match.span() for match in INITIALISM_RE.finditer(original)]

    def replacer(match):
        word = match.group(0)
        word_lower = word.lower()
        start = match.start()

        source = original[start : match.end()]
        if keep_capitals and len(source) > 1 and source.isupper():
            return source

        # A letter inside a dotted initialism is a letter of an acronym, never a word,
        # so nothing below may lowercase it: "S.H.I.E.L.D.", not "S.H.i.e.L.D.". The
        # title-cased `word` is returned rather than `source`, so an initialism the
        # source wrote in lowercase is repaired instead of preserved.
        if any(begin <= start and match.end() <= end for begin, end in initialisms):
            return word

        if start == 0:
            return word

        # A letter run glued to a digit belongs to that token, not to a new word:
        # "The 5th Wave", "Se7en", "3rd Rock", "Avatar 3D". `str.title()` capitalises
        # it because a digit reads as a word boundary, so the source is the only thing
        # that knows the intended case.
        #
        # The one source not to be believed is a shouted title, which is being re-cased
        # anyway: "SE7EN" -> "Se7en". That is narrowed to a run of *more than one*
        # capital, because `keep_capitals` reads "no lowercase letter anywhere" as
        # shouting and a title in a script without case has none — so "ワンピース 3D"
        # and "도깨비 4K" would lose their capital while "Мастер 3D" kept it, the
        # behaviour differing by script for no reason a reader could guess.
        if text[start - 1].isdigit():
            if not keep_capitals and len(source) > 1 and source.isupper():
                return word_lower
            return source

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
            # A capital "I" the source wrote is the English pronoun, which is a word
            # and is capitalised wherever it sits: "How I Met Your Mother", "Am I OK?".
            # `LOWERCASE_WORDS` holds "i" for the Italian plural article, and the
            # acronym rule above cannot reach it because a single letter is never
            # `len(source) > 1`, so every English "I" mid-title was being demoted.
            #
            # Only "I", and only when the source capitalised it. The other single
            # letters in the set — "a", "e", "o" — are articles and conjunctions in
            # both languages and are never words that demand a capital, so a capital
            # one is just a source that capitalises everything: "Once Upon A Time" and
            # "La Vita E Bella" have to keep falling to "a" and "e". And the gate on
            # `keep_capitals` demotes even the "I" in a shouted title, which is being
            # re-cased anyway: "TUTTI I SOGNI DEL MONDO" -> "Tutti i Sogni del Mondo".
            if keep_capitals and source == "I":
                return source
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


def locate_absolute_episode(episodes: list[dict[str, Any]], absolute: int) -> tuple[int, int] | None:
    """Turns an absolute episode number into the `(season, episode)` TVDB files it under.

    Absolute numbering is how long-running anime are labelled on disk — `One Piece -
    1015.mkv` — and no parser can undo it: guessit reads 1015 as S10E15, which is a real
    episode of a real series, so the match comes back confident and wrong. The series'
    own episode list is the only thing that carries both numberings, which is why this
    cannot be resolved before a candidate has been chosen.

    Specials are skipped. Season 0 shares the absolute sequence in some records, and an
    absolute number that resolves to a special is never what the filename meant.
    """
    for episode in episodes:
        season = episode.get("seasonNumber")
        number = episode.get("number")
        if not isinstance(season, int) or season <= 0 or not isinstance(number, int):
            continue
        if episode.get("absoluteNumber") == absolute:
            return season, number
    return None


async def enrich_media_item(
    item: MediaItem,
    language_prefs: list[str],
    bypass_cache: bool = False,
    forced_key: str | None = None,
    thresholds: matching.Thresholds = matching.DEFAULT_THRESHOLDS,
    absolute_episode: int | None = None,
) -> MediaItem:
    """Fills in `proposed_name`, `status`, `confidence` and the candidate list.

    `forced_key` is a candidate the user picked in triage; it settles the match by
    hand instead of by scoring. Because the search results and the extended series
    record are both cached, replaying one choice across every episode of a series
    costs no additional API request.

    `absolute_episode` is the other half of that hand-correction: the number the file
    is actually labelled with, when the library numbers episodes absolutely. It is
    resolved against the chosen series and replaces the parsed season and episode.
    """
    # Nothing from the previous analysis of this row may survive it. The client sends
    # the whole item back, so without this a re-analysis that finds nothing — a stale
    # forced key, an edited title that no longer matches — returns the *old* name,
    # status and confidence unchanged, and the row still looks decided. That is the
    # one failure mode this app must not have: a name nobody chose, presented as
    # current, ticked for rename.
    item.candidates = []
    item.proposed_name = None
    item.confidence = None
    item.message = None
    item.status = "pending"

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
    # so the final "no name" path can say something better than "Nessuna corrispondenza trovata".
    match_reason: str | None = None

    if item.media_type == "movie" and tmdb_key:
        client = TMDBClient(tmdb_key)
        decision = await client.search_movie(
            item.clean_title,
            item.year,
            language_prefs,
            bypass_cache,
            forced_key=forced_key,
            thresholds=thresholds,
        )
        movie_data = decision.payload
        item.tmdb_id = movie_data.get("id") if movie_data else None
        item.candidates = candidates_for_ui(decision.ranked, "tmdb", selected_key=item.tmdb_id)
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
            item.confidence = round(decision.confidence, 3)
            item.status = decision.verdict
            item.message = decision.reason or None

            if parsed_year and item.year and parsed_year != item.year:
                note = f"Il nome del file dice {parsed_year}, TMDB dice {item.year}"
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
            item.message = "Numero di episodio non riconosciuto"
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
            forced_key=forced_key,
            thresholds=thresholds,
        )
        series_data = decision.payload
        # The extended record carries its own id, which is the only way to know which
        # of the ranked candidates the name below is about to be built from. TVDB
        # hands ids over as strings, so the model's int field gets the converted one
        # while the candidate list is matched on the raw value.
        selected_key = series_data.get("tvdb_id") if series_data else None
        item.tvdb_id = int(selected_key) if str(selected_key or "").isdigit() else None
        item.candidates = candidates_for_ui(decision.ranked, "tvdb", selected_key=selected_key)
        if series_data:
            # An absolute number is resolved here and nowhere earlier: only the chosen
            # series knows where episode 1015 falls, and the season it falls in is also
            # the one the padding is sized from. It replaces whatever the filename was
            # read as, range included — an absolute number names exactly one episode.
            if absolute_episode is not None:
                located = locate_absolute_episode(series_data.get("episodes_raw", []), absolute_episode)
                if located is None:
                    # Refused, not approximated. Renaming to a neighbouring episode is
                    # the one outcome worse than not renaming at all.
                    item.status = "error"
                    item.message = (
                        f"L'episodio assoluto {absolute_episode} non esiste in {series_data.get('name', '')}".strip()
                    )
                    return item
                season_number, start_ep = located
                end_ep = start_ep
                # Written back, so the grid's S and E columns show the numbers the name
                # was built from rather than the ones the filename was misread as.
                item.season = season_number
                item.episode = start_ep

            series_name = sanitize_name(format_smart_title(series_data.get("name", "")))

            # Padding comes from this season's episode count, not the series total.
            pad = calculate_padding(series_data.get("season_episode_counts", {}).get(season_number, 0))
            s_str = f"{season_number:02d}"

            # Every localised title of this series, in one request. It used to be one
            # request per episode, which is the only cost in the pipeline that scaled
            # with the size of the batch: a season pack made twenty-four of them.
            # Fetched for the chosen series only — the candidates the scoring rejected
            # never get here — and after the absolute-number check, which can still
            # refuse the row and would have wasted the call.
            episode_names = (
                await client.get_episode_names(selected_key, language_prefs, bypass_cache) if selected_key else {}
            )

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
                    # Absent when no language in the chain has a title for this episode,
                    # in which case the default name off `episodes_raw` stands.
                    ep_title = episode_names.get(ep_id) or ep_title
                # Only for a single episode: the filename carries one title, so it
                # cannot stand in for any particular member of a range.
                if not ep_title and start_ep == end_ep and item.episode_title:
                    ep_title = item.episode_title
                # One capitalisation rule, whichever of the three sources won. A default
                # name off `episodes_raw` used to skip it, so a series with an Italian
                # title got one convention and the same series without got another.
                ep_title = sanitize_name(format_smart_title(ep_title))
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
        # "the API key is missing" both used to read as "Nessuna corrispondenza trovata".
        item.message = match_reason or "Nessuna corrispondenza trovata"
    elif item.proposed_name == item.original_name:
        # The file is already named exactly the way this app would name it, which is a
        # rename that has already happened rather than one that is waiting. Saying
        # "matched" left it sitting in the same state as the forty rows that do need
        # writing — and it cannot be ticked anyway, since `resolve_rename_target` and
        # the frontend's `isRowValid` both refuse a no-op. The confidence stays: how
        # sure the match was is still worth reading.
        item.status = "success"
        item.message = "Già nominato così — niente da rinominare"

    return item
