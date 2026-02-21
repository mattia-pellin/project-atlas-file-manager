import os
import filetype
from pathlib import Path
from typing import Generator

def get_media_files(directory: str) -> Generator[Path, None, None]:
    """
    Recursively scans a directory and yields files that are detected as
    actual media (video or audio) via MIME-type checking, bypassing
    simple extension checks for robust evaluation.
    """
    base_path = Path(directory)
    if not base_path.is_dir():
        return

    # To avoid scanning massive non-media files unnecessarily,
    # we can do a preliminary fast check on extensions, but the source
    # of truth will be filetype's magic number sniffing.
    for root, _, files in os.walk(directory):
        for file in files:
            file_path = Path(root) / file
            
            # Skip hidden files or tiny files
            if file.startswith('.') or file_path.stat().st_size < 1024:
                continue

            try:
                # filetype.guess looks at the first few bytes
                kind = filetype.guess(str(file_path))
                if kind is not None and (kind.mime.startswith('video/') or kind.mime.startswith('audio/')):
                    yield file_path
            except PermissionError as e:
                # Raise explicit error instead of bypassing silently
                raise PermissionError(f"Permission denied accessing file: {file_path}") from e
            except Exception as e:
                raise RuntimeError(f"Error scanning {file_path}: {e}") from e
