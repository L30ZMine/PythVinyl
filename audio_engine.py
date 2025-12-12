import pygame
import threading
import logging
import os
import time

class AudioEngine:
    def __init__(self):
        # Increased buffer to prevent stutter
        pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=4096)
        self.is_playing = False
        self._lock = threading.Lock()
        self.volume = 0.5
        self.current_file = None
        pygame.mixer.music.set_volume(self.volume)

    def play(self, file_path, start_time=0.0):
        with self._lock:
            try:
                if not os.path.exists(file_path):
                    print(f"[AudioEngine] ERROR: File not found: {file_path}")
                    return

                # Stop existing playback
                if pygame.mixer.music.get_busy():
                    pygame.mixer.music.stop()
                
                print(f"[AudioEngine] Loading: {os.path.basename(file_path)}")
                pygame.mixer.music.load(file_path)
                pygame.mixer.music.play(loops=0, start=start_time)
                
                # Wait a tiny bit for Pygame to actually register the busy state
                time.sleep(0.1)
                
                self.current_file = file_path
                self.is_playing = True
            except Exception as e:
                print(f"[AudioEngine] Exception in play: {e}")
                self.is_playing = False

    def stop(self):
        with self._lock:
            print("[AudioEngine] Stopping playback manually.")
            pygame.mixer.music.stop()
            self.is_playing = False
            self.current_file = None

    def pause(self):
        if self.is_playing:
            pygame.mixer.music.pause()
            self.is_playing = False
            print("[AudioEngine] Paused.")
        else:
            pygame.mixer.music.unpause()
            self.is_playing = True
            print("[AudioEngine] Unpaused.")

    def set_volume(self, val):
        self.volume = float(val)
        pygame.mixer.music.set_volume(self.volume)

    def seek(self, timestamp):
        if not self.current_file: return
        self.play(self.current_file, start_time=timestamp)

    def check_track_finished(self):
        """
        Checks if playback stopped naturally.
        Returns True ONLY if we think we are playing but mixer is idle.
        """
        if self.is_playing:
            is_busy = pygame.mixer.music.get_busy()
            if not is_busy:
                print("[AudioEngine] Track finished naturally detected.")
                with self._lock:
                    self.is_playing = False
                return True
        return False