import re

def sanitize_name(name: str) -> str:
    if not name:
        return ""
    # Convert ':', '\', '/' to space
    name = re.sub(r'[:\\/]', ' ', name)
    
    # Convert '|' to ' - '
    name = re.sub(r'\|', ' - ', name)
    
    # Remove '*', '?', '"', '<', '>'
    name = re.sub(r'[*?"<>]', '', name)
    
    # Simplify multiple spaces
    name = re.sub(r'\s+', ' ', name)
    
    # Strip leading/trailing spaces and hyphens
    name = name.strip(' -')
    return name

print(f"[{sanitize_name('Title | Subtitle')}]")
print(f"[{sanitize_name('Title|Subtitle')}]")
print(f"[{sanitize_name('| Title')}]")
print(f"[{sanitize_name('Title |')}]")
print(f"[{sanitize_name('A|B|C')}]")
print(f"[{sanitize_name('Star Wars: A New Hope? | Remastered')}]")
