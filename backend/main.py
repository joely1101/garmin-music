import os
import sys
import uuid
import hashlib
import sqlite3
import shutil
import re
import asyncio
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, UploadFile, File, Form, Query, HTTPException, Request, BackgroundTasks, Header, Depends
from fastapi.responses import JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import mutagen
from mutagen.easyid3 import EasyID3
from mutagen.mp3 import MP3
import yt_dlp
import feedparser

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

MUSIC_DIR = Path(os.getenv("MUSIC_DIR", BASE_DIR / "music"))
MUSIC_DIR.mkdir(parents=True, exist_ok=True)

FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"
DB_PATH = DATA_DIR / "music.db"

# ----------------- Database Setup -----------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Ensure default user admin / admin
        cur = conn.execute("SELECT username FROM users WHERE username = 'admin'")
        if not cur.fetchone():
            conn.execute("INSERT INTO users (username, password) VALUES ('admin', 'admin')")

        conn.execute("""
            CREATE TABLE IF NOT EXISTS tracks (
                id TEXT PRIMARY KEY,
                title TEXT,
                artist TEXT,
                album TEXT,
                duration INTEGER DEFAULT 0,
                bitrate INTEGER DEFAULT 320,
                size INTEGER DEFAULT 0,
                rel_path TEXT UNIQUE,
                folder TEXT DEFAULT '',
                sync_enabled INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()

init_db()

# ----------------- Authentication Helpers -----------------
def verify_subsonic_auth(
    u: Optional[str] = Query(None),
    p: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    s: Optional[str] = Query(None),
    enc: Optional[str] = Query(None),
    allow_web: bool = False,
):
    """
    Subsonic API Auth logic:
    Token mode: t == md5(password + salt)
    Password mode: p == password or hex(password)
    """
    if allow_web and not u and not t and not p:
        return "guest"

    if not u:
        raise HTTPException(status_code=401, detail="Subsonic: Missing username")
    with get_db() as conn:
        user = conn.execute("SELECT username, password FROM users WHERE username = ?", (u,)).fetchone()
        if not user:
            raise HTTPException(status_code=401, detail="Subsonic: Bad credentials")
        pwd = user["password"]
        
        # 1. Token Auth
        if t and s:
            expected_hash = hashlib.md5((pwd + s).encode("utf-8")).hexdigest()
            if t.lower() != expected_hash.lower():
                raise HTTPException(status_code=401, detail="Subsonic: Invalid token")
            return user["username"]
            
        # 2. Legacy / Plain / Hex Auth
        if p:
            if enc == "hex":
                try:
                    decoded_p = bytes.fromhex(p).decode("utf-8")
                    if decoded_p == pwd:
                        return user["username"]
                except Exception:
                    pass
            elif p == pwd or p.startswith("enc:"):
                return user["username"]

        # If none matched
        raise HTTPException(status_code=401, detail="Subsonic: Auth failed")

# ----------------- Audio Helpers -----------------
def get_audio_metadata(file_path: Path):
    duration = 0
    bitrate = 320
    title = file_path.stem
    artist = "Unknown Artist"
    album = "Unknown Album"
    try:
        audio = MP3(file_path, ID3=EasyID3)
        duration = int(audio.info.length)
        bitrate = int(audio.info.bitrate / 1000) if audio.info.bitrate else 320
        if "title" in audio and audio["title"]:
            title = str(audio["title"][0])
        if "artist" in audio and audio["artist"]:
            artist = str(audio["artist"][0])
        if "album" in audio and audio["album"]:
            album = str(audio["album"][0])
    except Exception:
        pass
    return {
        "title": title,
        "artist": artist,
        "album": album,
        "duration": duration,
        "bitrate": bitrate,
        "size": file_path.stat().st_size
    }

def scan_and_sync_files():
    """Scan all mp3s in MUSIC_DIR subfolders into DB."""
    with get_db() as conn:
        existing_paths = {row["rel_path"]: row["id"] for row in conn.execute("SELECT id, rel_path FROM tracks")}
        found_paths = set()

        for file in MUSIC_DIR.rglob("*.mp3"):
            rel = file.relative_to(MUSIC_DIR).as_posix()
            found_paths.add(rel)
            folder = file.parent.relative_to(MUSIC_DIR).as_posix()
            if folder == ".":
                folder = ""

            if rel not in existing_paths:
                meta = get_audio_metadata(file)
                track_id = str(uuid.uuid4())
                conn.execute("""
                    INSERT INTO tracks (id, title, artist, album, duration, bitrate, size, rel_path, folder, sync_enabled)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """, (track_id, meta["title"], meta["artist"], meta["album"], meta["duration"], meta["bitrate"], meta["size"], rel, folder))

        # Cleanup deleted files
        for rel, tid in existing_paths.items():
            if rel not in found_paths:
                conn.execute("DELETE FROM tracks WHERE id = ?", (tid,))
        conn.commit()

scan_and_sync_files()

# ----------------- FastAPI App -----------------
app = FastAPI(title="Garmin Modern Subsonic & Music Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DOWNLOAD_TASKS: Dict[str, Dict[str, Any]] = {}

# ----------------- Subsonic API for Garmin -----------------
def subsonic_response(data_key: str = None, data_val: Any = None):
    resp = {
        "status": "ok",
        "version": "1.16.1",
        "type": "garmin-subsonic",
        "serverVersion": "1.0.0"
    }
    if data_key and data_val is not None:
        resp[data_key] = data_val
    return {"subsonic-response": resp}

@app.get("/rest/ping.view")
def subsonic_ping(user: str = Depends(verify_subsonic_auth)):
    return subsonic_response()

@app.get("/rest/getPlaylists.view")
def subsonic_get_playlists(user: str = Depends(verify_subsonic_auth)):
    # 每個有打勾 sync_enabled 的資料夾，以及一個總清單 "Synced for Garmin"
    with get_db() as conn:
        playlists = []
        
        # 1. 總同步清單 (包含所有 sync_enabled = 1 的歌曲)
        cur_total = conn.execute("SELECT COUNT(*), SUM(duration) FROM tracks WHERE sync_enabled = 1")
        r_total = cur_total.fetchone()
        playlists.append({
            "id": "all_synced",
            "name": "★ 全部已選歌曲 (Garmin Sync)",
            "songCount": r_total[0] or 0,
            "duration": r_total[1] or 0,
            "created": "2026-11-16 00:00:00",
            "coverArt": "cover_all"
        })

        # 2. 每個子目錄作為一張獨立歌單 (只算 sync_enabled = 1)
        cur_folders = conn.execute("SELECT DISTINCT folder FROM tracks WHERE folder != ''")
        for f_row in cur_folders.fetchall():
            folder_name = f_row["folder"]
            c_cur = conn.execute("SELECT COUNT(*), SUM(duration) FROM tracks WHERE folder = ? AND sync_enabled = 1", (folder_name,))
            c_row = c_cur.fetchone()
            if (c_row[0] or 0) > 0:
                playlists.append({
                    "id": f"folder_{folder_name}",
                    "name": f"📁 {folder_name}",
                    "songCount": c_row[0] or 0,
                    "duration": c_row[1] or 0,
                    "created": "2026-11-16 00:00:00",
                    "coverArt": f"cover_{folder_name}"
                })
        return subsonic_response("playlists", {"playlist": playlists})

@app.get("/rest/getPlaylist.view")
def subsonic_get_playlist(id: str = Query(...), user: str = Depends(verify_subsonic_auth)):
    with get_db() as conn:
        if id == "all_synced":
            cur = conn.execute("SELECT * FROM tracks WHERE sync_enabled = 1 ORDER BY title ASC")
            name = "全部已選歌曲"
        elif id.startswith("folder_"):
            folder_name = id[len("folder_"):]
            cur = conn.execute("SELECT * FROM tracks WHERE folder = ? AND sync_enabled = 1 ORDER BY title ASC", (folder_name,))
            name = folder_name
        else:
            cur = conn.execute("SELECT * FROM tracks WHERE sync_enabled = 1 ORDER BY title ASC")
            name = "Default Playlist"

        entries = []
        for r in cur.fetchall():
            entries.append({
                "id": r["id"],
                "parent": id,
                "title": r["title"],
                "artist": r["artist"],
                "album": r["album"],
                "duration": r["duration"],
                "size": r["size"],
                "bitRate": r["bitrate"],
                "contentType": "audio/mpeg",
                "suffix": "mp3",
                "isDir": False,
                "path": r["rel_path"]
            })
        return subsonic_response("playlist", {
            "id": id,
            "name": name,
            "songCount": len(entries),
            "entry": entries
        })

@app.get("/rest/getRandomSongs.view")
def subsonic_get_random_songs(size: int = Query(20), user: str = Depends(verify_subsonic_auth)):
    with get_db() as conn:
        cur = conn.execute("SELECT * FROM tracks WHERE sync_enabled = 1 ORDER BY RANDOM() LIMIT ?", (size,))
        entries = []
        for r in cur.fetchall():
            entries.append({
                "id": r["id"],
                "title": r["title"],
                "artist": r["artist"],
                "album": r["album"],
                "duration": r["duration"],
                "size": r["size"],
                "bitRate": r["bitrate"],
                "contentType": "audio/mpeg",
                "suffix": "mp3",
                "isDir": False
            })
        return subsonic_response("randomSongs", {"song": entries})

def verify_stream_auth(
    u: Optional[str] = Query(None),
    p: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    s: Optional[str] = Query(None),
    enc: Optional[str] = Query(None),
):
    # 若有帶帳密或 token 則驗證；若為網頁端直連試聽 (HTML5 Audio 標籤) 則允許免密串流
    if not u and not t and not p:
        return "web_player"
    return verify_subsonic_auth(u, p, t, s, enc)

@app.get("/rest/stream.view")
@app.get("/rest/download.view")
@app.get("/api/tracks/{id}/stream")
def subsonic_stream(id: str, user: str = Depends(verify_stream_auth)):
    with get_db() as conn:
        track = conn.execute("SELECT * FROM tracks WHERE id = ?", (id,)) .fetchone()
        if not track:
            raise HTTPException(status_code=404, detail="Track not found")
        file_path = MUSIC_DIR / track["rel_path"]
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found on disk")
        
        file_size = file_path.stat().st_size
        headers = {
            "Content-Length": str(file_size),
            "Accept-Ranges": "bytes",
            "Content-Type": "audio/mpeg"
        }
        return FileResponse(
            path=file_path,
            media_type="audio/mpeg",
            headers=headers,
            filename=Path(track["rel_path"]).name
        )

@app.get("/rest/scrobble.view")
def subsonic_scrobble(id: str = Query(...), user: str = Depends(verify_subsonic_auth)):
    return subsonic_response()

@app.get("/rest/star.view")
@app.get("/rest/unstar.view")
def subsonic_star_toggle(id: str = Query(...), user: str = Depends(verify_subsonic_auth)):
    return subsonic_response()

@app.get("/rest/getCoverArt.view")
def subsonic_get_cover_art():
    # Return 204 or empty image
    return Response(status_code=204)

# ----------------- Management REST API -----------------
class LoginRequest(BaseModel):
    username: str
    password: str

@app.post("/api/auth/login")
def login(req: LoginRequest):
    with get_db() as conn:
        user = conn.execute("SELECT username, password FROM users WHERE username = ?", (req.username,)).fetchone()
        if not user or user["password"] != req.password:
            raise HTTPException(status_code=401, detail="帳號或密碼錯誤")
        return {"status": "ok", "username": user["username"]}

@app.post("/api/auth/change-password")
def change_password(req: LoginRequest):
    with get_db() as conn:
        conn.execute("UPDATE users SET password = ? WHERE username = ?", (req.password, req.username))
        conn.commit()
    return {"status": "ok"}

@app.get("/api/folders")
def list_folders():
    folders = []
    for item in MUSIC_DIR.iterdir():
        if item.is_dir():
            folders.append(item.name)
    return sorted(folders)

@app.post("/api/folders")
def create_folder(folder_name: str = Query(...)):
    clean_folder = re.sub(r'[\\/*?:"<>|]', "", folder_name).strip()
    if not clean_folder:
        raise HTTPException(status_code=400, detail="Invalid folder name")
    target_dir = MUSIC_DIR / clean_folder
    target_dir.mkdir(exist_ok=True)
    return {"status": "ok", "folder": clean_folder}

@app.get("/api/tracks")
def list_tracks(folder: Optional[str] = None):
    with get_db() as conn:
        if folder:
            cur = conn.execute("SELECT * FROM tracks WHERE folder = ? ORDER BY title ASC", (folder,))
        else:
            cur = conn.execute("SELECT * FROM tracks ORDER BY folder ASC, title ASC")
        return [dict(r) for r in cur.fetchall()]

@app.post("/api/tracks/{track_id}/sync")
def toggle_sync(track_id: str, enabled: bool = Query(...)):
    with get_db() as conn:
        conn.execute("UPDATE tracks SET sync_enabled = ? WHERE id = ?", (1 if enabled else 0, track_id))
        conn.commit()
    return {"status": "ok", "id": track_id, "sync_enabled": enabled}

@app.post("/api/folders/{folder}/batch-sync")
def batch_sync_folder(folder: str, enabled: bool = Query(...)):
    with get_db() as conn:
        conn.execute("UPDATE tracks SET sync_enabled = ? WHERE folder = ?", (1 if enabled else 0, folder))
        conn.commit()
    return {"status": "ok", "folder": folder, "sync_enabled": enabled}

@app.delete("/api/tracks/{track_id}")
def delete_track(track_id: str):
    with get_db() as conn:
        cur = conn.execute("SELECT rel_path FROM tracks WHERE id = ?", (track_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Track not found")
        
        file_path = MUSIC_DIR / row["rel_path"]
        if file_path.exists():
            try:
                file_path.unlink()
            except Exception:
                pass
        
        conn.execute("DELETE FROM tracks WHERE id = ?", (track_id,))
        conn.commit()
    return {"status": "deleted", "id": track_id}

@app.post("/api/tracks/upload")
async def upload_mp3(folder: str = Form("1116"), file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only .mp3 files are allowed")
    
    clean_folder = re.sub(r'[\\/*?:"<>|]', "", folder).strip()
    if not clean_folder:
        clean_folder = "1116"
        
    target_folder = MUSIC_DIR / clean_folder
    target_folder.mkdir(exist_ok=True)
    
    clean_name = re.sub(r'[\\/*?:"<>|]', "", file.filename)
    dest_path = target_folder / clean_name
    
    if dest_path.exists():
        stem = dest_path.stem
        clean_name = f"{stem}_{int(uuid.uuid4().hex[:6], 16)}.mp3"
        dest_path = target_folder / clean_name
        
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    meta = get_audio_metadata(dest_path)
    track_id = str(uuid.uuid4())
    rel_path = dest_path.relative_to(MUSIC_DIR).as_posix()
    
    with get_db() as conn:
        conn.execute("""
            INSERT INTO tracks (id, title, artist, album, duration, bitrate, size, rel_path, folder, sync_enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        """, (track_id, meta["title"], meta["artist"], meta["album"], meta["duration"], meta["bitrate"], meta["size"], rel_path, clean_folder))
        conn.commit()
        
    return {"status": "success", "track": {"id": track_id, **meta, "rel_path": rel_path, "folder": clean_folder}}

# ----------------- Downloader (YouTube & RSS Podcast) -----------------
class DownloadRequest(BaseModel):
    url: str
    target_folder: str = "1116"
    download_playlist: bool = False

def run_download_task(task_id: str, url: str, target_folder: str = "1116", download_playlist: bool = False):
    DOWNLOAD_TASKS[task_id] = {"status": "processing", "progress": "Starting...", "title": url, "error": None}
    
    target_dir = MUSIC_DIR / target_folder
    target_dir.mkdir(exist_ok=True)
    
    try:
        is_rss = False
        try:
            feed = feedparser.parse(url)
            if feed.entries and len(feed.entries) > 0 and any("enclosures" in entry for entry in feed.entries):
                is_rss = True
        except Exception:
            is_rss = False
            
        if is_rss:
            DOWNLOAD_TASKS[task_id]["progress"] = "Parsing Podcast RSS feed..."
            latest_entry = None
            audio_url = None
            for e in feed.entries:
                for enc in getattr(e, "enclosures", []):
                    if "audio" in enc.get("type", "") or enc.get("href", "").endswith(".mp3"):
                        latest_entry = e
                        audio_url = enc.get("href")
                        break
                if audio_url:
                    break
                    
            if not audio_url:
                raise Exception("No MP3 episode found in podcast RSS")
                
            episode_title = latest_entry.get("title", "Podcast Episode")
            DOWNLOAD_TASKS[task_id]["title"] = episode_title
            DOWNLOAD_TASKS[task_id]["progress"] = f"Downloading: {episode_title}..."
            
            clean_title = re.sub(r'[\\/*?:"<>|]', "", episode_title)[:60]
            target_file = target_dir / f"{clean_title}.mp3"
            
            import urllib.request
            urllib.request.urlretrieve(audio_url, target_file)
            
            scan_and_sync_files()
            DOWNLOAD_TASKS[task_id]["status"] = "completed"
            DOWNLOAD_TASKS[task_id]["progress"] = "Completed"
            return
            
        # Clean URL if single track requested
        clean_url = url
        if not download_playlist and ("youtube.com" in url or "youtu.be" in url):
            clean_url = re.sub(r'[?&]list=[^&]+', '', url)

        DOWNLOAD_TASKS[task_id]["progress"] = "Extracting media info..."
        
        def progress_hook(d):
            if d['status'] == 'downloading':
                pct = d.get('_percent_str', '0%')
                filename = Path(d.get('filename', '')).name
                DOWNLOAD_TASKS[task_id]["progress"] = f"Downloading ({pct}): {filename[:30]}"
            elif d['status'] == 'finished':
                DOWNLOAD_TASKS[task_id]["progress"] = "Converting audio to MP3 (320k)..."

        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '320',
            }],
            'outtmpl': str(target_dir / '%(title)s.%(ext)s'),
            'progress_hooks': [progress_hook],
            'noplaylist': not download_playlist,
            'ignoreerrors': True,
            'retries': 10,
            'fragment_retries': 10,
            'file_access_retries': 5,
            'socket_timeout': 30,
            'quiet': True,
            'no_warnings': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(clean_url, download=True)
            if info:
                title = info.get('title', 'YouTube Audio')
                DOWNLOAD_TASKS[task_id]["title"] = title
            
        scan_and_sync_files()
        DOWNLOAD_TASKS[task_id]["status"] = "completed"
        DOWNLOAD_TASKS[task_id]["progress"] = "Completed"
        
    except Exception as e:
        scan_and_sync_files()
        DOWNLOAD_TASKS[task_id]["status"] = "failed"
        DOWNLOAD_TASKS[task_id]["error"] = str(e)
        DOWNLOAD_TASKS[task_id]["progress"] = f"Error: {str(e)}"

@app.post("/api/download")
def start_download(req: DownloadRequest, background_tasks: BackgroundTasks):
    task_id = str(uuid.uuid4())
    background_tasks.add_task(run_download_task, task_id, req.url, req.target_folder, req.download_playlist)
    return {"task_id": task_id, "status": "queued"}

@app.get("/api/download/tasks")
def get_download_tasks():
    return DOWNLOAD_TASKS

# ----------------- Serve Frontend Static Files -----------------
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
