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
    """Open the UI in user's default browser or edge app mode."""
    # Attempt to launch Edge in clean standalone App-Mode window
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    ]
    for edge in edge_paths:
        if os.path.exists(edge):
            try:
                import subprocess
                subprocess.Popen([edge, f"--app={url}", "--window-size=1280,820"])
                return
            except Exception:
                pass

    # Fallback to default browser
    webbrowser.open(url)

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

    # Automatically launch UI window
    open_ui(server_url)

    # Keep background process alive
    try:
        while True:
            time.sleep(1)
    except (KeyboardInterrupt, SystemExit):
        sys.exit(0)

if __name__ == "__main__":
    main()
