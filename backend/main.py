import os
import sys
import uuid
import hashlib
import sqlite3
import shutil
import re
import asyncio
import subprocess
import tempfile
import base64
import json
import urllib.request
import urllib.parse
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, UploadFile, File, Form, Query, HTTPException, Request, BackgroundTasks, Header, Depends
from fastapi.responses import JSONResponse, FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import mutagen
from mutagen.easyid3 import EasyID3
from mutagen.mp3 import MP3
import yt_dlp
import feedparser

if getattr(sys, 'frozen', False):
    # PyInstaller 解壓路徑
    BUNDLE_DIR = Path(sys._MEIPASS)
    BASE_DIR = Path(sys.executable).resolve().parent
    FRONTEND_DIST = BUNDLE_DIR / "frontend" / "dist"
else:
    BASE_DIR = Path(__file__).resolve().parent
    FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"

DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

MUSIC_DIR = Path(os.getenv("MUSIC_DIR", BASE_DIR / "music"))
MUSIC_DIR.mkdir(parents=True, exist_ok=True)

# 資料庫路徑相容性 (優先使用 DATA_DIR，若原本在 BASE_DIR 則向下相容)
DB_PATH = DATA_DIR / "music.db" if (DATA_DIR / "music.db").exists() else (BASE_DIR / "music.db" if (BASE_DIR / "music.db").exists() else DATA_DIR / "music.db")

# ----------------- Database Setup -----------------
def migrate_legacy_admin_music():
    """將舊版 MUSIC_DIR/admin 下的資料夾和歌曲移至 MUSIC_DIR 根層級，並更新資料庫 rel_path"""
    admin_dir = MUSIC_DIR / "admin"
    if admin_dir.exists() and admin_dir.is_dir():
        try:
            for item in list(admin_dir.iterdir()):
                target = MUSIC_DIR / item.name
                if not target.exists():
                    shutil.move(str(item), str(target))
                else:
                    if item.is_dir():
                        for sub_item in list(item.iterdir()):
                            sub_target = target / sub_item.name
                            if not sub_target.exists():
                                shutil.move(str(sub_item), str(sub_target))
            try:
                # 若 admin 目錄空了則刪除
                if not any(admin_dir.iterdir()):
                    admin_dir.rmdir()
            except Exception:
                pass
        except Exception as e:
            print(f"[MIGRATION WARNING] Failed migrating admin directory: {e}")

    # 資料庫更新 rel_path：將 'admin/...' 去除 'admin/'
    try:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute("UPDATE tracks SET rel_path = SUBSTR(rel_path, 7) WHERE rel_path LIKE 'admin/%'")
            conn.commit()
    except Exception:
        pass

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# Server JWT/HMAC Secret Key
SERVER_SECRET = os.getenv("SERVER_SECRET", "garmin-music-super-secret-key-2026")

def generate_web_token(username: str) -> str:
    import hmac, time
    ts = int(time.time())
    msg = f"{username}:{ts}".encode("utf-8")
    sig = hmac.new(SERVER_SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    return f"{username}:{ts}:{sig}"

def verify_web_token(token: Optional[str]) -> Optional[str]:
    """驗證 Web Token 並返回 username，若無效則返回 None"""
    if not token or ":" not in token:
        return None
    import hmac, time
    try:
        parts = token.split(":")
        if len(parts) != 3:
            return None
        username, ts_str, sig = parts
        ts = int(ts_str)
        # Token 7 天有效
        if time.time() - ts > 7 * 86400:
            return None
        expected_msg = f"{username}:{ts}".encode("utf-8")
        expected_sig = hmac.new(SERVER_SECRET.encode("utf-8"), expected_msg, hashlib.sha256).hexdigest()
        if hmac.compare_digest(sig, expected_sig):
            return username
        return None
    except Exception:
        return None

def get_current_user_from_req(authorization: Optional[str] = Header(None), token: Optional[str] = Query(None)) -> str:
    """Windows 本地桌面版預設單機使用者為 'admin'，若有傳 token 則依 token 驗證"""
    raw_token = token
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization[7:].strip()
    
    if raw_token:
        username = verify_web_token(raw_token)
        if username:
            return username
    # 本地單機模式預設直接使用 admin
    return "admin"

def require_admin(current_user: str = Depends(get_current_user_from_req)) -> str:
    """確認當前使用者具備 admin 權限"""
    with get_db() as conn:
        user = conn.execute("SELECT role FROM users WHERE username = ?", (current_user,)).fetchone()
        if not user or user["role"] != "admin":
            raise HTTPException(status_code=403, detail="需要管理者 (Admin) 權限")
    return current_user

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                role TEXT DEFAULT 'user',
                email TEXT DEFAULT '',
                has_custom_watch_password INTEGER DEFAULT 1
            )
        """)
        
        # 升級已有表格欄位 (若尚未存在)
        user_cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "role" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'")
        if "email" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''")
        if "has_custom_watch_password" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN has_custom_watch_password INTEGER DEFAULT 1")

        # 確保預設使用者 admin 存在且為 admin 角色
        cur = conn.execute("SELECT username FROM users WHERE username = 'admin'")
        if not cur.fetchone():
            conn.execute("INSERT INTO users (username, password, role, has_custom_watch_password) VALUES ('admin', 'admin', 'admin', 1)")
        else:
            conn.execute("UPDATE users SET role = 'admin' WHERE username = 'admin'")

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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                user TEXT DEFAULT 'admin'
            )
        """)

        track_cols = [r[1] for r in conn.execute("PRAGMA table_info(tracks)").fetchall()]
        if "user" not in track_cols:
            conn.execute("ALTER TABLE tracks ADD COLUMN user TEXT DEFAULT 'admin'")
            conn.execute("UPDATE tracks SET user = 'admin' WHERE user IS NULL OR user = ''")

        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
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
    bitrate = 192
    title = file_path.stem
    artist = "Unknown Artist"
    album = "Unknown Album"
    try:
        audio = MP3(file_path, ID3=EasyID3)
        duration = int(audio.info.length)
        bitrate = int(audio.info.bitrate / 1000) if audio.info.bitrate else 192
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
    """
    掃描 MUSIC_DIR 底下的 MP3 檔案至資料庫。
    結構：MUSIC_DIR / <folder> / <song.mp3> (去除了 admin 這層)
    """
    migrate_legacy_admin_music()
    with get_db() as conn:
        existing_paths = {row["rel_path"]: (row["id"], row["user"]) for row in conn.execute("SELECT id, rel_path, user FROM tracks")}
        found_paths = set()

        for file in MUSIC_DIR.rglob("*.mp3"):
            # 略過可能殘留的 admin 目錄
            rel = file.relative_to(MUSIC_DIR).as_posix()
            if rel.startswith("admin/"):
                continue

            found_paths.add(rel)
            
            # 計算 folder (相對於 MUSIC_DIR)
            folder_rel = file.parent.relative_to(MUSIC_DIR).as_posix()
            folder = "音樂" if folder_rel == "." else folder_rel

            if rel not in existing_paths:
                meta = get_audio_metadata(file)
                track_id = str(uuid.uuid4())
                conn.execute("""
                    INSERT INTO tracks (id, title, artist, album, duration, bitrate, size, rel_path, folder, sync_enabled, user)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'admin')
                """, (track_id, meta["title"], meta["artist"], meta["album"], meta["duration"], meta["bitrate"], meta["size"], rel, folder))

        # Cleanup deleted files
        for rel, (tid, _) in existing_paths.items():
            if rel not in found_paths:
                conn.execute("DELETE FROM tracks WHERE id = ?", (tid,))
        conn.commit()

