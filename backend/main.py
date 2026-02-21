from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os

from .models import ScanRequest, RenameRequest, MediaItem
from .scanner import get_media_files
from .parser import parse_filename
from .analyzer import enrich_media_item
from typing import List
from pathlib import Path
import uuid

app = FastAPI(title="Plex File Manager API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/scan", response_model=List[MediaItem])
async def scan_directory(request: ScanRequest):
    results = []
    try:
        # Fast iteration over local files
        for file_path in get_media_files(request.directory):
            filename = os.path.basename(file_path)
            parsed = parse_filename(filename)
            
            item = MediaItem(
                id=str(uuid.uuid4()),
                original_path=str(file_path),
                original_name=filename,
                media_type=parsed.get("media_type", "unknown"),
                clean_title=parsed.get("clean_title", ""),
                year=parsed.get("year"),
                season=parsed.get("season"),
                episode=parsed.get("episode"),
                episode_title=parsed.get("episode_title")
            )
            results.append(item)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/analyze", response_model=MediaItem)
async def analyze_item(item: MediaItem, bypass_cache: bool = False, lang_prefs: str = "it,en"):
    # Re-analyze a single item against APIs
    prefs = [lang.strip() for lang in lang_prefs.split(",")]
    return await enrich_media_item(item, prefs, bypass_cache)

@app.post("/api/rename", response_model=List[MediaItem])
async def rename_items(request: RenameRequest):
    results = []
    
    for item in request.items:
        if not item.proposed_name:
            item.status = "error"
            item.message = "No proposed name to rename to"
            results.append(item)
            continue
            
        old_path = Path(item.original_path)
        new_path = old_path.parent / item.proposed_name
        
        if not old_path.exists():
            item.status = "error"
            item.message = "Original file no longer exists"
            results.append(item)
            continue
            
        if new_path.exists() and old_path != new_path:
            item.status = "error"
            item.message = "Target file already exists (conflict)"
            results.append(item)
            continue
            
        try:
            old_path.rename(new_path)
            item.status = "success"
            item.message = "Renamed successfully"
            item.original_path = str(new_path)
            item.original_name = item.proposed_name
        except Exception as e:
            item.status = "error"
            item.message = f"Rename failed: {str(e)}"
            
        results.append(item)
        
    return results

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}

# Mount frontend in production
frontend_dir = os.getenv("FRONTEND_DIR", "frontend/dist")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=True)
