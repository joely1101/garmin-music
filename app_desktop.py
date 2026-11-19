"""
Garmin Music Desktop - Windows Entry Point
This script launches the local backend server and opens either a native desktop window
or the default browser, fully self-contained for machines without Python installed.
"""
import os
import sys
import time
import socket
import threading
import webbrowser
from pathlib import Path

# Handle PyInstaller frozen environment
if getattr(sys, 'frozen', False):
    APP_DIR = Path(sys.executable).resolve().parent
    # Add embedded ffmpeg directory to PATH if present
    bundled_ffmpeg = Path(sys._MEIPASS) / "bin"
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

def wait_for_server(port: int, timeout: float = 10.0) -> bool:
    """Wait until the FastAPI server is responding on localhost."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) == 0:
                return True
        time.sleep(0.1)
    return False

def start_server(port: int):
    """Run uvicorn server in a background thread."""
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

def main():
    port = find_available_port(28888)
    server_url = f"http://127.0.0.1:{port}"

    # Start FastAPI server in background thread
    t = threading.Thread(target=start_server, args=(port,), daemon=True)
    t.start()

    # Wait for server to become responsive
    if not wait_for_server(port):
        print(f"Server failed to start on {server_url}")
        sys.exit(1)

    print(f"Garmin Music Studio running at {server_url}")

    # Try launching native WebView window; fallback to system browser
    launched_window = False
    try:
        import webview
        # Create a native 1200x800 desktop window
        window = webview.create_window(
            title="Garmin Music Studio",
            url=server_url,
            width=1280,
            height=820,
            min_size=(960, 640)
        )
        launched_window = True
        webview.start()
    except Exception as e:
        print(f"Native window unavailable ({e}), opening default web browser...")
        webbrowser.open(server_url)

    if not launched_window:
        # Keep process alive if using system browser
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass

if __name__ == "__main__":
    main()
