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
import webbrowser
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

def find_available_port(start_port: int = 28888) -> int:
    """Find an available TCP port for the local server."""
    port = start_port
    while port < start_port + 100:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
        port += 1
    return start_port

def wait_for_server(port: int, timeout: float = 15.0) -> bool:
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
        # Use log_config=None to prevent uvicorn trying to format null console output
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
    """Open the UI in user's default browser or edge app mode and return process if launched."""
    # Attempt to launch Edge in clean standalone App-Mode window
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    ]
    for edge in edge_paths:
        if os.path.exists(edge):
            try:
                import subprocess
                proc = subprocess.Popen([edge, f"--app={url}", "--window-size=1280,820"])
                return proc
            except Exception:
                pass

    # Fallback to default browser
    webbrowser.open(url)
    return None

def main():
    port = find_available_port(28888)
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

    # Automatically launch UI window
    ui_proc = open_ui(server_url)

    # Monitor heartbeat: auto exit when browser window is closed (no heartbeats for 8 seconds)
    # Give user 20 seconds grace period on initial launch
    grace_period_end = time.time() + 20.0
    try:
        while True:
            time.sleep(2)
            now = time.time()
            if now > grace_period_end:
                # If no heartbeat received from the frontend for over 8 seconds, exit
                if now - bmain.last_heartbeat_time > 8.0:
                    break
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        sys.exit(0)

if __name__ == "__main__":
    main()