scan_and_sync_files()

# ----------------- FastAPI App -----------------
app = FastAPI(title="Garmin Modern Subsonic & Music Server")

@app.middleware("http")
async def log_garmin_requests(request: Request, call_next):
    path = request.url.path
    if path.startswith("/rest/"):
        client_ip = request.client.host if request.client else "unknown"
        query_params = dict(request.query_params)
        # 隱藏敏感 token / password 內容以保護隱私
        safe_params = {k: ("***" if k in ("p", "t", "password") else v) for k, v in query_params.items()}
        print(f"\n[GARMIN REST INCOMING] >>> {request.method} {path} from {client_ip}")
        print(f"                       Params: {safe_params}")
        print(f"                       User-Agent: {request.headers.get('user-agent', 'none')}")
        
        response = await call_next(request)
        
        print(f"[GARMIN REST RESPONSE] <<< {request.method} {path} -> Status {response.status_code}")
        if path.endswith(("/stream.view", "/download.view")):
            print(f"                       Headers: Content-Type={response.headers.get('content-type')}, Content-Length={response.headers.get('content-length')}")
        return response
    return await call_next(request)

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
    # 每個登入使用者擁有自己獨立的清單與歌曲 (user 隔離)
    with get_db() as conn:
        playlists = []
        
        # 1. 該使用者總同步清單 (sync_enabled = 1)
        cur_total = conn.execute("SELECT COUNT(*), SUM(duration) FROM tracks WHERE sync_enabled = 1 AND user = ?", (user,))
        r_total = cur_total.fetchone()
        playlists.append({
            "id": "all_synced",
            "name": "★ 全部已選歌曲 (Garmin Sync)",
            "songCount": r_total[0] or 0,
            "duration": r_total[1] or 0,
            "created": "2026-11-16 00:00:00",
            "coverArt": "cover_all"
        })

        # 2. 該使用者每個子目錄作為一張獨立歌單 (只算 sync_enabled = 1)
        cur_folders = conn.execute("SELECT DISTINCT folder FROM tracks WHERE folder != '' AND user = ?", (user,))
        for f_row in cur_folders.fetchall():
            folder_name = f_row["folder"]
            c_cur = conn.execute("SELECT COUNT(*), SUM(duration) FROM tracks WHERE folder = ? AND sync_enabled = 1 AND user = ?", (folder_name, user))
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
            cur = conn.execute("SELECT * FROM tracks WHERE sync_enabled = 1 AND user = ? ORDER BY title ASC", (user,))
            name = "全部已選歌曲"
        elif id.startswith("folder_"):
            folder_name = id[len("folder_"):]
            cur = conn.execute("SELECT * FROM tracks WHERE folder = ? AND sync_enabled = 1 AND user = ? ORDER BY title ASC", (folder_name, user))
            name = folder_name
        else:
            cur = conn.execute("SELECT * FROM tracks WHERE sync_enabled = 1 AND user = ? ORDER BY title ASC", (user,))
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
        cur = conn.execute("SELECT * FROM tracks WHERE sync_enabled = 1 AND user = ? ORDER BY RANDOM() LIMIT ?", (user, size))
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

@app.get("/rest/stream.view")
@app.get("/rest/download.view")
def subsonic_stream(id: str = Query(...), user: str = Depends(verify_subsonic_auth)):
    print(f"\n[STREAM DEBUG] Garmin requested song id='{id}' for user='{user}'")
    with get_db() as conn:
        track = conn.execute("SELECT * FROM tracks WHERE id = ? AND user = ?", (id, user)).fetchone()
        if not track:
            # 檢查是否有這首歌但屬於別的 user，方便釐清隔離問題
            other = conn.execute("SELECT user, title FROM tracks WHERE id = ?", (id,)).fetchone()
            if other:
                print(f"[STREAM ERROR] Track '{id}' exists but belongs to user '{other['user']}', not '{user}'! (Title: {other['title']})")
            else:
                print(f"[STREAM ERROR] Track '{id}' not found in DB at all for user '{user}'!")
            raise HTTPException(status_code=404, detail="Track not found")
            
        file_path = MUSIC_DIR / track["rel_path"]
        print(f"[STREAM DEBUG] Track found: '{track['title']}', rel_path='{track['rel_path']}'")
        print(f"[STREAM DEBUG] Absolute disk path: {file_path}")
        
        if not file_path.exists():
            print(f"[STREAM ERROR] File missing on disk! Expected at: {file_path}")
            raise HTTPException(status_code=404, detail="File not found on disk")
        
        file_size = file_path.stat().st_size
        print(f"[STREAM START] Serving '{track['title']}' ({file_size} bytes / {round(file_size/1024/1024, 2)} MB) to Garmin watch [{user}]...")
        
        headers = {
            "Content-Length": str(file_size),
            "Accept-Ranges": "bytes",
        }

        def file_iterator(path: Path, chunk_size: int = 65536):
            bytes_sent = 0
            try:
                with open(path, "rb") as f:
                    while chunk := f.read(chunk_size):
                        bytes_sent += len(chunk)
                        yield chunk
                print(f"[STREAM FINISHED] Successfully streamed '{path.name}' to Garmin [{user}]. Sent {bytes_sent}/{file_size} bytes (100% complete).\n")
            except (ConnectionResetError, BrokenPipeError, asyncio.CancelledError) as e:
                print(f"[STREAM ABORTED] Garmin [{user}] closed connection prematurely. Sent {bytes_sent}/{file_size} bytes ({round(bytes_sent/file_size*100, 1)}%). Reason: {type(e).__name__}\n")
            except Exception as e:
                print(f"[STREAM ERROR] Error while streaming '{path.name}' to Garmin [{user}]: {e}\n")

        return StreamingResponse(
            file_iterator(file_path),
            media_type="audio/mpeg",
            headers=headers
        )

@app.get("/api/tracks/{id}/stream")
def web_stream_track(id: str, token: Optional[str] = Query(None), current_user: str = Depends(get_current_user_from_req)):
    with get_db() as conn:
        track = conn.execute("SELECT * FROM tracks WHERE id = ?", (id,)).fetchone()

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
    return Response(status_code=204)

# ----------------- Management REST API -----------------
class LoginRequest(BaseModel):
    username: str
    password: str

class GoogleAuthRequest(BaseModel):
    credential: str

class UserCreateRequest(BaseModel):
    username: str
    password: str
    role: str = "user"
    email: Optional[str] = ""

class SetWatchPasswordRequest(BaseModel):
    password: str

class GoogleClientConfig(BaseModel):
    client_id: str

@app.get("/api/auth/google-client-id")
def get_google_client_id():
    """取得 Google OAuth Client ID（環境變數或資料庫設定）"""
    cid = os.getenv("GOOGLE_CLIENT_ID", "")
    if not cid:
        with get_db() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key = 'google_client_id'").fetchone()
            if row:
                cid = row["value"]
    return {"client_id": cid}

@app.post("/api/admin/settings/google-client-id")
def set_google_client_id(cfg: GoogleClientConfig, admin: str = Depends(require_admin)):
    """管理者設定 Google OAuth Client ID"""
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_client_id', ?)", (cfg.client_id.strip(),))
        conn.commit()
    return {"status": "ok", "client_id": cfg.client_id.strip()}

