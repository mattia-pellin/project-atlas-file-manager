import re

LOWERCASE_WORDS = {
    "il", "lo", "la", "i", "gli", "le", "un", "uno", "una",
    "di", "a", "da", "in", "con", "su", "per", "tra", "fra",
    "del", "dello", "della", "dei", "degli", "delle", "dell",
    "al", "allo", "alla", "ai", "agli", "alle", "all",
    "dal", "dallo", "dalla", "dai", "dagli", "dalle", "dall",
    "nel", "nello", "nella", "nei", "negli", "nelle", "nell",
    "sul", "sullo", "sulla", "sui", "sugli", "sulle", "sull",
    "e", "ed", "o", "od", "ma", "che", "se",
    "a", "an", "the", "and", "but", "for", "or", "nor", 
    "at", "by", "in", "of", "on", "to", "with", "from", "into"
}

def format_smart_title(text: str) -> str:
    if not text:
        return ""
    
    text = text.title()
    
    def replacer(match):
        word = match.group(0)
        word_lower = word.lower()
        start = match.start()
        
        if start == 0:
            return word
            
        prefix = text[:start].rstrip()
        if prefix and prefix[-1] in [':', '-']:
            return word
            
        if word_lower in LOWERCASE_WORDS:
            return word_lower
            
        return word

    return re.sub(r'[A-Za-z\u00C0-\u00FF]+', replacer, text)

test_cases = [
    ("IL TRIONFO DELL'AMORE", "Il Trionfo dell'Amore"),
    ("L'ALBERO DELLA VITA", "L'Albero della Vita"),
    ("Il signore degli anelli - la compagnia dell'anello", "Il Signore degli Anelli - La Compagnia dell'Anello"),
    ("il viaggio di un'amica", "Il Viaggio di un'Amica"),
    ("Ritorno all'isola", "Ritorno all'Isola"),
    ("all'inizio del film", "All'Inizio del Film")
]

for t, expected in test_cases:
    res = format_smart_title(t)
    print(f"[{t}] -> [{res}] (Success: {res == expected})")
