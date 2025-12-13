import spotipy
from spotipy.oauth2 import SpotifyOAuth
import requests
import os
import time

class SpotifyHandler:
    def __init__(self, cache_path):
        # REPLACE THESE WITH YOUR CREDENTIALS!!!!!!!!!!!!!!!!!!!!
        self.client_id = "your client id"
        self.client_secret = "your client secret"
        self.redirect_uri = "http://127.0.0.1:8888/callback"
        
        self.scope = "user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read"
        self.sp = None
        self.cache_path = cache_path

    def authenticate(self):
        try:
            # Ensure cache directory exists
            os.makedirs(self.cache_path, exist_ok=True)
            
            auth_manager = SpotifyOAuth(
                client_id=self.client_id,
                client_secret=self.client_secret,
                redirect_uri=self.redirect_uri,
                scope=self.scope,
                cache_path=os.path.join(self.cache_path, ".spotify_cache"),
                open_browser=True
            )
            self.sp = spotipy.Spotify(auth_manager=auth_manager)
            print("[Spotify] Authenticated successfully.")
            return True
        except Exception as e:
            print(f"[Spotify] Auth failed: {e}")
            return False

    def _get_device_id(self):
        """Attempts to find an active device ID."""
        try:
            devices = self.sp.devices()
            if not devices or 'devices' not in devices or len(devices['devices']) == 0:
                print("[Spotify] No devices found. Please open Spotify on this machine.")
                return None
            
            # 1. Try to find a currently active device
            for d in devices['devices']:
                if d['is_active']:
                    return d['id']
            
            # 2. If none active, just grab the first one (usually this computer)
            first_device = devices['devices'][0]['id']
            print(f"[Spotify] Waking up device: {devices['devices'][0]['name']}")
            return first_device
            
        except Exception as e:
            print(f"[Spotify] Device lookup failed: {e}")
            return None

    def get_album_metadata(self, album_url):
        if not self.sp: self.authenticate()
        try:
            results = self.sp.album(album_url)
            
            # Download Cover
            cover_url = results['images'][0]['url']
            cover_data = requests.get(cover_url).content
            
            # Parse Tracks
            tracks = []
            for item in results['tracks']['items']:
                tracks.append({
                    "title": item['name'],
                    "duration": item['duration_ms'] / 1000, 
                    "uri": item['uri'],
                    "preview_url": item['preview_url']
                })
                
            return {
                "title": results['name'],
                "artist": results['artists'][0]['name'],
                "cover_data": cover_data,
                "tracks": tracks,
                "spotify_uri": results['uri']
            }
        except Exception as e:
            print(f"[Spotify] Error fetching album: {e}")
            return None

    def play_track(self, uri, position_ms=0):
        if not self.sp: return
        
        device_id = self._get_device_id()
        if not device_id:
            print("[Spotify] ERROR: cannot play, no Spotify app is open.")
            return

        try:
            # Explicitly passing device_id forces that specific app to play
            self.sp.start_playback(device_id=device_id, uris=[uri], position_ms=int(position_ms))
        except Exception as e:
            print(f"[Spotify] Play command failed: {e}")

    def pause(self):
        if not self.sp: return
        try: self.sp.pause_playback()
        except: pass

    def resume(self):
        if not self.sp: return
        try: self.sp.start_playback()
        except: pass

    def seek(self, position_ms):
        if not self.sp: return
        try: self.sp.seek_track(int(position_ms))
        except: pass
        
    def set_volume(self, volume_percent):
        if not self.sp: return
        try: self.sp.volume(int(volume_percent))
        except: pass

    def get_status(self):
        if not self.sp: return None
        try:
            current = self.sp.current_playback()
            if not current:
                return {'is_playing': False, 'progress_ms': 0, 'duration_ms': 0}
            
            return {
                'is_playing': current['is_playing'],
                'progress_ms': current['progress_ms'],
                'duration_ms': current['item']['duration_ms']
            }
        except:
            return None