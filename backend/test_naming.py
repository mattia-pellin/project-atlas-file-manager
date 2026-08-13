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
        # English minor words stay lowercase mid-sentence — except "the", which is
        # capitalised wherever it sits. See `test_the_is_always_capitalised`.
        ("the empire strikes back", "The Empire Strikes Back"),
        ("the lord of the rings", "The Lord of The Rings"),
        # ...and the first word is capitalised even when it is a minor one
        ("of mice and men", "Of Mice and Men"),
        # English contractions: str.title() would give "Bug'S", "I'M", "We'Re"
        ("a bug's life", "A Bug's Life"),
        ("i'm luffy", "I'm Luffy"),
        ("we're the millers", "We're The Millers"),
        ("don't look up", "Don't Look Up"),
        # A word right after ':' or '-' is treated as a new sentence
        ("star wars: the last jedi", "Star Wars: The Last Jedi"),
        ("mission - the beginning", "Mission - The Beginning"),
        # Acronyms and numerals the source wrote in capitals survive, wherever they sit
        ("Stargate SG-1", "Stargate SG-1"),
        ("The Office (US)", "The Office (US)"),
        ("Rocky II", "Rocky II"),
        ("NCIS: Los Angeles", "NCIS: Los Angeles"),
        # An acronym written with full stops is one word per letter as far as the
        # regex is concerned, and "I" and "E" are minor words. See the regression below.
        ("Marvel's Agents of S.H.I.E.L.D.", "Marvel's Agents of S.H.I.E.L.D."),
        ("marvel's agents of s.h.i.e.l.d.", "Marvel's Agents of S.H.I.E.L.D."),
        ("u.s.a. high", "U.S.A. High"),
        # A single letter and a full stop is an initial, not an initialism: the letter
        # is title-cased like any other word and the words around it keep their rules.
        ("monkey d. luffy", "Monkey D. Luffy"),
        # ...but a title that is *all* capitals is shouting, not an acronym, and is
        # still title-cased. Without this, "THE MATRIX" would rename to itself.
        ("THE MATRIX", "The Matrix"),
        # A single capital is not an acronym either: "I" has to stay eligible for the
        # contraction rule above, and "Rocky V" title-cases to itself anyway.
        ("rocky V", "Rocky V"),
        # Empty input
        ("", ""),
    ],
)
def test_format_smart_title(raw: str, expected: str) -> None:
    assert format_smart_title(raw) == expected


# --- Regressions --------------------------------------------------------------
# Each of these was a tracked defect. They are kept as named tests, separate from
# the table above, so a failure names the bug rather than a table row.


def test_the_is_always_capitalised() -> None:
    """ "The" is capitalised wherever it sits, which is a convention choice, not style.

    It used to be in LOWERCASE_WORDS, so it was lowercase everywhere except first —
    ordinary English style. The library this writes to spells it "The" throughout, and
    one rule that holds in every position beats a rule that depends on where the word
    lands, so it was taken back out. Asked for on 2026-08-13.
    """
    assert format_smart_title("the lord of the rings") == "The Lord of The Rings"
    assert format_smart_title("night of the living dead") == "Night of The Living Dead"
    # Only the whole word. "Theodore" and "Thelma" are not articles.
    assert format_smart_title("il caso theodore") == "Il Caso Theodore"


def test_saxon_genitive_stays_lowercase() -> None:
    """str.title() uppercases the letter after an apostrophe: "A Bug'S Life"."""
    assert format_smart_title("a bug's life") == "A Bug's Life"


def test_acronyms_are_not_title_cased() -> None:
    """`str.title()` turned "Stargate SG-1" into "Stargate Sg-1".

    Found by the `Stargate SG-1/Season 1/` fixture, against the live API: the file was
    renamed into a folder Plex does not have. TVDB and TMDB both return the acronym
    correctly capitalised, so the defect was entirely ours.
    """
    assert format_smart_title("Stargate SG-1") == "Stargate SG-1"
    assert format_smart_title("The Office (US)") == "The Office (US)"


def test_a_dotted_acronym_keeps_every_letter() -> None:
    """`Agents of S_H_I_E_L_D_.mkv` came out as "Marvel's Agents of S.H.i.e.L.D.".

    The acronym rule above cannot reach these: it needs `len(source) > 1`, and each
    letter of a dotted initialism is its own word. So "I" and "E" — both in
    LOWERCASE_WORDS — were demoted mid-title, into a folder Plex does not have.

    Reported from real use, 2026-08-13.
    """
    assert format_smart_title("Marvel's Agents of S.H.I.E.L.D.") == "Marvel's Agents of S.H.I.E.L.D."
    # The rule is about the shape, not about this one title.
    assert format_smart_title("agents of s.h.i.e.l.d.") == "Agents of S.H.I.E.L.D."
    assert format_smart_title("W.I.T.C.H.") == "W.I.T.C.H."
    # One initial is not an initialism, and the words around it keep their own rules.
    assert format_smart_title("monkey d. luffy e il re dei pirati") == "Monkey D. Luffy e il Re dei Pirati"


def test_sanitize_name_never_produces_path_separators() -> None:
    """A proposed name must never be able to escape its parent directory."""
    assert "/" not in sanitize_name("../../etc/passwd")
    assert "\\" not in sanitize_name("..\\..\\windows\\system32")
