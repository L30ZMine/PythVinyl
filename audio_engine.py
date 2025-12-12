import pygame
import threading
import logging
import os
import time
from spotify_handler import SpotifyHandler

class AudioEngine:
    def __init__(self, app_data_path):
        # Local Audio Init
        pygame.mixer.pre_init(frequency=44100, size=-16, channels=2, buffer=2048)
        pygame.mixer.init()
        
        # Spotify Init
        self.spotify = SpotifyHandler(app_data_path)
        
        # State
        self.is_playing = False
        self._lock = threading.Lock()
        self.volume = 0.5
        self.mode = "LOCAL" # LOCAL or SPOTIFY
        self.current_uri = None
        
        pygame.mixer.music.set_volume(self.volume)

    def play(self, uri_or_path, start_time=0.0):
        with self._lock:
            self.stop(internal=True) # Stop whatever was playing before
            
            # Check if this is a Spotify URI
            if "spotify:track" in str(uri_or_path):
                self.mode = "SPOTIFY"
                self.current_uri = uri_or_path
                print(f"[AudioEngine] Switching to SPOTIFY mode: {uri_or_path}")
                # Ensure we are authenticated
                if not self.spotify.sp: self.spotify.authenticate()
                self.spotify.play_track(uri_or_path, position_ms=start_time*1000)
                self.is_playing = True
            
            else:
                self.mode = "LOCAL"
                self.current_uri = uri_or_path
                if not os.path.exists(uri_or_path):
                    print(f"[AudioEngine] ERROR: File not found: {uri_or_path}")
                    return

                print(f"[AudioEngine] Switching to LOCAL mode: {os.path.basename(uri_or_path)}")
                try:
                    pygame.mixer.music.load(uri_or_path)
                    pygame.mixer.music.play(loops=0, start=start_time)
                    self.is_playing = True
                except Exception as e:
                    print(f"[AudioEngine] Local Play Error: {e}")
                    self.is_playing = False

    def stop(self, internal=False):
        """Stops playback on current mode"""
        if self.mode == "LOCAL":
            pygame.mixer.music.stop()
        elif self.mode == "SPOTIFY":
            self.spotify.pause()
        
        if not internal:
            with self._lock:
                self.is_playing = False
                self.current_uri = None
            print("[AudioEngine] Stopped.")

    def pause(self):
        if self.is_playing:
            if self.mode == "LOCAL": pygame.mixer.music.pause()
            else: self.spotify.pause()
            self.is_playing = False
            print("[AudioEngine] Paused.")
        else:
            if self.mode == "LOCAL": pygame.mixer.music.unpause()
            else: self.spotify.resume()
            self.is_playing = True
            print("[AudioEngine] Resumed.")

    def set_volume(self, val):
        self.volume = float(val)
        if self.mode == "LOCAL":
            pygame.mixer.music.set_volume(self.volume)
        else:
            # Spotify API takes 0-100
            self.spotify.set_volume(self.volume * 100)

    def seek(self, timestamp):
        if not self.current_uri: return
        if self.mode == "LOCAL":
            self.play(self.current_uri, start_time=timestamp)
        else:
            self.spotify.seek(timestamp * 1000)

    def check_track_finished(self):
        """Robust check for end-of-track."""
        if not self.is_playing: return False

        if self.mode == "LOCAL":
            if not pygame.mixer.music.get_busy():
                print("[AudioEngine] Local track finished.")
                self.is_playing = False
                return True
                
        elif self.mode == "SPOTIFY":
            status = self.spotify.get_status()
            if status:
                if not status['is_playing'] and status['progress_ms'] == 0:
                     print("[AudioEngine] Spotify track finished.")
                     self.is_playing = False
                     return True
                
                # Check if we are extremely close to the end (within 1.5s)
                # This helps trigger the 'finish' signal slightly earlier to prevent silence gaps
                remaining = status['duration_ms'] - status['progress_ms']
                if remaining < 1500 and remaining > 0:
                    pass 

        return False

    # --- NEW METHOD FOR UI ---
    def get_playback_info(self):
        """Returns dict with progress, duration (seconds), and playing status"""
        info = {
            "is_playing": self.is_playing,
            "progress": 0,
            "duration": 180, # Default 3 mins if unknown
            "volume": self.volume
        }

        if self.mode == "SPOTIFY":
            status = self.spotify.get_status()
            if status:
                info["is_playing"] = status['is_playing']
                info["progress"] = status['progress_ms'] / 1000
                info["duration"] = status['duration_ms'] / 1000
        
        elif self.mode == "LOCAL":
            if pygame.mixer.music.get_busy():
                # Pygame get_pos() returns ms played since start
                info["progress"] = pygame.mixer.music.get_pos() / 1000
                # Note: Local duration is hard to get from mixer directly without reloading metadata
                # For now we rely on the default or what the UI cached
                pass

        return info