@app.post("/api/auth/login")
def login(req: LoginRequest):
    with get_db() as conn:
        user = conn.execute("SELECT username, password, role, email, has_custom_watch_password FROM users WHERE username = ?", (req.username,)).fetchone()
        if not user or user["password"] != req.password:
            raise HTTPException(status_code=401, detail="帳號或密碼錯誤")
        token = generate_web_token(user["username"])
        return {
            "status": "ok",
            "username": user["username"],
            "role": user["role"] or "user",
            "email": user["email"] or "",
            "has_custom_watch_password": bool(user["has_custom_watch_password"]),
            "token": token
        }

@app.post("/api/auth/google")
def google_login(req: GoogleAuthRequest):
    """
    透過 Google ID Token 驗證並登入。
    使用 Google tokeninfo 端點校驗，安全且免第三方繁重依賴。
    """
    credential = req.credential.strip()
    if not credential:
        raise HTTPException(status_code=400, detail="Missing Google credential")
    
    try:
        verify_url = f"https://oauth2.googleapis.com/tokeninfo?id_token={urllib.parse.quote(credential)}"
        req_token = urllib.request.Request(verify_url, headers={"User-Agent": "Garmin-Music-Server"})
        with urllib.request.urlopen(req_token, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Google 驗證失敗: {str(e)}")

    email = data.get("email")
    if not email:
        raise HTTPException(status_code=401, detail="無法從 Google Token 取得 Email")

    username = email.lower().strip()
    with get_db() as conn:
        user = conn.execute("SELECT username, password, role, email, has_custom_watch_password FROM users WHERE username = ?", (username,)).fetchone()
        if not user:
            # 自動建立新用戶 (初始生成隨機手錶密碼，並標記 has_custom_watch_password = 0 提示使用者自訂)
            initial_watch_pwd = uuid.uuid4().hex[:8]
            role = "admin" if username.startswith("admin@") else "user"
            conn.execute("""
                INSERT INTO users (username, password, role, email, has_custom_watch_password)
                VALUES (?, ?, ?, ?, 0)
            """, (username, initial_watch_pwd, role, username))
            conn.commit()
            
            # 建立用戶專屬音樂資料夾
            (MUSIC_DIR / username).mkdir(parents=True, exist_ok=True)
            
            user = conn.execute("SELECT username, password, role, email, has_custom_watch_password FROM users WHERE username = ?", (username,)).fetchone()

        token = generate_web_token(user["username"])
        return {
            "status": "ok",
            "username": user["username"],
            "role": user["role"] or "user",
            "email": user["email"] or "",
            "has_custom_watch_password": bool(user["has_custom_watch_password"]),
            "token": token
        }

@app.post("/api/auth/change-password")
def change_password(req: LoginRequest, current_user: str = Depends(get_current_user_from_req)):
    # 僅允許修改自己的密碼，除非是 admin
    target_user = req.username if req.username else current_user
    with get_db() as conn:
        caller = conn.execute("SELECT role FROM users WHERE username = ?", (current_user,)).fetchone()
        is_admin = caller and caller["role"] == "admin"
        if target_user != current_user and not is_admin:
            raise HTTPException(status_code=403, detail="無權修改其他使用者的密碼")
        
        conn.execute("UPDATE users SET password = ?, has_custom_watch_password = 1 WHERE username = ?", (req.password, target_user))
        conn.commit()
    return {"status": "ok"}

@app.post("/api/user/set-watch-password")
def set_watch_password(req: SetWatchPasswordRequest, current_user: str = Depends(get_current_user_from_req)):
    """給 Google 登入的使用者設定或更新專屬手錶連線密碼"""
    if not req.password.strip():
        raise HTTPException(status_code=400, detail="密碼不可為空")
    with get_db() as conn:
        conn.execute("UPDATE users SET password = ?, has_custom_watch_password = 1 WHERE username = ?", (req.password.strip(), current_user))
        conn.commit()
    return {"status": "ok"}

# ----------------- Admin User Management API -----------------
@app.get("/api/admin/users")
def admin_list_users(admin: str = Depends(require_admin)):
    with get_db() as conn:
        rows = conn.execute("SELECT username, role, email, created_at, has_custom_watch_password FROM users ORDER BY created_at ASC").fetchall()
        # 統計各用戶的歌曲數
        counts = {r["user"]: r["c"] for r in conn.execute("SELECT user, COUNT(*) as c FROM tracks GROUP BY user").fetchall()}
        return [
            {
                "username": r["username"],
                "role": r["role"],
                "email": r["email"],
                "created_at": r["created_at"],
                "has_custom_watch_password": bool(r["has_custom_watch_password"]),
                "track_count": counts.get(r["username"], 0)
            }
            for r in rows
        ]

@app.post("/api/admin/users")
def admin_create_user(req: UserCreateRequest, admin: str = Depends(require_admin)):
    username = req.username.strip()
    if not username or not req.password:
        raise HTTPException(status_code=400, detail="請填寫完整帳號與密碼")
    
    # 清理非合法字元以利作為資料夾名
    clean_username = re.sub(r'[\\/*?:"<>|]', "", username).strip()
    if not clean_username:
        raise HTTPException(status_code=400, detail="帳號含有非法字元")
        
    with get_db() as conn:
        exists = conn.execute("SELECT username FROM users WHERE username = ?", (clean_username,)).fetchone()
        if exists:
            raise HTTPException(status_code=400, detail="使用者帳號已存在")
        
        conn.execute("""
            INSERT INTO users (username, password, role, email, has_custom_watch_password)
            VALUES (?, ?, ?, ?, 1)
        """, (clean_username, req.password, req.role, req.email or ""))
        conn.commit()
        
    (MUSIC_DIR / clean_username).mkdir(parents=True, exist_ok=True)
    return {"status": "ok", "username": clean_username}

@app.delete("/api/admin/users/{target_username}")
def admin_delete_user(target_username: str, admin: str = Depends(require_admin)):
    if target_username == "admin" or target_username == admin:
        raise HTTPException(status_code=400, detail="無法刪除目前管理者帳號或預設 admin 帳號")
    
    with get_db() as conn:
        # 刪除該用戶的所有歌曲紀錄
        conn.execute("DELETE FROM tracks WHERE user = ?", (target_username,))
        # 刪除用戶紀錄
        conn.execute("DELETE FROM users WHERE username = ?", (target_username,))
        conn.commit()

    # 移除該用戶的實體資料夾
    user_dir = MUSIC_DIR / target_username
    if user_dir.exists():
        shutil.rmtree(user_dir, ignore_errors=True)

    return {"status": "ok", "deleted": target_username}

# ----------------- User Folders & Tracks API -----------------
@app.get("/api/folders")
def list_folders(current_user: str = Depends(get_current_user_from_req)):
    folders = []
    for item in MUSIC_DIR.iterdir():
        if item.is_dir() and item.name not in ("admin", "data", "bin", "__pycache__"):
            folders.append(item.name)
    if "音樂" not in folders:
        (MUSIC_DIR / "音樂").mkdir(parents=True, exist_ok=True)
        folders.append("音樂")
    return sorted(list(set(folders)))

@app.post("/api/folders")
def create_folder(folder_name: str = Query(...), current_user: str = Depends(get_current_user_from_req)):
    clean_folder = re.sub(r'[\\/*?:"<>|]', "", folder_name).strip()
    if not clean_folder or clean_folder in ("admin", "data", "bin"):
        raise HTTPException(status_code=400, detail="Invalid folder name")
    target_dir = MUSIC_DIR / clean_folder
    target_dir.mkdir(parents=True, exist_ok=True)
    return {"status": "ok", "folder": clean_folder}

@app.delete("/api/folders/{folder_name}")
def delete_folder(folder_name: str, current_user: str = Depends(get_current_user_from_req)):
    clean_folder = re.sub(r'[\\/*?:"<>|]', "", folder_name).strip()
    if not clean_folder:
        raise HTTPException(status_code=400, detail="Invalid folder name")
    
    with get_db() as conn:
        # 查詢此目錄下的所有歌曲，準備清理磁碟與資料庫
        rows = conn.execute("SELECT id, rel_path FROM tracks WHERE folder = ?", (clean_folder,)).fetchall()
        for r in rows:
            file_path = MUSIC_DIR / r["rel_path"]
            if file_path.exists():
                try:
                    file_path.unlink()
                except Exception:
                    pass
        conn.execute("DELETE FROM tracks WHERE folder = ?", (clean_folder,))
        conn.commit()

    # 刪除實體目錄及其內殘留檔案
    target_dir = MUSIC_DIR / clean_folder
    if target_dir.exists():
        shutil.rmtree(target_dir, ignore_errors=True)

    return {"status": "ok", "deleted_folder": clean_folder}

@app.get("/api/tracks")
def list_tracks(folder: Optional[str] = None, current_user: str = Depends(get_current_user_from_req)):
    with get_db() as conn:
        if folder and folder != "ALL":
            cur = conn.execute("SELECT * FROM tracks WHERE folder = ? ORDER BY title ASC", (folder,))
        else:
            cur = conn.execute("SELECT * FROM tracks ORDER BY folder ASC, title ASC")
        return [dict(r) for r in cur.fetchall()]

@app.post("/api/tracks/{track_id}/sync")
def toggle_sync(track_id: str, enabled: bool = Query(...), current_user: str = Depends(get_current_user_from_req)):
    with get_db() as conn:
        conn.execute("UPDATE tracks SET sync_enabled = ? WHERE id = ? AND user = ?", (1 if enabled else 0, track_id, current_user))
        conn.commit()
    return {"status": "ok", "id": track_id, "sync_enabled": enabled}

@app.post("/api/folders/{folder}/batch-sync")
def batch_sync_folder(folder: str, enabled: bool = Query(...), current_user: str = Depends(get_current_user_from_req)):
    with get_db() as conn:
        conn.execute("UPDATE tracks SET sync_enabled = ? WHERE folder = ? AND user = ?", (1 if enabled else 0, folder, current_user))
        conn.commit()
    return {"status": "ok", "folder": folder, "sync_enabled": enabled}

class RenameTrackRequest(BaseModel):
    new_title: str

@app.put("/api/tracks/{track_id}/rename")
def rename_track(track_id: str, req: RenameTrackRequest, current_user: str = Depends(get_current_user_from_req)):
    clean_title = re.sub(r'[\\/*?:"<>|]', "", req.new_title).strip()
    if not clean_title:
        raise HTTPException(status_code=400, detail="歌名/檔案名稱無效")

    with get_db() as conn:
        track = conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()
        if not track:
            raise HTTPException(status_code=404, detail="Track not found")

        old_file = MUSIC_DIR / track["rel_path"]
        if not old_file.exists():
            raise HTTPException(status_code=404, detail="File not found on disk")

        new_file = old_file.parent / f"{clean_title}.mp3"
        if new_file.resolve() != old_file.resolve():
            if new_file.exists():
                raise HTTPException(status_code=400, detail="已有相同名稱的檔案存在")
            try:
                old_file.rename(new_file)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"重新命名實體檔案失敗: {str(e)}")

        # 更新 ID3 Title
        try:
            audio = MP3(str(new_file), ID3=EasyID3)
            audio["title"] = clean_title
            audio.save()
        except Exception:
            pass

        new_rel_path = new_file.relative_to(MUSIC_DIR).as_posix()
        conn.execute("UPDATE tracks SET title = ?, rel_path = ? WHERE id = ?", (clean_title, new_rel_path, track_id))
        conn.commit()

    return {"status": "ok", "id": track_id, "title": clean_title, "rel_path": new_rel_path}

