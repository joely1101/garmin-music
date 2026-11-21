"""
Garmin Music Desktop - Windows Entry Point
Lightweight, rock-solid launcher that runs FastAPI locally and automatically
opens the modern UI in your default browser (or standalone app window).
"""
import os
import sys

# Critical fix for Windows PyInstaller no-console mode:
# When console=False, sys.stdout and sys.stderr are None, which causes uvicorn's
# DefaultFormatter to crash with "Unable to configure formatter 'default'".
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import time
import socket
import threading
import urllib.request
import multiprocessing
from pathlib import Path

# Required for PyInstaller frozen Windows binaries
multiprocessing.freeze_support()

# Handle PyInstaller frozen environment
if getattr(sys, 'frozen', False):
    APP_DIR = Path(sys.executable).resolve().parent
    BUNDLE_DIR = Path(sys._MEIPASS)
    # Add embedded ffmpeg directory to PATH
    bundled_ffmpeg = BUNDLE_DIR / "bin"
    if bundled_ffmpeg.exists():
        os.environ["PATH"] = str(bundled_ffmpeg) + os.pathsep + os.environ.get("PATH", "")
    os.environ["DATA_DIR"] = str(APP_DIR / "data")
    os.environ["MUSIC_DIR"] = str(APP_DIR / "music")
else:
    APP_DIR = Path(__file__).resolve().parent

import uvicorn
from backend.main import app

DEFAULT_PORT = 48888

def is_already_running(port: int = DEFAULT_PORT) -> bool:
    """Check if an instance is already alive and responding on localhost:port."""
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/system/heartbeat",
            data=b"",
            headers={"User-Agent": "GarminLauncher"}
        )
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            if resp.status == 200:
                return True
    except Exception:
        pass
    return False

def find_available_port(start_port: int = DEFAULT_PORT) -> int:
    """Find an available TCP port for the local server if default port is occupied."""
    port = start_port
    while port < start_port + 50:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
        port += 1
    return start_port

def wait_for_server(port: int, timeout: float = 20.0) -> bool:
    """Wait until the FastAPI server is responding on localhost."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) == 0:
                return True
        time.sleep(0.15)
    return False

def start_server(port: int):
    """Run uvicorn server in a background thread."""
    try:
        config = uvicorn.Config(
            app=app,
            host="127.0.0.1",
            port=port,
            log_config=None,
            loop="asyncio"
        )
        server = uvicorn.Server(config)
        server.run()
    except Exception as e:
        log_file = APP_DIR / "error_server.log"
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(f"Server crashed: {e}\n")

def open_ui(url: str):
    """Open the UI in standalone App-Mode window (Chrome, Edge) or fallback to default browser."""
    import subprocess

    app_browsers = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"),
    ]

    for browser in app_browsers:
        if os.path.exists(browser):
            try:
                subprocess.Popen([browser, f"--app={url}", "--window-size=1280,820"])
                return
            except Exception:
                pass

    try:
        if sys.platform == "win32":
            os.startfile(url)
            return
    except Exception:
        pass
    try:
        import webbrowser
        webbrowser.open(url)
    except Exception:
        pass

def main():
    # 1. Single Instance Check:
    # If the app is already running on the primary port, just open the browser and exit.
    if is_already_running(DEFAULT_PORT):
        open_ui(f"http://127.0.0.1:{DEFAULT_PORT}")
        sys.exit(0)

    # 2. Bind port (prefer DEFAULT_PORT, fallback if non-Garmin service is using it)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        is_free = (s.connect_ex(('127.0.0.1', DEFAULT_PORT)) != 0)
    
    port = DEFAULT_PORT if is_free else find_available_port(DEFAULT_PORT + 1)
    server_url = f"http://127.0.0.1:{port}"

    # Start FastAPI server in background thread
    t = threading.Thread(target=start_server, args=(port,), daemon=True)
    t.start()

    # Wait for server to become responsive
    if not wait_for_server(port):
        log_file = APP_DIR / "startup_error.log"
        with open(log_file, "w", encoding="utf-8") as f:
            f.write(f"Failed to start local server on {server_url}\n")
        sys.exit(1)

    # Initialize heartbeat time
    import backend.main as bmain
    bmain.last_heartbeat_time = time.time()

    # Automatically launch browser window
    open_ui(server_url)

    # Monitor heartbeat: auto exit after browser window has been closed.
    # - Never exit while active download or sync tasks are running.
    # - Allow 120 seconds grace period on initial launch.
    # - Allow 300 seconds (5 minutes) of silence before exiting when browser is closed.
    grace_period_end = time.time() + 120.0
    try:
        while True:
            time.sleep(2)
            now = time.time()

            # If download or sync tasks are running, continuously renew heartbeat so server NEVER terminates
            active_downloads = hasattr(bmain, "has_active_download_tasks") and bmain.has_active_download_tasks()
            active_sync = hasattr(bmain, "is_syncing_to_watch") and bmain.is_syncing_to_watch()
            if active_downloads or active_sync:
                bmain.last_heartbeat_time = now
                continue

            if now > grace_period_end:
                # If no heartbeat received from frontend for over 300 seconds and no active tasks, exit cleanly
                if now - bmain.last_heartbeat_time > 300.0:
                    break
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        sys.exit(0)

if __name__ == "__main__":
    main()
