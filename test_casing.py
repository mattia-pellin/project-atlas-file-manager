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

def sanitize_name(name: str) -> str:
    if not name:
        return ""
    # ':' '\' '/' -> ' '
    name = re.sub(r'[:\\/]', ' ', name)
    # Remove * ? " < > |
    name = re.sub(r'[*?"<>|]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name

def format_smart_title(text: str) -> str:
    if not text:
        return ""
    
    text = text.title()
    
    def replacer(match):
        word = match.group(0)
        word_lower = word.lower()
        start = match.start()
        
        prefix = text[:start].rstrip()
        is_first = start == 0 or not prefix
        is_after_sep = prefix and prefix[-1] in [':', '-']
        
        if is_first or is_after_sep:
            return word
            
        if word_lower in LOWERCASE_WORDS or word_lower == 'l':
            return word_lower
            
        return word

    return re.sub(r'[A-Za-z\u00C0-\u00FF]+', replacer, text)

print(format_smart_title("all'ombra dell'olmo"))
print(format_smart_title("l'ombra dell'olmo"))
print(format_smart_title("il film - l'ombra"))
print(format_smart_title("All'ombra dell'olmo"))

print("---")
print(sanitize_name("Star Wars: A New Hope?"))
print(sanitize_name("File\\Name/Here: test"))
print(sanitize_name("What <is> |this| \"stuff\" *"))