class RenameWatchTrackRequest(BaseModel):
    rel_path: str
    new_title: str
    watch_path: Optional[str] = None

@app.put("/api/watch/tracks/rename")
def rename_watch_track(req: RenameWatchTrackRequest, current_user: str = Depends(get_current_user_from_req)):
    clean_title = re.sub(r'[\\/*?:"<>|]', "", req.new_title).strip()
    if not clean_title:
        raise HTTPException(status_code=400, detail="歌名/檔案名稱無效")

    target_str = req.watch_path
    if not target_str:
        with get_db() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key = 'watch_mount_path'").fetchone()
            if row and row["value"]:
                target_str = row["value"]
        if not target_str:
            drives = detect_garmin_watch_drives()
            if drives:
                target_str = drives[0]["path"]

    if not target_str or not Path(target_str).exists():
        raise HTTPException(status_code=400, detail="未找到 Garmin 手錶音樂磁碟")

    watch_dir = Path(target_str)
    old_file = watch_dir / req.rel_path
    if not old_file.exists():
        raise HTTPException(status_code=404, detail="手錶上的檔案不存在")

    new_file = old_file.parent / f"{clean_title}.mp3"
    if new_file.resolve() != old_file.resolve():
        if new_file.exists():
            raise HTTPException(status_code=400, detail="手錶該目錄下已有同名檔案")
        try:
            old_file.rename(new_file)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"重新命名手錶檔案失敗: {str(e)}")

    # 更新 ID3 Title
    try:
        audio = MP3(str(new_file), ID3=EasyID3)
        audio["title"] = clean_title
        audio.save()
    except Exception:
        pass

    new_rel_path = str(new_file.relative_to(watch_dir)).replace("\\", "/")

    # 更新手錶目錄下的 M3U8 播放清單
    folder_name = new_file.parent.name
    m3u8_file = watch_dir / f"{folder_name}.m3u8"
    if m3u8_file.exists():
        mp3s = sorted(new_file.parent.glob("*.mp3"))
        lines = ["#EXTM3U\n"]
        for mp3 in mp3s:
            lines.append(f"#EXTINF:-1,{mp3.stem}\n")
            lines.append(f"{folder_name}/{mp3.name}\n")
        try:
            with open(m3u8_file, "w", encoding="utf-8") as f:
                f.writelines(lines)
        except Exception:
            pass

    return {"status": "ok", "rel_path": new_rel_path, "title": clean_title}

@app.delete("/api/tracks/{track_id}")
def delete_track(track_id: str, current_user: str = Depends(get_current_user_from_req)):
    with get_db() as conn:
        cur = conn.execute("SELECT rel_path, user FROM tracks WHERE id = ?", (track_id,))
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

class BatchDeleteTracksRequest(BaseModel):
    track_ids: List[str]

@app.post("/api/tracks/batch-delete")
def batch_delete_tracks(req: BatchDeleteTracksRequest, current_user: str = Depends(get_current_user_from_req)):
    deleted_ids = []
    with get_db() as conn:
        for tid in req.track_ids:
            cur = conn.execute("SELECT rel_path, user FROM tracks WHERE id = ?", (tid,))
            row = cur.fetchone()
            if not row:
                continue
            
            file_path = MUSIC_DIR / row["rel_path"]
            if file_path.exists():
                try:
                    file_path.unlink()
                except Exception:
                    pass
            conn.execute("DELETE FROM tracks WHERE id = ?", (tid,))
            deleted_ids.append(tid)

        conn.commit()
    return {"status": "ok", "deleted": deleted_ids}

@app.post("/api/scan")
def trigger_scan(current_user: str = Depends(get_current_user_from_req)):
    scan_and_sync_files()
    return {"status": "ok"}

