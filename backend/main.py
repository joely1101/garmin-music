import os
import sys
import uuid
import hashlib
import sqlite3
import shutil
import re
import asyncio
import base64
import json
import urllib.request
import urllib.parse
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

# 資料庫路徑相容性 (優先使用 DATA_DIR，若原本在 BASE_DIR 則向下相容)
DB_PATH = DATA_DIR / "music.db" if (DATA_DIR / "music.db").exists() else (BASE_DIR / "music.db" if (BASE_DIR / "music.db").exists() else DATA_DIR / "music.db")

# ----------------- Database Setup -----------------
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
    """依據 Authorization: Bearer <token> 或 ?token=... 取得當前使用者"""
    raw_token = token
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization[7:].strip()
    
    if not raw_token:
        raise HTTPException(status_code=401, detail="Missing authentication token")
    username = verify_web_token(raw_token)
    if not username:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return username

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
    掃描 MUSIC_DIR 底下所有使用者的 MP3 檔案至資料庫。
    結構：MUSIC_DIR / <user> / <folder> / <song.mp3>
    """
    with get_db() as conn:
        users = [r["username"] for r in conn.execute("SELECT username FROM users").fetchall()]
        if not users:
            users = ["admin"]

        existing_paths = {row["rel_path"]: (row["id"], row["user"]) for row in conn.execute("SELECT id, rel_path, user FROM tracks")}
        found_paths = set()

        for user_name in users:
            user_music_dir = MUSIC_DIR / user_name
            user_music_dir.mkdir(parents=True, exist_ok=True)

            for file in user_music_dir.rglob("*.mp3"):
                rel = file.relative_to(MUSIC_DIR).as_posix()
                found_paths.add(rel)
                
                # 計算 folder (相對於 user_music_dir)
                folder_rel = file.parent.relative_to(user_music_dir).as_posix()
                folder = "" if folder_rel == "." else folder_rel

                if rel not in existing_paths:
                    meta = get_audio_metadata(file)
                    track_id = str(uuid.uuid4())
                    conn.execute("""
                        INSERT INTO tracks (id, title, artist, album, duration, bitrate, size, rel_path, folder, sync_enabled, user)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                    """, (track_id, meta["title"], meta["artist"], meta["album"], meta["duration"], meta["bitrate"], meta["size"], rel, folder, user_name))

        # Cleanup deleted files
        for rel, (tid, _) in existing_paths.items():
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
    with get_db() as conn:
        track = conn.execute("SELECT * FROM tracks WHERE id = ? AND user = ?", (id, user)).fetchone()
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

@app.get("/api/tracks/{id}/stream")
def web_stream_track(id: str, token: Optional[str] = Query(None)):
    username = verify_web_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid or missing token")
    with get_db() as conn:
        # Admin 可以播放全部歌曲，一般用戶僅可播放自己的歌曲
        user_row = conn.execute("SELECT role FROM users WHERE username = ?", (username,)).fetchone()
        is_admin = user_row and user_row["role"] == "admin"
        
        if is_admin:
            track = conn.execute("SELECT * FROM tracks WHERE id = ?", (id,)).fetchone()
        else:
            track = conn.execute("SELECT * FROM tracks WHERE id = ? AND user = ?", (id, username)).fetchone()

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

# ----------------- User Folders & Tracks API (完全隔離) -----------------
@app.get("/api/folders")
def list_folders(current_user: str = Depends(get_current_user_from_req)):
    user_music_dir = MUSIC_DIR / current_user
    user_music_dir.mkdir(parents=True, exist_ok=True)
    folders = []
    for item in user_music_dir.iterdir():
        if item.is_dir():
            folders.append(item.name)
    return sorted(folders)

@app.post("/api/folders")
def create_folder(folder_name: str = Query(...), current_user: str = Depends(get_current_user_from_req)):
    clean_folder = re.sub(r'[\\/*?:"<>|]', "", folder_name).strip()
    if not clean_folder:
        raise HTTPException(status_code=400, detail="Invalid folder name")
    target_dir = MUSIC_DIR / current_user / clean_folder
    target_dir.mkdir(parents=True, exist_ok=True)
    return {"status": "ok", "folder": clean_folder}

@app.delete("/api/folders/{folder_name}")
def delete_folder(folder_name: str, current_user: str = Depends(get_current_user_from_req)):
    clean_folder = re.sub(r'[\\/*?:"<>|]', "", folder_name).strip()
    if not clean_folder:
        raise HTTPException(status_code=400, detail="Invalid folder name")
    
    with get_db() as conn:
        # 查詢此使用者此目錄下的所有歌曲，準備清理磁碟與資料庫
        rows = conn.execute("SELECT id, rel_path FROM tracks WHERE user = ? AND folder = ?", (current_user, clean_folder)).fetchall()
        for r in rows:
            file_path = MUSIC_DIR / r["rel_path"]
            if file_path.exists():
                try:
                    file_path.unlink()
                except Exception:
                    pass
        conn.execute("DELETE FROM tracks WHERE user = ? AND folder = ?", (current_user, clean_folder))
        conn.commit()

    # 刪除實體目錄及其內殘留檔案
    target_dir = MUSIC_DIR / current_user / clean_folder
    if target_dir.exists():
        shutil.rmtree(target_dir, ignore_errors=True)

    return {"status": "ok", "deleted_folder": clean_folder}

@app.get("/api/tracks")
def list_tracks(folder: Optional[str] = None, current_user: str = Depends(get_current_user_from_req)):
    with get_db() as conn:
        if folder:
            cur = conn.execute("SELECT * FROM tracks WHERE user = ? AND folder = ? ORDER BY title ASC", (current_user, folder))
        else:
            cur = conn.execute("SELECT * FROM tracks WHERE user = ? ORDER BY folder ASC, title ASC", (current_user,))
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

@app.delete("/api/tracks/{track_id}")
def delete_track(track_id: str, current_user: str = Depends(get_current_user_from_req)):
    with get_db() as conn:
        cur = conn.execute("SELECT rel_path, user FROM tracks WHERE id = ?", (track_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Track not found")
        
        # 僅允許刪除自己名下的歌曲 (除非是 admin)
        user_row = conn.execute("SELECT role FROM users WHERE username = ?", (current_user,)).fetchone()
        is_admin = user_row and user_row["role"] == "admin"
        if row["user"] != current_user and not is_admin:
            raise HTTPException(status_code=403, detail="無權刪除此曲目")
        
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
async def upload_mp3(folder: str = Form("音樂"), file: UploadFile = File(...), current_user: str = Depends(get_current_user_from_req)):
    if not file.filename.lower().endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only .mp3 files are allowed")
    
    clean_folder = re.sub(r'[\\/*?:"<>|]', "", folder).strip()
    if not clean_folder:
        clean_folder = "音樂"
        
    target_folder = MUSIC_DIR / current_user / clean_folder
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        """, (track_id, meta["title"], meta["artist"], meta["album"], meta["duration"], meta["bitrate"], meta["size"], rel_path, clean_folder, current_user))
        conn.commit()
        
    return {"status": "success", "track": {"id": track_id, **meta, "rel_path": rel_path, "folder": clean_folder, "user": current_user}}

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
    
    target_dir = MUSIC_DIR / current_user / target_folder
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

# ----------------- Serve Frontend Static Files -----------------
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
