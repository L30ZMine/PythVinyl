import uvicorn
import threading
import os
import json
import logging
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from audio_engine import AudioEngine

# Setup Logging
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
        self.audio = AudioEngine()
        self.config_path = os.path.join(app_data_path, "debug_config.json")
        self.library_path = os.path.join(self.app_data_path, "library.json")
        
        # PERSISTENT NAVIGATION STATE
        self.nav_state = {
            "sortMode": "RAW",
            "crateIndex": 0,
            "albumId": None,
            "discIndex": 0,
            "viewState": 0, 
            "accentColor": "#44aa88" 
        }
        
        self.track_cover_map = {} 
        self.load_metadata_map()

        # Shared State
        self.state = {
            "playing": False,
            "title": "Select a Track",
            "artist": "Unknown Artist",
            "cover_path": None
        }
        
        # Lookup Cache
        self.track_cover_map = {} 
        self.load_metadata_map()

    def load_metadata_map(self):
        if not os.path.exists(self.library_path): return
        try:
            with open(self.library_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            for album in data:
                rel_path = album.get("cover_url", "").lstrip("/")
                abs_cover_path = os.path.join(self.app_data_path, rel_path)
                if "discs" in album:
                    for disc in album["discs"]:
                        for track in disc["tracks"]:
                            self.track_cover_map[track["file_path"]] = abs_cover_path
        except Exception as e:
            print(f"[Server] Map Build Error: {e}")

    def _create_app(self):
        app = FastAPI()
        
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )

        static_dir = os.path.join(self.app_data_path, "static")
        os.makedirs(static_dir, exist_ok=True)
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

        @app.get("/")
        async def root():
            return RedirectResponse(url="/static/index.html")

        @app.get("/api/library")
        def get_library():
            if os.path.exists(self.library_path):
                with open(self.library_path, 'r') as f: return json.load(f)
            return []

        @app.get("/api/config")
        def get_config():
            if os.path.exists(self.config_path):
                with open(self.config_path, 'r') as f: return json.load(f)
            return {}

        @app.websocket("/ws")
        async def websocket_endpoint(websocket: WebSocket):
            await websocket.accept()
            logger.info("Frontend Connected")
            
            # SEND FULL SYNC ON CONNECT
            await websocket.send_text(json.dumps({
                "status": "sync",
                "playback": {
                    "isPlaying": self.audio.is_playing,
                    "track": self.state["title"],
                    "artist": self.state["artist"]
                },
                "navigation": self.nav_state
            }))

            # Background task to check for track finish
            async def audio_monitor():
                while True:
                    if self.audio.check_track_finished():
                        try:
                            # Notify client that track finished naturally
                            await websocket.send_text(json.dumps({"status": "finished"}))
                        except Exception:
                            break # Connection lost
                    await asyncio.sleep(0.5)

            monitor_task = asyncio.create_task(audio_monitor())

            try:
                while True:
                    data = await websocket.receive_text()
                    cmd = json.loads(data)
                    action = cmd.get("action")
                    payload = cmd.get("payload")

                    # UPDATE Navigation State from Client
                    if action == "UPDATE_NAV":
                        self.nav_state.update(payload)

                    if action == "PLAY":
                        if payload and "file_path" in payload:
                            fpath = payload["file_path"]
                            try:
                                self.audio.play(fpath, start_time=payload.get("start_time", 0))
                                self.state["playing"] = True
                                self.state["title"] = payload.get("title", "Unknown")
                                self.state["artist"] = payload.get("artist", "")
                                self.state["cover_path"] = self.track_cover_map.get(fpath, None)

                                await websocket.send_text(json.dumps({
                                    "status": "playing", 
                                    "track": self.state["title"],
                                    "artist": self.state["artist"]
                                }))
                            except Exception as e:
                                logger.error(f"Play Error: {e}")
                    
                    elif action == "STOP":
                        self.audio.stop()
                        self.state["playing"] = False
                        await websocket.send_text(json.dumps({"status": "stopped"}))
                    
                    elif action == "PAUSE":
                        self.audio.pause()
                        await websocket.send_text(json.dumps({"status": "paused"}))
                    
                    elif action == "VOLUME":
                        self.audio.set_volume(payload.get("value", 0.5))

                    elif action == "SEEK":
                        self.audio.seek(payload.get("time", 0))

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