# Plex File Manager

A modern, containerized Single Page Application built to recursively scan, identify, and intelligently mass-rename your Movies and TV Series to be 100% compliant with Plex Media Server naming conventions. It uses TheMovieDb (TMDB) for movies and TheTVDB (TVDB) for series.

## Features
- **Smart Scanning**: Uses magic bytes (`filetype`) to ignore non-media files automatically.
- **Intelligent Parsing**: Extracts title, year, season, and episode from chaotic filenames using `guessit`.
- **API integrations**: Fetches accurate metadata with exponential backoff retries and local disk caching to prevent API abuse and bans.
- **Dynamic Padding**: Automatically calculates episode padding (e.g., `E001`, `E012`) based on the total number of episodes in the series.
- **Modern UI**: Material 3 Expressive UI with a robust DataGrid to allow checking and editing proposed names before manipulating the filesystem.

## Quick Start (Docker Compose)

1. Create a `.env` file in the root directory:
```env
MEDIA_DIR=/path/to/your/real/media
PORT=8000
TMDB_API_KEY=your_tmdb_api_key
TVDB_API_KEY=your_tvdb_api_key
TVDB_PIN=your_tvdb_pin
```

2. Run the application:
```bash
docker-compose up -d --build
```

3. Access the web interface at `http://localhost:8000`.

## Configuration Options
All configuration is handled via environment variables passed to the container:
- `MEDIA_DIR` (Required): The host path to mount inside the container at `/media`.
- `TMDB_API_KEY` (Required for Movies): Your TMDB API key.
- `TVDB_API_KEY` (Required for Series): Your TVDB v4 API key.
- `TVDB_PIN` (Optional but recommended): Your TVDB User PIN for extended API access.
- `PORT` (Optional): The port to bind to. Default is `8000`.
- `CACHE_TTL_HOURS` (Optional): How long API requests should be cached locally. Default `24`.
