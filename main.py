import customtkinter as ctk
import os
import threading
import webbrowser
from tkinter import filedialog
from datetime import datetime
from PIL import Image

# Import our modules
from scanner import Config, LibraryScanner
from server_manager import VinylServer

# UI Settings
ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

class VinylApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("Vinyl Stack Helper")
        self.geometry("600x650") # Increased height for player panel
        
        # State Variables
        self.music_dir = ctk.StringVar(value="Select folder to Rescan")
        self.app_data_dir = os.path.abspath("./app_data")
        self.library_path = os.path.join(self.app_data_dir, "library.json")
        
        # Cache for current cover to prevent reloading same image
        self.current_cover_path = None
        self.placeholder_img = None
        
        # Initialize Backend Components
        self.server = VinylServer(self.app_data_dir)
        
        # Layout
        self._create_widgets()
        
        # Check for existing scan immediately on startup
        self._check_existing_library()
        
        # Start UI Polling Loop
        self.after(1000, self._update_player_ui)

    def _create_widgets(self):
        # --- Title ---
        self.lbl_title = ctk.CTkLabel(self, text="Vinyl Visualizer Stack", font=("Roboto", 24, "bold"))
        self.lbl_title.pack(pady=20)

        # --- Section 1: Library Status & Scanning ---
        self.frame_scan = ctk.CTkFrame(self)
        self.frame_scan.pack(pady=10, padx=20, fill="x")

        self.lbl_scan_header = ctk.CTkLabel(self.frame_scan, text="1. Library Management", font=("Roboto", 16, "bold"))
        self.lbl_scan_header.pack(pady=5)
        
        self.lbl_lib_status = ctk.CTkLabel(self.frame_scan, text="Checking...", text_color="gray")
        self.lbl_lib_status.pack(pady=5)

        self.btn_select = ctk.CTkButton(self.frame_scan, text="Select Music Directory", command=self.select_directory)
        self.btn_select.pack(pady=5)

        self.lbl_dir = ctk.CTkLabel(self.frame_scan, textvariable=self.music_dir, text_color="gray", font=("Arial", 10))
        self.lbl_dir.pack(pady=2)

        self.btn_scan = ctk.CTkButton(self.frame_scan, text="Start New Scan", command=self.run_scan, state="disabled", fg_color="green")
        self.btn_scan.pack(pady=10)

        # --- Section 2: Server ---
        self.frame_server = ctk.CTkFrame(self)
        self.frame_server.pack(pady=10, padx=20, fill="x")

        self.lbl_server_header = ctk.CTkLabel(self.frame_server, text="2. Web Server", font=("Roboto", 16, "bold"))
        self.lbl_server_header.pack(pady=5)

        self.btn_start_server = ctk.CTkButton(self.frame_server, text="Start Server", command=self.toggle_server, state="disabled")
        self.btn_start_server.pack(pady=5)

        self.btn_open_browser = ctk.CTkButton(self.frame_server, text="Open in Browser", command=self.open_browser, state="disabled", fg_color="transparent", border_width=1)
        self.btn_open_browser.pack(pady=5)
        
        self.lbl_server_status = ctk.CTkLabel(self.frame_server, text="Server Stopped", text_color="gray")
        self.lbl_server_status.pack(pady=5)

        # --- Section 3: Now Playing Panel ---
        self.frame_player = ctk.CTkFrame(self, fg_color="#1a1a1a", border_color="#333", border_width=1)
        self.frame_player.pack(pady=20, padx=20, fill="x", side="bottom")

        # Layout for player (Grid)
        self.frame_player.grid_columnconfigure(1, weight=1)

        # Cover Image Placeholder
        self.lbl_cover = ctk.CTkLabel(self.frame_player, text="[No Art]", width=60, height=60, fg_color="#333")
        self.lbl_cover.grid(row=0, column=0, rowspan=2, padx=10, pady=10)

        # Labels
        self.lbl_now_playing_title = ctk.CTkLabel(self.frame_player, text="Waiting for playback...", font=("Roboto", 14, "bold"), anchor="w")
        self.lbl_now_playing_title.grid(row=0, column=1, padx=10, pady=(10, 0), sticky="sw")

        self.lbl_now_playing_artist = ctk.CTkLabel(self.frame_player, text="---", font=("Roboto", 12), text_color="gray", anchor="w")
        self.lbl_now_playing_artist.grid(row=1, column=1, padx=10, pady=(0, 10), sticky="nw")

    def _update_player_ui(self):
        """Polls the server state to update the UI."""
        state = self.server.state
        
        # Update Text
        self.lbl_now_playing_title.configure(text=state["title"])
        self.lbl_now_playing_artist.configure(text=state["artist"])

        # Update Cover Art if it changed
        new_cover = state["cover_path"]
        if new_cover and new_cover != self.current_cover_path:
            self.current_cover_path = new_cover
            if os.path.exists(new_cover):
                try:
                    pil_img = Image.open(new_cover)
                    ctk_img = ctk.CTkImage(light_image=pil_img, dark_image=pil_img, size=(60, 60))
                    self.lbl_cover.configure(image=ctk_img, text="") # Remove placeholder text
                except Exception as e:
                    print(f"Error loading cover for UI: {e}")
            else:
                self.lbl_cover.configure(image=None, text="[Err]") # File missing
        elif new_cover is None and self.current_cover_path is not None:
            # Reset
            self.current_cover_path = None
            self.lbl_cover.configure(image=None, text="[No Art]")

        # Schedule next check
        self.after(1000, self._update_player_ui)

    def _check_existing_library(self):
        """Checks if library.json exists and updates UI accordingly."""
        if os.path.exists(self.library_path):
            timestamp = os.path.getmtime(self.library_path)
            dt_object = datetime.fromtimestamp(timestamp)
            date_str = dt_object.strftime("%d.%m.%Y at %H:%M")
            
            self.lbl_lib_status.configure(text=f"✔ Found Library from: {date_str}", text_color="#44aa88")
            self.btn_start_server.configure(state="normal")
            self.btn_scan.configure(text="Rescan Library (Overwrites)")
        else:
            self.lbl_lib_status.configure(text="❌ No library found. Please scan.", text_color="orange")
            self.btn_start_server.configure(state="disabled")

    def select_directory(self):
        path = filedialog.askdirectory()
        if path:
            self.music_dir.set(path)
            self.btn_scan.configure(state="normal")

    def run_scan(self):
        path = self.music_dir.get()
        if not os.path.exists(path): return

        self.btn_scan.configure(state="disabled")
        self.lbl_lib_status.configure(text="Scanning... (Please Wait)", text_color="white")
        
        thread = threading.Thread(target=self._scan_process, args=(path,))
        thread.start()

    def _scan_process(self, path):
        try:
            config = Config(path, self.app_data_dir)
            scanner = LibraryScanner(config)
            scanner.run()
            self.after(0, self._on_scan_complete)
        except Exception as e:
            print(f"Error: {e}")
            self.lbl_lib_status.configure(text=f"Error: {e}")

    def _on_scan_complete(self):
        self.btn_scan.configure(state="normal")
        self._check_existing_library()
        # Reload server map in case it was running
        if self.server.is_running:
            self.server.load_metadata_map()

    def toggle_server(self):
        if not self.server.is_running:
            try:
                self.server.start()
                self.btn_start_server.configure(text="Stop Server", fg_color="red", hover_color="darkred")
                self.btn_open_browser.configure(state="normal")
                self.lbl_server_status.configure(text="Server Running on Port 8000", text_color="#44aa88")
            except Exception as e:
                self.lbl_server_status.configure(text=f"Server Error: {e}")
        else:
            self.server.stop()
            self.btn_start_server.configure(text="Start Server", fg_color="#1f538d", hover_color="#14375e")
            self.btn_open_browser.configure(state="disabled")
            self.lbl_server_status.configure(text="Server Stopped", text_color="gray")

    def open_browser(self):
        webbrowser.open("http://127.0.0.1:8000/")

if __name__ == "__main__":
    app = VinylApp()
    app.mainloop()