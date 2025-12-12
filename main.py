import customtkinter as ctk
import os
import threading
import webbrowser
from tkinter import filedialog
from PIL import Image # Required for Cover Art
from scanner import Config, LibraryScanner
from server_manager import VinylServer
from spotify_handler import SpotifyHandler 

ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

class VinylApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Vinyl Stack Helper")
        self.geometry("600x850") 

        self.app_data_dir = os.path.abspath("./app_data")
        os.makedirs(self.app_data_dir, exist_ok=True)
        
        self.music_dir = ctk.StringVar(value="No Local Folder Selected")
        self.server = VinylServer(self.app_data_dir)
        self.scanner = LibraryScanner(Config(self.music_dir.get(), self.app_data_dir))
        
        # --- MISSING STATE VARIABLES ---
        self.current_cover_path = None
        self.is_slider_dragging = False # Fixes the AttributeError
        self.last_vol_time = 0          # Fixes rate limiting for volume
        # -------------------------------

        self._create_layout()
        self._update_status_ui()
        self.after(1000, self._poll_player_ui)



    def _create_layout(self):
        # Header
        ctk.CTkLabel(self, text="Vinyl Visualizer Setup", font=("Roboto", 24, "bold")).pack(pady=20)

        # --- BLOCK 1: LOCAL FILES ---
        self.frame_local = ctk.CTkFrame(self)
        self.frame_local.pack(pady=5, padx=20, fill="x")
        
        ctk.CTkLabel(self.frame_local, text="1. Local Library", font=("Roboto", 14, "bold")).pack(pady=2)
        
        btn_row = ctk.CTkFrame(self.frame_local, fg_color="transparent")
        btn_row.pack(pady=2)
        ctk.CTkButton(btn_row, text="Select Folder", command=self.select_directory, width=100).pack(side="left", padx=5)
        self.btn_scan_local = ctk.CTkButton(btn_row, text="Scan Local Files", command=self.scan_local, state="disabled", width=120)
        self.btn_scan_local.pack(side="left", padx=5)
        self.lbl_local_path = ctk.CTkLabel(self.frame_local, textvariable=self.music_dir, text_color="gray", font=("Arial", 10))
        self.lbl_local_path.pack(pady=0)

        # --- BLOCK 2: SPOTIFY ---
        self.frame_spotify = ctk.CTkFrame(self)
        self.frame_spotify.pack(pady=5, padx=20, fill="x")
        
        ctk.CTkLabel(self.frame_spotify, text="2. Spotify Integration", font=("Roboto", 14, "bold")).pack(pady=2)
        
        self.btn_auth = ctk.CTkButton(self.frame_spotify, text="Connect Spotify Account", command=self.auth_spotify, fg_color="#1DB954", hover_color="#1aa34a")
        self.btn_auth.pack(pady=5)
        
        self.lbl_spotify_status = ctk.CTkLabel(self.frame_spotify, text="Not Connected", text_color="gray", font=("Arial", 10))
        self.lbl_spotify_status.pack(pady=0)

        # Sync Options (Initially hidden or just empty frame)
        self.frame_sync_opts = ctk.CTkFrame(self.frame_spotify, fg_color="transparent")
        self.btn_sync_albums = ctk.CTkButton(self.frame_sync_opts, text="Sync Saved Albums", command=self.sync_spotify_albums)
        self.btn_sync_albums.pack(pady=2)

        # --- BLOCK 3: SERVER ---
        self.frame_server = ctk.CTkFrame(self)
        self.frame_server.pack(pady=5, padx=20, fill="x")
        ctk.CTkLabel(self.frame_server, text="3. Web Server", font=("Roboto", 14, "bold")).pack(pady=2)
        
        srv_row = ctk.CTkFrame(self.frame_server, fg_color="transparent")
        srv_row.pack(pady=2)
        self.btn_server = ctk.CTkButton(srv_row, text="Start Server", command=self.toggle_server, width=100)
        self.btn_server.pack(side="left", padx=5)
        self.btn_browser = ctk.CTkButton(srv_row, text="Open Browser", command=lambda: webbrowser.open("http://127.0.0.1:8000"), state="disabled", fg_color="transparent", border_width=1, width=100)
        self.btn_browser.pack(side="left", padx=5)
        self.lbl_server_status = ctk.CTkLabel(self.frame_server, text="Stopped", text_color="gray", font=("Arial", 10))
        self.lbl_server_status.pack(pady=0)

        # --- BLOCK 4: PREVIEW & CONTROLS ---
        self.frame_controls = ctk.CTkFrame(self, fg_color="#1a1a1a", border_color="#333", border_width=2)
        self.frame_controls.pack(pady=20, padx=20, fill="x", side="bottom")

        # Grid Layout
        self.frame_controls.grid_columnconfigure(1, weight=1)

        # 1. Cover Art (Row 0-2, Col 0)
        self.lbl_cover = ctk.CTkLabel(self.frame_controls, text="", width=100, height=100, fg_color="#000")
        self.lbl_cover.grid(row=0, column=0, rowspan=3, padx=10, pady=10)

        # 2. Metadata (Row 0, Col 1)
        self.lbl_track_title = ctk.CTkLabel(self.frame_controls, text="Waiting for playback...", font=("Roboto", 16, "bold"), anchor="w")
        self.lbl_track_title.grid(row=0, column=1, sticky="sw", padx=10, pady=(10,0))
        
        self.lbl_track_artist = ctk.CTkLabel(self.frame_controls, text="--", font=("Roboto", 12), text_color="gray", anchor="w")
        self.lbl_track_artist.grid(row=1, column=1, sticky="nw", padx=10)

        # 3. Timeline (Row 2, Col 1)
        self.frame_timeline = ctk.CTkFrame(self.frame_controls, fg_color="transparent")
        self.frame_timeline.grid(row=2, column=1, sticky="ew", padx=10)
        
        self.lbl_time_curr = ctk.CTkLabel(self.frame_timeline, text="0:00", font=("Arial", 10), width=30)
        self.lbl_time_curr.pack(side="left")
        
        # We disable slider interaction for now as syncing seeks across threads/apis is complex
        self.slider_progress = ctk.CTkSlider(self.frame_timeline, from_=0, to=100, number_of_steps=100, state="disabled")
        self.slider_progress.pack(side="left", fill="x", expand=True, padx=5)
        self.slider_progress.set(0)
        
        self.lbl_time_total = ctk.CTkLabel(self.frame_timeline, text="0:00", font=("Arial", 10), width=30)
        self.lbl_time_total.pack(side="left")

        # 4. Controls (Row 3, Spanning)
        self.frame_btns = ctk.CTkFrame(self.frame_controls, fg_color="transparent")
        self.frame_btns.grid(row=3, column=0, columnspan=2, sticky="ew", padx=10, pady=(0,10))
        
        self.btn_play_pause = ctk.CTkButton(self.frame_btns, text="⏯", width=40, command=self.toggle_playback)
        self.btn_play_pause.pack(side="left", padx=5)

        ctk.CTkLabel(self.frame_btns, text="Vol", font=("Arial", 10)).pack(side="left", padx=(10,2))
        self.slider_volume = ctk.CTkSlider(self.frame_btns, from_=0, to=1, width=150, command=self.set_volume)
        self.slider_volume.set(0.5)
        self.slider_volume.pack(side="left")

    def toggle_playback(self):
        threading.Thread(target=self.server.audio.pause).start()

    def set_volume(self, val):
        import time
        now = time.time()
        # Rate limit to 10 updates per second (0.1s delay)
        if now - getattr(self, 'last_vol_time', 0) > 0.1:
            self.last_vol_time = now
            # Send to queue (non-blocking) via server thread
            self.server.command_queue.put({"action": "VOLUME", "payload": {"value": val}})

    def _format_time(self, seconds):
        if not seconds or seconds < 0: return "0:00"
        m = int(seconds // 60)
        s = int(seconds % 60)
        return f"{m}:{s:02d}"

    def _poll_player_ui(self):
        def _background_fetch():
            try:
                # 1. Get info (Blocking Network Call)
                info = self.server.audio.get_playback_info()
                
                # 2. Schedule UI update on main thread
                self.after(0, lambda: self._update_ui_elements(info))
            except Exception:
                pass
            finally:
                # 3. Schedule next poll
                self.after(1000, self._poll_player_ui)

        threading.Thread(target=_background_fetch, daemon=True).start()

    def _update_ui_elements(self, info):
        # Update text
        self.lbl_track_title.configure(text=self.server.state["title"])
        self.lbl_track_artist.configure(text=self.server.state["artist"])
        
        # Update Cover
        cover_path = self.server.state["cover_path"]
        if cover_path and cover_path != self.current_cover_path:
            self.current_cover_path = cover_path
            if os.path.exists(cover_path):
                try:
                    pil_img = Image.open(cover_path)
                    ctk_img = ctk.CTkImage(light_image=pil_img, dark_image=pil_img, size=(100, 100))
                    self.lbl_cover.configure(image=ctk_img, text="")
                except: pass
        
        # Update Time & Slider
        curr = info["progress"]
        dur = info["duration"]
        
        self.lbl_time_curr.configure(text=self._format_time(curr))
        self.lbl_time_total.configure(text=self._format_time(dur))
        
        # Don't update slider if user is currently interacting with it (avoid fighting)
        if dur > 0 and not self.is_slider_dragging:
            pct = curr / dur
            self.slider_progress.set(pct * 100)
            
        self.btn_play_pause.configure(text="⏸" if info["is_playing"] else "▶")
    # --- ACTION HANDLERS ---
    def select_directory(self):
        path = filedialog.askdirectory()
        if path:
            self.music_dir.set(path)
            self.btn_scan_local.configure(state="normal")
            self.scanner.cfg.MUSIC_DIR = path

    def scan_local(self):
        self.btn_scan_local.configure(state="disabled", text="Scanning...")
        def _task():
            self.scanner.run_local_scan()
            self.after(0, lambda: self.btn_scan_local.configure(state="normal", text="Scan Local Files"))
            self.after(0, self._update_status_ui)
        threading.Thread(target=_task).start()

    def auth_spotify(self):
        def _task():
            success = self.scanner.spotify_helper.authenticate()
            self.after(0, lambda: self._on_auth_result(success))
        threading.Thread(target=_task).start()

    def _on_auth_result(self, success):
        if success:
            self.lbl_spotify_status.configure(text="✔ Connected", text_color="#1DB954")
            self.btn_auth.pack_forget()
            self.frame_sync_opts.pack(pady=2, fill="x")
        else:
            self.lbl_spotify_status.configure(text="❌ Auth Failed", text_color="red")

    def sync_spotify_albums(self):
        self.btn_sync_albums.configure(state="disabled", text="Syncing... (Takes time)")
        def _task():
            self.scanner.sync_spotify_saved_albums()
            self.after(0, lambda: self.btn_sync_albums.configure(state="normal", text="Saved Albums"))
            self.after(0, self._update_status_ui)
        threading.Thread(target=_task).start()

    def _update_status_ui(self):
        has_local = os.path.exists(self.scanner.cfg.DB_LOCAL)
        has_spot = os.path.exists(self.scanner.cfg.DB_SPOTIFY)
        status = []
        if has_local: status.append("Local ✔")
        if has_spot: status.append("Spotify ✔")
        self.lbl_server_status.configure(text="Libs: " + ", ".join(status) if status else "No libraries")

    def toggle_server(self):
        if not self.server.is_running:
            self.server.start()
            self.btn_server.configure(text="Stop Server", fg_color="red", hover_color="darkred")
            self.btn_browser.configure(state="normal")
            self.lbl_server_status.configure(text="Running :8000", text_color="green")
        else:
            self.server.stop()
            self.btn_server.configure(text="Start Server", fg_color="#1f538d", hover_color="#14375e")
            self.btn_browser.configure(state="disabled")
            self.lbl_server_status.configure(text="Stopped", text_color="gray")

if __name__ == "__main__":
    app = VinylApp()
    app.mainloop()