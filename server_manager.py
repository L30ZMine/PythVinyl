import uvicorn
import threading
import os
import json
import logging
import asyncio
import queue  # NEW: Import queue
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from audio_engine import AudioEngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("VinylServer")

class VinylServer:
    def __init__(self, app_data_path):
        self.app_data_path = app_data_path
        self.host = "127.0.0.1"
        self.port = 8000
        self.server_thread = None
        self.uvicorn_server = None
        self.is_running = False
        
        # --- NEW: Command Queue System ---
        self.command_queue = queue.Queue()
        self.worker_thread = threading.Thread(target=self._command_worker, daemon=True)
        self.worker_thread.start()

        self.audio = AudioEngine(self.app_data_path)
        self.db_local = os.path.join(self.app_data_path, "library_local.json")
        self.db_spotify = os.path.join(self.app_data_path, "library_spotify.json")
        self.library_path = os.path.join(self.app_data_path, "library.json")

        self.nav_state = { "sortMode": "RAW", "crateIndex": 0, "albumId": None, "discIndex": 0, "viewState": 0, "accentColor": "#44aa88" }
        self.state = { "playing": False, "title": "Select a Track", "artist": "Unknown Artist", "cover_path": None }
        self.track_cover_map = {}
        self.load_metadata_map()

    # --- NEW: Worker to process commands sequentially ---
    def _command_worker(self):
        while True:
            try:
                # Get command, block until available
                task = self.command_queue.get()
                action = task.get('action')
                payload = task.get('payload', {})
                
                # Execute blocking Audio Engine calls here
                if action == "PLAY":
                    self.audio.play(payload.get('file_path'), payload.get('start_time', 0))
                elif action == "STOP":
                    self.audio.stop()
                elif action == "PAUSE":
                    self.audio.pause()
                elif action == "VOLUME":
                    self.audio.set_volume(payload.get('value'))
                elif action == "SEEK":
                    self.audio.seek(payload.get('time'))
                
                # Tiny sleep to prevent CPU hogging if queue is flooded
                time.sleep(0.05)
                
                self.command_queue.task_done()
            except Exception as e:
                print(f"[Worker] Error: {e}")

    # ... (Keep load_metadata_map and _create_app same as before) ...
    def load_metadata_map(self):
        # (Paste your existing load_metadata_map here)
        for db in [self.db_local, self.db_spotify]:
            if os.path.exists(db):
                try:
                    with open(db, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    for album in data:
                        rel_path = album.get("cover_url", "").lstrip("/")
                        abs_cover_path = os.path.join(self.app_data_path, rel_path)
                        if "discs" in album:
                            for disc in album["discs"]:
                                for track in disc["tracks"]:
                                    self.track_cover_map[track["file_path"]] = abs_cover_path
                except Exception as e:
                    print(f"[Server] Error loading DB {db}: {e}")

    def _create_app(self):
        app = FastAPI()
        app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
        
        static_dir = os.path.join(self.app_data_path, "static")
        os.makedirs(static_dir, exist_ok=True)
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

        @app.get("/")
        async def root(): return RedirectResponse(url="/static/index.html")

        @app.get("/api/library")
        def get_library(filter: str = "ALL"):
            data = []
            if filter in ["ALL", "LOCAL"] and os.path.exists(self.db_local):
                with open(self.db_local, 'r') as f: data.extend(json.load(f))
            if filter in ["ALL", "SPOTIFY"] and os.path.exists(self.db_spotify):
                with open(self.db_spotify, 'r') as f: data.extend(json.load(f))
            return data

        @app.websocket("/ws")
        async def websocket_endpoint(websocket: WebSocket):
            await websocket.accept()
            
            # Initial Sync
            await websocket.send_text(json.dumps({
                "status": "sync",
                "playback": { "isPlaying": self.audio.is_playing, "track": self.state["title"], "artist": self.state["artist"] },
                "navigation": self.nav_state
            }))

            # Background Monitor (Send updates to frontend)
            async def audio_monitor():
                while True:
                    if self.audio.check_track_finished():
                        try:
                            self.state["playing"] = False
                            await websocket.send_text(json.dumps({"status": "finished"}))
                        except: break
                    await asyncio.sleep(0.5)
            
            monitor_task = asyncio.create_task(audio_monitor())

            try:
                while True:
                    data = await websocket.receive_text()
                    cmd = json.loads(data)
                    action = cmd.get("action")
                    payload = cmd.get("payload", {})

                    if action == "UPDATE_NAV":
                        self.nav_state.update(payload)
                    
                    elif action == "PLAY":
                        # Update State Immediately for UI responsiveness
                        self.state["title"] = payload.get("title", "Unknown")
                        self.state["artist"] = payload.get("artist", "")
                        self.state["cover_path"] = self.track_cover_map.get(payload.get("file_path"), None)
                        self.state["playing"] = True
                        
                        # Push to Queue
                        self.command_queue.put({"action": "PLAY", "payload": payload})
                        
                        # Ack to frontend
                        await websocket.send_text(json.dumps({
                            "status": "playing", "track": self.state["title"], "artist": self.state["artist"]
                        }))

                    elif action == "STOP":
                        self.state["playing"] = False
                        self.command_queue.put({"action": "STOP"})
                        await websocket.send_text(json.dumps({"status": "stopped"}))

                    elif action == "PAUSE":
                        self.command_queue.put({"action": "PAUSE"})
                        # Optimistic update
                        status_str = "paused" if self.audio.is_playing else "playing"
                        await websocket.send_text(json.dumps({"status": status_str}))

                    elif action in ["VOLUME", "SEEK"]:
                        # Queue these heavy operations
                        self.command_queue.put({"action": action, "payload": payload})

            except WebSocketDisconnect:
                logger.info("Frontend Disconnected")
            finally:
                monitor_task.cancel()

        return app

    def start(self):
        if self.is_running: return
        self.load_metadata_map()
        app = self._create_app()
        config = uvicorn.Config(app=app, host=self.host, port=self.port, log_level="error")
        self.uvicorn_server = uvicorn.Server(config)
        self.server_thread = threading.Thread(target=self.uvicorn_server.run)
        self.server_thread.daemon = True
        self.server_thread.start()
        self.is_running = True

    def stop(self):
        if self.is_running and self.uvicorn_server:
            self.audio.stop()
            self.uvicorn_server.should_exit = True
            self.server_thread.join()
            self.is_running = False