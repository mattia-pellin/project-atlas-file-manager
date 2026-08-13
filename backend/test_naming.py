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
        # ...but a capital "I" the source wrote is the English pronoun, not the Italian
        # article. See `test_a_capital_i_is_the_pronoun_not_the_article`.
        ("How I Met Your Mother", "How I Met Your Mother"),
        # The article it collides with still falls when the source wrote it lowercase,
        # and in a shouted title even a capital one falls.
        ("tutti i sogni del mondo", "Tutti i Sogni del Mondo"),
        ("TUTTI I SOGNI DEL MONDO", "Tutti i Sogni del Mondo"),
        # No other single letter is treated that way: a source that capitalises every
        # word is the common case and says nothing about "a", "e", "o" or "è".
        ("Once Upon A Time", "Once Upon a Time"),
        ("La Vita E Bella", "La Vita e Bella"),
        ("La Vita È Bella", "La Vita è Bella"),
        # A letter run glued to a digit is part of that token. See
        # `test_a_letter_run_glued_to_a_digit_is_not_a_new_word`.
        ("The 5th Wave", "The 5th Wave"),
        ("Se7en", "Se7en"),
        ("ワンピース 3D", "ワンピース 3D"),
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


def test_a_capital_i_is_the_pronoun_not_the_article() -> None:
    """ "How I Met Your Mother" was renamed "How i Met Your Mother", at `matched` 1.00.

    `LOWERCASE_WORDS` holds "i" for the Italian plural article, and the acronym rule
    cannot reach a single letter because it requires `len(source) > 1` — deliberately,
    so that the contraction rule keeps working. So every English "I" mid-title was
    demoted, silently, on a row confident enough to be auto-ticked: 208 episodes into
    a folder Plex does not have.
    """
    assert format_smart_title("How I Met Your Mother") == "How I Met Your Mother"
    assert format_smart_title("Am I OK?") == "Am I OK?"
    assert format_smart_title("The Day I Became a Woman") == "The Day I Became a Woman"
    assert format_smart_title("The Day I Became A Woman") == "The Day I Became a Woman"
    # The article it collides with, written lowercase and shouted. A wholly-capital
    # title is shouting rather than an acronym, so there the capital is not believed.
    assert format_smart_title("tutti i sogni del mondo") == "Tutti i Sogni del Mondo"
    assert format_smart_title("TUTTI I SOGNI DEL MONDO") == "Tutti i Sogni del Mondo"


def test_only_i_is_promoted_and_never_the_other_single_letters() -> None:
    """The other single letters in LOWERCASE_WORDS must keep falling.

    The first version of the rule above kept *any* single capital the source wrote,
    which is much worse than the bug it fixed: a source that capitalises every word is
    the ordinary case — it is how TMDB writes some titles and how every scene filename
    is built — so "Once Upon A Time" and "La Vita E Bella" stopped being corrected, and
    within one title the convention started depending on word length
    ("Diary Of A Wimpy Kid" -> "Diary of A Wimpy Kid").

    "i" is the only one where the capital carries information, because English "I" is
    a word. "a", "e", "o" and "è" are articles and conjunctions in both languages and
    are never capitalised as words, so a capital one is just a shouty source.
    """
    assert format_smart_title("Once Upon A Time") == "Once Upon a Time"
    assert format_smart_title("Diary Of A Wimpy Kid") == "Diary of a Wimpy Kid"
    assert format_smart_title("La Vita E Bella") == "La Vita e Bella"
    assert format_smart_title("La Vita È Bella") == "La Vita è Bella"
    assert format_smart_title("La Bella E La Bestia") == "La Bella e la Bestia"
    assert format_smart_title("Tutto O Niente") == "Tutto o Niente"


def test_the_one_title_the_capital_i_rule_gets_wrong() -> None:
    """An Italian "i" a title-casing source wrote capital is read as the pronoun.

    This is the price of the rule above and it is pinned so that the trade is visible
    rather than discovered. "Tutti I Sogni Del Mondo" is what a scene filename looks
    like; the API writes the article lowercase, which is the form that is corrected.
    Telling the two apart needs the language of the rest of the title, which is a
    guess, and a guess in this file produces a confidently wrong name.

    Same reason, from the other side: the target case is still wrong when shouted.
    """
    assert format_smart_title("Tutti I Sogni Del Mondo") == "Tutti I Sogni del Mondo"
    assert format_smart_title("HOW I MET YOUR MOTHER") == "How i Met Your Mother"


def test_a_letter_run_glued_to_a_digit_is_not_a_new_word() -> None:
    """ "The 5th Wave" came out "The 5Th Wave", and "Se7en" came out "Se7En".

    `str.title()` reads a digit as a word boundary, so the letters after it start a
    new word and get capitalised. The replacer never undid it: the fragment begins at
    an index whose predecessor is neither an apostrophe nor a sentence mark, so none
    of the existing rules looked at it.

    The source decides the case, which is what keeps "Avatar 3D" from becoming "3d".
    """
    assert format_smart_title("The 5th Wave") == "The 5th Wave"
    assert format_smart_title("Se7en") == "Se7en"
    assert format_smart_title("The 40th Anniversary") == "The 40th Anniversary"
    assert format_smart_title("Avatar 3D") == "Avatar 3D"
    assert format_smart_title("3rd Rock from the Sun") == "3rd Rock from The Sun"
    # A shouted title is being re-cased anyway, so the ordinary rules stand.
    assert format_smart_title("SE7EN") == "Se7en"
    assert format_smart_title("THE 5TH WAVE") == "The 5th Wave"


def test_a_script_without_case_is_not_a_shouted_title() -> None:
    """ "ワンピース 3D" must not become "ワンピース 3d".

    `keep_capitals` is "the source wrote a lowercase letter somewhere", which a title
    in a script that has no case never does — so CJK and hangul titles are classified
    as shouting and their one Latin token was being demoted, while the same title in
    Cyrillic kept it. Behaviour differing by script is not something a reader can
    predict, and One Piece is reachable on TVDB precisely by its Japanese name.
    """
    assert format_smart_title("ワンピース 3D") == "ワンピース 3D"
    assert format_smart_title("도깨비 4K") == "도깨비 4K"
    assert format_smart_title("Мастер 3D") == "Мастер 3D"


def test_a_ligature_does_not_corrupt_the_name() -> None:
    """ "ﬂying 3rd Rock" came out "Flying 3d Rock" — a letter short, and plausible.

    The rules index the source with offsets taken from `text.title()`, which is length-
    preserving for everything except a ligature: "ﬁ" becomes "Fi", so every offset past
    it slips and the source slice returned is a different word's letters. The lengths
    are compared up front now and plain title-casing stands when they disagree, which
    is worse casing but never a wrong string.
    """
    assert format_smart_title("ﬂying 3rd Rock") == "Flying 3Rd Rock"
    assert format_smart_title("ﬁlm 5th") == "Film 5Th"


def test_sanitize_name_never_produces_path_separators() -> None:
    """A proposed name must never be able to escape its parent directory."""
    assert "/" not in sanitize_name("../../etc/passwd")
    assert "\\" not in sanitize_name("..\\..\\windows\\system32")