@app.post("/api/tracks/upload")
async def upload_mp3(folder: str = Form("音樂"), file: UploadFile = File(...), current_user: str = Depends(get_current_user_from_req)):
    if not file.filename.lower().endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only .mp3 files are allowed")
    
    clean_folder = re.sub(r'[\\/*?:"<>|]', "", folder).strip()
    if not clean_folder:
        clean_folder = "音樂"
        
    target_folder = MUSIC_DIR / clean_folder
    target_folder.mkdir(parents=True, exist_ok=True)
    
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
            INSERT INTO tracks (id, title, artist, album, duration, bitrate, size, rel_path, folder, sync_enabled, user)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'admin')
        """, (track_id, meta["title"], meta["artist"], meta["album"], meta["duration"], meta["bitrate"], meta["size"], rel_path, clean_folder))
        conn.commit()
        
    return {"status": "success", "track": {"id": track_id, **meta, "rel_path": rel_path, "folder": clean_folder, "user": "admin"}}

# ----------------- Downloader & Podcast Exploration -----------------
class DownloadRequest(BaseModel):
    url: str
    target_folder: str = "音樂"
    download_playlist: bool = False
    custom_title: Optional[str] = None
    custom_artist: Optional[str] = None

class DirectAudioDownloadRequest(BaseModel):
    audio_url: str
    title: str
    artist: str = "Podcast"
    target_folder: str = "音樂"

def run_download_task(task_id: str, url: str, target_folder: str = "音樂", download_playlist: bool = False, custom_title: Optional[str] = None, custom_artist: Optional[str] = None, current_user: str = "admin"):
    display_title = custom_title or url
    DOWNLOAD_TASKS[task_id] = {"status": "processing", "progress": "Starting...", "title": display_title, "url": url, "user": current_user, "error": None}
    
    clean_target = re.sub(r'[\\/*?:"<>|]', "", target_folder).strip() if target_folder else "音樂"
    if not clean_target:
        clean_target = "音樂"
    target_dir = MUSIC_DIR / clean_target
    target_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        is_direct_audio = url.lower().endswith(".mp3") or "audio" in url.lower() or custom_title is not None
        is_rss = False
        if not is_direct_audio:
            try:
                feed = feedparser.parse(url)
                if feed.entries and len(feed.entries) > 0 and any("enclosures" in entry for entry in feed.entries):
                    is_rss = True
            except Exception:
                is_rss = False
            
        if is_direct_audio:
            ep_title = custom_title or f"Audio_{uuid.uuid4().hex[:6]}"
            clean_title = re.sub(r'[\\/*?:"<>|]', "", ep_title)[:60]
            target_file = target_dir / f"{clean_title}.mp3"
            
            DOWNLOAD_TASKS[task_id]["title"] = ep_title
            DOWNLOAD_TASKS[task_id]["progress"] = f"Downloading: {ep_title}..."
            
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as resp, open(target_file, "wb") as f:
                shutil.copyfileobj(resp, f)
                
            scan_and_sync_files()
            DOWNLOAD_TASKS[task_id]["status"] = "completed"
            DOWNLOAD_TASKS[task_id]["progress"] = "Completed"
            return

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
            
            req = urllib.request.Request(audio_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as resp, open(target_file, "wb") as f:
                shutil.copyfileobj(resp, f)
            
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
                DOWNLOAD_TASKS[task_id]["progress"] = "Converting audio to MP3 (192k)..."

        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'postprocessor_args': {
                'ExtractAudio+ffmpeg': ['-ar', '44100', '-ac', '2', '-id3v2_version', '3']
            },
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
def start_download(req: DownloadRequest, background_tasks: BackgroundTasks, current_user: str = Depends(get_current_user_from_req)):
    task_id = str(uuid.uuid4())
    background_tasks.add_task(run_download_task, task_id, req.url, req.target_folder, req.download_playlist, req.custom_title, req.custom_artist, current_user)
    return {"task_id": task_id, "status": "queued"}

@app.post("/api/download/direct")
def start_direct_download(req: DirectAudioDownloadRequest, background_tasks: BackgroundTasks, current_user: str = Depends(get_current_user_from_req)):
    for tid, t in DOWNLOAD_TASKS.items():
        if t.get("url") == req.audio_url and t.get("user") == current_user and t.get("status") in ("processing", "queued"):
            return {"task_id": tid, "status": "already_queued", "message": "此單集已在下載佇列中"}
            
    task_id = str(uuid.uuid4())
    DOWNLOAD_TASKS[task_id] = {
        "status": "queued",
        "progress": "已排入下載佇列...",
        "title": req.title,
        "url": req.audio_url,
        "user": current_user,
        "error": None
    }
    background_tasks.add_task(run_download_task, task_id, req.audio_url, req.target_folder, False, req.title, req.artist, current_user)
    return {"task_id": task_id, "status": "queued"}

@app.get("/api/download/tasks")
def get_download_tasks(current_user: str = Depends(get_current_user_from_req)):
    # 僅返回屬於當前使用者的任務 (或 admin 返回全部)
    with get_db() as conn:
        user_row = conn.execute("SELECT role FROM users WHERE username = ?", (current_user,)).fetchone()
        is_admin = user_row and user_row["role"] == "admin"
        
    if is_admin:
        return DOWNLOAD_TASKS
    return {k: v for k, v in DOWNLOAD_TASKS.items() if v.get("user") == current_user}

# ----------------- Podcast iTunes Directory Search API -----------------
@app.get("/api/podcast/search")
def search_podcast(q: str = Query(..., min_length=1)):
    encoded_q = urllib.parse.quote(q.strip())
    url = f"https://itunes.apple.com/search?term={encoded_q}&media=podcast&entity=podcast&limit=15"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results = []
            for item in data.get("results", []):
                feed_url = item.get("feedUrl")
                if feed_url:
                    results.append({
                        "id": str(item.get("collectionId")),
                        "title": item.get("collectionName"),
                        "artist": item.get("artistName"),
                        "feedUrl": feed_url,
                        "artwork": item.get("artworkUrl600") or item.get("artworkUrl100"),
                        "trackCount": item.get("trackCount", 0)
                    })
            return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Podcast search failed: {str(e)}")

@app.get("/api/podcast/episodes")
def get_podcast_episodes(feed_url: str = Query(...)):
    try:
        feed = feedparser.parse(feed_url)
        episodes = []
        for e in feed.entries[:30]:  # 取最新 30 集
            audio_url = None
            size = 0
            for enc in getattr(e, "enclosures", []):
                if "audio" in enc.get("type", "") or enc.get("href", "").endswith(".mp3"):
                    audio_url = enc.get("href")
                    size = enc.get("length", 0)
                    break
            if audio_url:
                episodes.append({
                    "id": getattr(e, "id", audio_url),
                    "title": e.get("title", "未命名單集"),
                    "published": e.get("published", ""),
                    "duration": getattr(e, "itunes_duration", None),
                    "audio_url": audio_url,
                    "summary": getattr(e, "summary", "")[:200] if getattr(e, "summary", None) else ""
                })
        return {
            "title": feed.feed.get("title", "Podcast"),
            "artist": feed.feed.get("author", "Podcast Author"),
            "artwork": getattr(feed.feed, "image", {}).get("href") if getattr(feed.feed, "image", None) else None,
            "episodes": episodes
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse podcast episodes: {str(e)}")

# ----------------- Windows Watch Drive & USB Sync API -----------------
class WatchDriveConfig(BaseModel):
    path: str

class WatchSyncRequest(BaseModel):
    track_ids: List[str]
    watch_path: Optional[str] = None

class WatchDeleteRequest(BaseModel):
    rel_paths: List[str]
    watch_path: Optional[str] = None

def detect_garmin_watch_drives() -> List[Dict[str, Any]]:
    """掃描 Windows 磁碟機代號，偵測 Garmin 手錶的 Music 目錄"""
    import string
    candidates = []
    
    # 支援設定檔自訂優先
    custom_path = None
    with get_db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = 'watch_mount_path'").fetchone()
        if row and row["value"]:
            custom_path = Path(row["value"])
            if custom_path.exists():
                try:
                    t, u, f = shutil.disk_usage(str(custom_path))
                    candidates.append({
                        "path": str(custom_path.resolve()),
                        "drive": custom_path.drive,
                        "label": f"自訂路徑 ({custom_path})",
                        "total_bytes": t,
                        "free_bytes": f,
                        "used_bytes": u,
                        "is_custom": True
                    })
                except Exception:
                    pass

    for letter in string.ascii_uppercase:
        drive_str = f"{letter}:\\"
        drive_path = Path(drive_str)
        if not drive_path.exists():
            continue
            
        try:
            total, used, free = shutil.disk_usage(drive_str)
            # 尋找標準 Garmin 目錄或任何包含 Music / music 的手錶結構
            possible_dirs = [
                drive_path / "GARMIN" / "Music",
                drive_path / "Garmin" / "Music",
                drive_path / "GARMIN" / "music",
                drive_path / "Garmin" / "music",
                drive_path / "garmin" / "music",
                drive_path / "Music",
                drive_path / "music",
            ]
            
            for p in possible_dirs:
                if p.exists() and p.is_dir():
                    # 避免重複加入
                    if not any(c["path"] == str(p.resolve()) for c in candidates):
                        is_garmin = "GARMIN" in str(p).upper()
                        label = f"Garmin 手錶 ({letter}:)" if is_garmin else f"抽取式磁碟 ({letter}:\\Music)"
                        candidates.append({
                            "path": str(p.resolve()),
                            "drive": f"{letter}:",
                            "label": label,
                            "total_bytes": total,
                            "free_bytes": free,
                            "used_bytes": used,
                            "is_custom": False
                        })
        except Exception:
            continue
            
    return candidates

@app.get("/api/watch/status")
def get_watch_status(current_user: str = Depends(get_current_user_from_req)):
    """取得當前已連線手錶狀態、空間與所有偵測到的候選路徑"""
    drives = detect_garmin_watch_drives()
    active_path = None
    if drives:
        active_path = drives[0]["path"]
    
    with get_db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = 'watch_mount_path'").fetchone()
        if row and row["value"] and Path(row["value"]).exists():
            active_path = row["value"]
            
    active_info = None
    if active_path and Path(active_path).exists():
        try:
            t, u, f = shutil.disk_usage(active_path)
            active_info = {
                "path": str(Path(active_path).resolve()),
                "total_bytes": t,
                "free_bytes": f,
                "used_bytes": u,
                "free_gb": round(f / (1024**3), 2),
                "total_gb": round(t / (1024**3), 2),
                "used_percent": round((u / t) * 100, 1) if t > 0 else 0
            }
        except Exception:
            pass

    return {
        "connected": active_info is not None,
        "active_watch": active_info,
        "detected_drives": drives
    }

@app.post("/api/watch/config")
def set_watch_config(cfg: WatchDriveConfig, current_user: str = Depends(get_current_user_from_req)):
    r"""手動設定手錶音樂資料夾路徑，支援標準路徑與 MTP (mtp:\...) 裝置路徑"""
    raw_path = cfg.path.strip()
    if raw_path.startswith("mtp:\\") or raw_path.startswith("mtp:/"):
        saved_path = raw_path
    else:
        p = Path(raw_path)
        if not p.exists():
            raise HTTPException(status_code=400, detail="指定的資料夾不存在")
        saved_path = str(p.resolve())

    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('watch_mount_path', ?)", (saved_path,))
        conn.commit()
    return {"status": "ok", "path": saved_path}

def get_mtp_helper_path() -> Path:
    """取得 MTP 裝置輔助腳本路徑"""
    if getattr(sys, 'frozen', False):
        p = Path(sys._MEIPASS) / "backend" / "mtp_helper.ps1"
        if p.exists():
            return p
        p = Path(sys.executable).resolve().parent / "backend" / "mtp_helper.ps1"
        if p.exists():
            return p
    return Path(__file__).resolve().parent / "mtp_helper.ps1"

def call_mtp_helper(action: str, device_name: str = "", sub_path: str = "", source_file: str = "", file_name: str = "", timeout: int = 10) -> Optional[Any]:
    """安全呼叫 mtp_helper.ps1 並解析 JSON，防止 CP950/UTF-8 編碼異常與超時"""
    script = get_mtp_helper_path()
    if not script.exists():
        print(f"[MTP ERROR] 找不到輔助腳本: {script}")
        return None
    try:
        import subprocess, json
        cmd = [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", str(script),
            "-Action", action,
            "-DeviceName", device_name,
            "-SubPath", sub_path,
            "-SourceFile", source_file,
            "-FileName", file_name
        ]
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        res = subprocess.run(cmd, capture_output=True, text=False, timeout=timeout, creationflags=flags)
        try:
            out = res.stdout.decode("utf-8").strip()
        except UnicodeDecodeError:
            out = res.stdout.decode("cp950", errors="replace").strip()

        if res.returncode == 0 and out:
            return json.loads(out)
        else:
            try:
                err = res.stderr.decode("utf-8").strip()
            except UnicodeDecodeError:
                err = res.stderr.decode("cp950", errors="replace").strip()
            print(f"[MTP ERROR] Action={action} ReturnCode={res.returncode}, STDERR={err}")
    except Exception as e:
        print(f"[MTP EXCEPTION] Action={action} failed: {e}")
    return None

def get_mtp_devices_list() -> List[Dict[str, Any]]:
    """透過 PowerShell 查詢目前連接中的 MTP / 可攜式裝置 (例如 Garmin 手錶)"""
    res = call_mtp_helper("list_devices", timeout=8)
    if isinstance(res, list):
        return res
    elif isinstance(res, dict):
        return [res]
    return []

@app.get("/api/system/drives")
def get_system_drives(current_user: str = Depends(get_current_user_from_req)):
    """列出電腦中所有可用磁碟機（包含實體硬碟、隨身碟與網路磁碟槽）以及連接中的 MTP 可攜式裝置"""
    drives = []
    try:
        import ctypes
        bitmask = ctypes.windll.kernel32.GetLogicalDrives()
        for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
            if bitmask & 1:
                root = f"{letter}:\\"
                try:
                    dtype = ctypes.windll.kernel32.GetDriveTypeW(root)
                    # 排除 DRIVE_NO_ROOT_DIR (1) 與已離線或無效磁碟槽
                    if dtype not in (0, 1):
                        vol_name = ctypes.create_unicode_buffer(1024)
                        ret = ctypes.windll.kernel32.GetVolumeInformationW(
                            root, vol_name, ctypes.sizeof(vol_name),
                            None, None, None, None, 0
                        )
                        v_label = vol_name.value.strip() if ret and vol_name.value else ""
                        if v_label:
                            label = f"{v_label} ({letter}:)"
                        else:
                            label = f"磁碟機 ({letter}:)"
                        drives.append({
                            "path": root,
                            "label": label,
                            "is_mtp": False
                        })
                except Exception:
                    pass
            bitmask >>= 1
    except Exception:
        import string
        for letter in string.ascii_uppercase:
            root = f"{letter}:\\"
            try:
                if os.path.exists(root):
                    drives.append({
                        "path": root,
                        "label": f"磁碟機 ({letter}:)",
                        "is_mtp": False
                    })
            except Exception:
                continue

    # 查詢是否有連接的 MTP / 可攜式裝置（例如 Garmin 手錶）
    try:
        mtp_devs = get_mtp_devices_list()
        for m in mtp_devs:
            drives.append({
                "path": m.get("path"),
                "label": m.get("label", f"{m.get('name')} (MTP 裝置)"),
                "is_mtp": True
            })
    except Exception:
        pass

    # 確保最基本有系統的 C:\
    if not drives and os.path.exists("C:\\"):
        drives.append({"path": "C:\\", "label": "本機磁碟 (C:)", "is_mtp": False})

    return {"drives": drives}

@app.get("/api/system/folders")
def list_system_subfolders(path: str = Query(...), current_user: str = Depends(get_current_user_from_req)):
    r"""瀏覽指定路徑底下的子資料夾，支援標準磁碟路徑與 MTP (mtp:\...) 裝置路徑"""
    if path.startswith("mtp:\\") or path.startswith("mtp:/"):
        clean = path[5:].replace("/", "\\").strip("\\")
        parts = clean.split("\\", 1)
        dev_name = parts[0]
        sub_path = parts[1] if len(parts) > 1 else ""
        data = call_mtp_helper("list_folders", device_name=dev_name, sub_path=sub_path, timeout=8)
        if data and isinstance(data, dict):
            if "error" in data:
                raise HTTPException(status_code=400, detail=data["error"])
            return data
        raise HTTPException(status_code=400, detail="無法取得 MTP 資料夾內容，請確認手錶螢幕已解鎖並保持 USB 連線")

    try:
        if not os.path.exists(path) or not os.path.isdir(path):
            raise HTTPException(status_code=400, detail="路徑不存在或非資料夾")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"路徑無法讀取: {str(e)}")

    subfolders = []
    try:
        for item in os.listdir(path):
            try:
                full = os.path.join(path, item)
                if os.path.isdir(full) and not item.startswith('$') and not item.startswith('.'):
                    subfolders.append({
                        "name": item,
                        "path": full
                    })
            except Exception:
                continue
    except PermissionError:
        pass
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    subfolders.sort(key=lambda x: x["name"].lower())
    p = Path(path)
    parent_path = str(p.parent.resolve()) if p.parent != p and os.path.exists(str(p.parent)) else None
    return {
        "current_path": str(Path(path).resolve()),
        "parent_path": parent_path,
        "subfolders": subfolders
    }

@app.get("/api/watch/tracks")
def get_watch_tracks(watch_path: Optional[str] = None, current_user: str = Depends(get_current_user_from_req)):
    r"""掃描手錶內的 MP3 歌曲與播放清單，支援標準磁碟路徑與 MTP (mtp:\...) 裝置"""
    target_str = watch_path
    if not target_str:
        with get_db() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key = 'watch_mount_path'").fetchone()
            if row and row["value"]:
                target_str = row["value"]
        if not target_str:
            drives = detect_garmin_watch_drives()
            if drives:
                target_str = drives[0]["path"]
                
    if not target_str:
        return {"connected": False, "tracks": [], "playlists": []}

    # 處理 MTP 裝置歌曲掃描
    if target_str.startswith("mtp:\\") or target_str.startswith("mtp:/"):
        clean = target_str[5:].replace("/", "\\").strip("\\")
        parts = clean.split("\\", 1)
        dev_name = parts[0]
        sub_path = parts[1] if len(parts) > 1 else ""
        try:
            files = call_mtp_helper("list_files", device_name=dev_name, sub_path=sub_path, timeout=10)
            files = files if isinstance(files, list) else []
            watch_tracks = []
            for f in files:
                fname = f.get("name", "")
                if fname.lower().endswith(".mp3"):
                    watch_tracks.append({
                        "filename": fname,
                        "title": Path(fname).stem,
                        "artist": "Garmin Watch",
                        "duration": 0,
                        "size": f.get("size", 0),
                        "folder": "手錶音樂",
                        "rel_path": fname,
                        "full_path": f.get("path", f"mtp:\\{dev_name}\\{sub_path}\\{fname}"),
                        "mtime": 0
                    })
            return {
                "connected": True,
                "watch_path": target_str,
                "playlists": [],
                "tracks": sorted(watch_tracks, key=lambda x: x["title"])
            }
        except Exception as e:
            print(f"[MTP ERROR] 讀取 MTP 歌曲失敗: {e}")
            return {"connected": False, "tracks": [], "playlists": []}

    if not Path(target_str).exists():
        return {"connected": False, "tracks": [], "playlists": []}

    target_dir = Path(target_str)
    watch_tracks = []
    playlists = []
    
    # 掃描 M3U8/M3U
    for pl_file in target_dir.glob("*.m3u*"):
        playlists.append(pl_file.stem)

    # 遞迴掃描 MP3 檔案
    for mp3_file in target_dir.rglob("*.mp3"):
        try:
            rel = mp3_file.relative_to(target_dir)
            folder_name = rel.parent.name if rel.parent != Path(".") else "根目錄"
            stat = mp3_file.stat()
            
            # 讀取 ID3
            title = mp3_file.stem
            artist = "Unknown Artist"
            duration = 0
            try:
                audio = MP3(str(mp3_file), ID3=EasyID3)
                duration = int(audio.info.length)
                if audio.tags:
                    title = audio.tags.get("title", [title])[0]
                    artist = audio.tags.get("artist", [artist])[0]
            except Exception:
                pass
                
            watch_tracks.append({
                "filename": mp3_file.name,
                "title": title,
                "artist": artist,
                "duration": duration,
                "size": stat.st_size,
                "folder": folder_name,
                "rel_path": str(rel).replace("\\", "/"),
                "full_path": str(mp3_file.resolve()),
                "mtime": stat.st_mtime
            })
        except Exception:
            continue

    return {
        "connected": True,
        "watch_path": str(target_dir.resolve()),
        "playlists": sorted(list(set(playlists))),
        "tracks": sorted(watch_tracks, key=lambda x: (x["folder"], x["title"]))
    }

@app.post("/api/watch/sync")
def sync_tracks_to_watch(req: WatchSyncRequest, current_user: str = Depends(get_current_user_from_req)):
    """將選取的電腦端歌曲複製到手錶磁碟或 MTP 裝置，並更新 M3U8 播放清單"""
    target_str = req.watch_path
    if not target_str:
        with get_db() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key = 'watch_mount_path'").fetchone()
            if row and row["value"]:
                target_str = row["value"]
        if not target_str:
            drives = detect_garmin_watch_drives()
            if drives:
                target_str = drives[0]["path"]

    if not target_str:
        raise HTTPException(status_code=400, detail="未設定手錶路徑，請確認手錶已連線或手動指定路徑")

    with get_db() as conn:
        placeholders = ",".join("?" * len(req.track_ids))
        cur = conn.execute(f"SELECT * FROM tracks WHERE id IN ({placeholders})", (*req.track_ids,))
        tracks = cur.fetchall()

    if not tracks:
        raise HTTPException(status_code=400, detail="未選取任何有效歌曲")

    # 處理 MTP 裝置同步
    if target_str.startswith("mtp:\\") or target_str.startswith("mtp:/"):
        clean = target_str[5:].replace("/", "\\").strip("\\")
        parts = clean.split("\\", 1)
        dev_name = parts[0]
        sub_path = parts[1] if len(parts) > 1 else ""

        copied = []
        failed = []
        for t in tracks:
            src_file = MUSIC_DIR / t["rel_path"]
            if not src_file.exists():
                failed.append({"title": t["title"], "reason": "電腦上原始檔案遺失"})
                continue
            data = call_mtp_helper("copy_file", device_name=dev_name, sub_path=sub_path, source_file=str(src_file), timeout=30)
            if data and data.get("success"):
                copied.append(t["title"])
            else:
                err_msg = data.get("error") if data else "複製失敗"
                failed.append({"title": t["title"], "reason": err_msg})

        return {
            "status": "ok",
            "copied_count": len(copied),
            "skipped_count": 0,
            "failed_count": len(failed),
            "copied": copied,
            "skipped": [],
            "failed": failed
        }

    if not Path(target_str).exists():
        raise HTTPException(status_code=400, detail="指定的手錶資料夾不存在")

    watch_dir = Path(target_str)
    
    with get_db() as conn:
        placeholders = ",".join("?" * len(req.track_ids))
        cur = conn.execute(f"SELECT * FROM tracks WHERE id IN ({placeholders})", (*req.track_ids,))
        tracks = cur.fetchall()

    if not tracks:
        raise HTTPException(status_code=400, detail="未選取任何有效歌曲")

    copied = []
    skipped = []
    failed = []
    folders_affected = set()

    for t in tracks:
        src_file = MUSIC_DIR / t["rel_path"]
        if not src_file.exists():
            failed.append({"title": t["title"], "reason": "電腦上原始檔案遺失"})
            continue
            
        folder_name = t["folder"] if t["folder"] else "音樂"
        folders_affected.add(folder_name)
        dest_folder = watch_dir / folder_name
        dest_folder.mkdir(parents=True, exist_ok=True)
        dest_file = dest_folder / src_file.name

        # 檢查是否已存在相同大小的檔案
        if dest_file.exists() and dest_file.stat().st_size == src_file.stat().st_size:
            skipped.append(t["title"])
            continue

        try:
            shutil.copy2(src_file, dest_file)
            copied.append(t["title"])
        except Exception as e:
            failed.append({"title": t["title"], "reason": str(e)})

    # 為受影響的目錄重新生成 M3U8 播放清單
    for folder_name in folders_affected:
        folder_path = watch_dir / folder_name
        m3u8_file = watch_dir / f"{folder_name}.m3u8"
        if folder_path.exists():
            mp3s = sorted(folder_path.glob("*.mp3"))
            if mp3s:
                lines = ["#EXTM3U\n"]
                for mp3 in mp3s:
                    lines.append(f"#EXTINF:-1,{mp3.stem}\n")
                    lines.append(f"{folder_name}/{mp3.name}\n")
                try:
                    with open(m3u8_file, "w", encoding="utf-8") as f:
                        f.writelines(lines)
                except Exception:
                    pass

    return {
        "status": "ok",
        "copied_count": len(copied),
        "skipped_count": len(skipped),
        "failed_count": len(failed),
        "copied": copied,
        "skipped": skipped,
        "failed": failed
    }

@app.post("/api/watch/delete")
def delete_tracks_from_watch(req: WatchDeleteRequest, current_user: str = Depends(get_current_user_from_req)):
    """從手錶中刪除選取的歌曲"""
    target_str = req.watch_path
    if not target_str:
        with get_db() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key = 'watch_mount_path'").fetchone()
            if row and row["value"]:
                target_str = row["value"]
        if not target_str:
            drives = detect_garmin_watch_drives()
            if drives:
                target_str = drives[0]["path"]

    if not target_str:
        raise HTTPException(status_code=400, detail="未設定手錶路徑")

    # MTP 刪除處理
    if target_str.startswith("mtp:\\") or target_str.startswith("mtp:/"):
        clean = target_str[5:].replace("/", "\\").strip("\\")
        parts = clean.split("\\", 1)
        dev_name = parts[0]
        sub_path = parts[1] if len(parts) > 1 else ""

        deleted = []
        for rel in req.rel_paths:
            fn = Path(rel).name
            data = call_mtp_helper("delete_file", device_name=dev_name, sub_path=sub_path, file_name=fn, timeout=10)
            if data and data.get("success"):
                deleted.append(rel)
        return {"status": "ok", "deleted": deleted}

    if not Path(target_str).exists():
        raise HTTPException(status_code=400, detail="未找到 Garmin 手錶音樂磁碟")

    watch_dir = Path(target_str)
    deleted = []
    folders_affected = set()

    for rel in req.rel_paths:
        target_file = watch_dir / rel
        if target_file.exists():
            try:
                folder_name = target_file.parent.name
                folders_affected.add(folder_name)
                target_file.unlink()
                deleted.append(rel)
            except Exception:
                pass

    # 更新或移除空的 M3U8
    for folder_name in folders_affected:
        folder_path = watch_dir / folder_name
        m3u8_file = watch_dir / f"{folder_name}.m3u8"
        if folder_path.exists():
            mp3s = list(folder_path.glob("*.mp3"))
            if not mp3s:
                # 若目錄已空，刪除目錄與 M3U8
                shutil.rmtree(folder_path, ignore_errors=True)
                if m3u8_file.exists():
                    m3u8_file.unlink()
            else:
                lines = ["#EXTM3U\n"]
                for mp3 in sorted(mp3s):
                    lines.append(f"#EXTINF:-1,{mp3.stem}\n")
                    lines.append(f"{folder_name}/{mp3.name}\n")
                with open(m3u8_file, "w", encoding="utf-8") as f:
                    f.writelines(lines)

    return {"status": "ok", "deleted_count": len(deleted), "deleted": deleted}

class CreateWatchPlaylistRequest(BaseModel):
    name: str
    rel_paths: List[str]
    watch_path: Optional[str] = None

@app.post("/api/watch/playlists")
def create_watch_playlist(req: CreateWatchPlaylistRequest, current_user: str = Depends(get_current_user_from_req)):
    """在手錶建立自訂播放清單 (.m3u8)"""
    clean_name = re.sub(r'[\\/*?:"<>|]', "", req.name).strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="清單名稱無效")

    if not req.rel_paths:
        raise HTTPException(status_code=400, detail="未選取任何歌曲")

    target_str = req.watch_path
    if not target_str:
        with get_db() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key = 'watch_mount_path'").fetchone()
            if row and row["value"]:
                target_str = row["value"]
        if not target_str:
            drives = detect_garmin_watch_drives()
            if drives:
                target_str = drives[0]["path"]

    if not target_str or not Path(target_str).exists():
        raise HTTPException(status_code=400, detail="未找到 Garmin 手錶音樂磁碟")

    watch_dir = Path(target_str)
    m3u8_file = watch_dir / f"{clean_name}.m3u8"

    lines = ["#EXTM3U\n"]
    for rel in req.rel_paths:
        clean_rel = rel.replace("\\", "/")
        stem = Path(clean_rel).stem
        lines.append(f"#EXTINF:-1,{stem}\n")
        lines.append(f"{clean_rel}\n")

    try:
        with open(m3u8_file, "w", encoding="utf-8") as f:
            f.writelines(lines)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"寫入手錶清單失敗: {str(e)}")

    return {"status": "ok", "playlist_name": clean_name}

# ----------------- Heartbeat & Auto-Shutdown Endpoint -----------------
last_heartbeat_time = asyncio.get_event_loop().time() if asyncio.get_event_loop().is_running() else 0

@app.post("/api/system/heartbeat")
def client_heartbeat():
    """前端定期發送心跳，更新最後活躍時間"""
    import time
    global last_heartbeat_time
    last_heartbeat_time = time.time()
    return {"status": "ok"}

# ----------------- Serve Frontend Static Files -----------------
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
