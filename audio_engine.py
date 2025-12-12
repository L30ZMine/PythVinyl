import pygame
import threading
import logging
import os

class AudioEngine:
    def __init__(self):
        # Increased buffer size to reduce stuttering
        pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=4096)
        self.is_playing = False
        self._lock = threading.Lock()
        self.volume = 0.5
        self.current_file = None # Remember what we are playing
        pygame.mixer.music.set_volume(self.volume)

    def play(self, file_path, start_time=0.0):
        with self._lock:
            try:
                if not os.path.exists(file_path):
                    logging.error(f"File not found: {file_path}")
                    return

                if pygame.mixer.music.get_busy():
                    pygame.mixer.music.stop()
                
                print(f"AudioEngine: Loading {file_path} at {start_time}s")
                pygame.mixer.music.load(file_path)
                pygame.mixer.music.play(loops=0, start=start_time)
                
                self.current_file = file_path
                self.is_playing = True
            except Exception as e:
                logging.error(f"Audio Error: {e}")
                self.is_playing = False

    def stop(self):
        pygame.mixer.music.stop()
        self.is_playing = False
        self.current_file = None

    def pause(self):
        if self.is_playing:
            pygame.mixer.music.pause()
            self.is_playing = False
        else:
            pygame.mixer.music.unpause()
            self.is_playing = True

    def set_volume(self, val):
        self.volume = float(val)
        pygame.mixer.music.set_volume(self.volume)

    def seek(self, timestamp):
        """ 
        Robust seek: Pygame's set_pos is flaky for FLAC/WAV.
        Reliable method: Restart playback from the timestamp.
        """
        if not self.current_file:
            logging.warning("Cannot seek: No file loaded.")
            return

        print(f"Seeking to {timestamp}s")
        # We re-call play with the start offset
        self.play(self.current_file, start_time=timestamp)