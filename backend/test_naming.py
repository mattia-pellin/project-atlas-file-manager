"""Tests for the naming pipeline: sanitize_name and format_smart_title.

These two functions decide the final filename for every renamed file, so a
regression here silently corrupts hundreds of names in a single batch. Add a
case here for every naming bug fixed.
"""

import pytest

from backend.analyzer import format_smart_title, sanitize_name


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # Pipe becomes a separator
        ("Title | Subtitle", "Title - Subtitle"),
        ("Title|Subtitle", "Title - Subtitle"),
        ("A|B|C", "A - B - C"),
        # Leading/trailing separators are stripped
        ("| Title", "Title"),
        ("Title |", "Title"),
        # Colons and slashes become spaces, illegal chars are dropped
        ("Star Wars: A New Hope? | Remastered", "Star Wars A New Hope - Remastered"),
        ("Face/Off", "Face Off"),
        ('He said "hi"', "He said hi"),
        ("What<>*?", "What"),
        # Whitespace is collapsed
        ("Too    many     spaces", "Too many spaces"),
        # Empty input
        ("", ""),
    ],
)
def test_sanitize_name(raw: str, expected: str) -> None:
    assert sanitize_name(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # Italian articles and prepositions stay lowercase mid-sentence
        ("il trionfo dell'amore", "Il Trionfo dell'Amore"),
        ("la vita e bella", "La Vita e Bella"),
        ("l'ultimo dei mohicani", "L'Ultimo dei Mohicani"),
        # After an elided article the next word is capitalised. This is a
        # deliberate convention choice, not an accident: keep it consistent
        # with "dell'Olmo" below.
        ("all'ombra dell'olmo", "All'Ombra dell'Olmo"),
        # ...unless that word is itself a minor word: the elision does not start
        # a new sentence.
        ("non c'è due senza tre", "Non c'è Due Senza Tre"),
        # The elision itself is lowercase mid-sentence even when it is one letter,
        # which LOWERCASE_WORDS cannot express because it holds whole words.
        ("il codice d'onore", "Il Codice d'Onore"),
        # An apostrophe that is *not* an Italian elision keeps its capital. "o" is
        # in LOWERCASE_WORDS, so without the elision check this would be "o'Brien".
        ("patrick o'brien", "Patrick O'Brien"),
        # English minor words stay lowercase mid-sentence
        ("the empire strikes back", "The Empire Strikes Back"),
        ("the lord of the rings", "The Lord of the Rings"),
        # English contractions: str.title() would give "Bug'S", "I'M", "We'Re"
        ("a bug's life", "A Bug's Life"),
        ("i'm luffy", "I'm Luffy"),
        ("we're the millers", "We're the Millers"),
        ("don't look up", "Don't Look Up"),
        # First word is always capitalised
        ("of mice and men", "Of Mice and Men"),
        # A word right after ':' or '-' is treated as a new sentence
        ("star wars: the last jedi", "Star Wars: The Last Jedi"),
        ("mission - the beginning", "Mission - The Beginning"),
        # Empty input
        ("", ""),
    ],
)
def test_format_smart_title(raw: str, expected: str) -> None:
    assert format_smart_title(raw) == expected


# --- Regressions --------------------------------------------------------------
# Both of these were tracked defects. They are kept as named tests, separate from
# the table above, so a failure names the bug rather than a table row.


def test_the_stays_lowercase_mid_sentence() -> None:
    """'the' was absent from LOWERCASE_WORDS, so it was capitalised everywhere."""
    assert format_smart_title("the lord of the rings") == "The Lord of the Rings"


def test_saxon_genitive_stays_lowercase() -> None:
    """str.title() uppercases the letter after an apostrophe: "A Bug'S Life"."""
    assert format_smart_title("a bug's life") == "A Bug's Life"


def test_sanitize_name_never_produces_path_separators() -> None:
    """A proposed name must never be able to escape its parent directory."""
    assert "/" not in sanitize_name("../../etc/passwd")
    assert "\\" not in sanitize_name("..\\..\\windows\\system32")
