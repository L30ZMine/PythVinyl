import os
import json
import hashlib
import logging
from pathlib import Path
from typing import Dict

import mutagen
from mutagen.id3 import ID3, APIC
from mutagen.flac import FLAC
from mutagen.mp3 import MP3
from PIL import Image
import io

from spotify_handler import SpotifyHandler # Add this import

class Config:
    def __init__(self, music_dir: str, output_base_dir: str):
        self.MUSIC_DIR = Path(music_dir)
        self.OUTPUT_BASE = Path(output_base_dir)
        self.COVERS_DIR = self.OUTPUT_BASE / "static" / "covers"
        self.DB_LOCAL = self.OUTPUT_BASE / "library_local.json"
        self.DB_SPOTIFY = self.OUTPUT_BASE / "library_spotify.json"
        
        self.AUDIO_EXT = {'.mp3', '.flac'}
        self.IMAGE_EXT = {'.jpg', '.jpeg', '.png'}
        self.COVER_SIZE = (512, 512)
        self.COVERS_DIR.mkdir(parents=True, exist_ok=True)

class ImageUtils:
    @staticmethod
    def save_image(image_data: bytes, output_path: Path, size: tuple) -> bool:
        try:
            image = Image.open(io.BytesIO(image_data))
            if image.mode != "RGB":
                image = image.convert("RGB")
            image.thumbnail(size)
            image.save(output_path, "PNG")
            return True
        except Exception:
            return False

    @staticmethod
    def save_file_image(source_path: Path, output_path: Path, size: tuple) -> bool:
        try:
            with open(source_path, "rb") as f:
                return ImageUtils.save_image(f.read(), output_path, size)
        except Exception:
            return False

    @staticmethod
    def get_average_color(image_path: Path) -> str:
        """Returns hex color with guaranteed minimum brightness."""
        try:
            if not image_path.exists(): return "#44aa88"
            img = Image.open(image_path)
            if img.mode != "RGB": img = img.convert("RGB")
            img = img.resize((1, 1))
            r, g, b = img.getpixel((0, 0))
            
            # Calculate Luminance
            lum = (0.299 * r + 0.587 * g + 0.114 * b)
            
            # If too dark, boost brightness
            if lum < 60:
                factor = 1.0 + ((60 - lum) / 60) * 1.5 # Boost factor
                r = min(255, int(r * factor + 40))
                g = min(255, int(g * factor + 40))
                b = min(255, int(b * factor + 40))

            return '#{:02x}{:02x}{:02x}'.format(r, g, b)
        except Exception:
            return "#44aa88"

class TagParser:
    @staticmethod
    def extract(file_path: Path) -> Dict:
        try:
            audio = mutagen.File(file_path)
            if not audio: return {}
            
            meta = {
                "title": file_path.stem,
                "artist": "Unknown Artist",
                "album": "Unknown Album",
                "duration": 0,
                "has_embedded_cover": False,
                "cover_data": None
            }

            if hasattr(audio.info, 'length'):
                meta['duration'] = audio.info.length

            if isinstance(audio, FLAC):
                if audio.get("title"): meta["title"] = audio.get("title")[0]
                if audio.get("artist"): meta["artist"] = audio.get("artist")[0]
                if audio.get("album"): meta["album"] = audio.get("album")[0]
                if audio.pictures:
                    meta["has_embedded_cover"] = True
                    meta["cover_data"] = audio.pictures[0].data

            elif isinstance(audio, MP3):
                id3 = ID3(file_path)
                meta["title"] = str(id3.get("TIT2", meta["title"]))
                meta["artist"] = str(id3.get("TPE1", meta["artist"]))
                meta["album"] = str(id3.get("TALB", meta["album"]))
                for tag in id3.values():
                    if isinstance(tag, APIC):
                        meta["has_embedded_cover"] = True
                        meta["cover_data"] = tag.data
                        break
            
            return meta
        except Exception:
            return {}

class LibraryScanner:
    def __init__(self, config: Config):
        self.cfg = config
        self.local_map = {} 
        self.spotify_map = {}
        # We pass the output base dir to spotify handler for cache storage
        self.spotify_helper = SpotifyHandler(str(config.OUTPUT_BASE))
        logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

    # ... (Keep helper methods _get_backup_cover, _clean, _fmt_time) ...
    def _get_backup_cover(self, directory: Path) -> Path:
        candidates = [f for f in directory.iterdir() if f.suffix.lower() in self.cfg.IMAGE_EXT]
        for img in candidates:
            if any(x in img.name.lower() for x in ["front", "cover", "folder"]):
                return img
        return candidates[0] if candidates else None

    def _clean(self, s):
        return str(s).strip()

    def _fmt_time(self, seconds):
        if not seconds: return "--:--"
        m = int(seconds // 60)
        s = int(seconds % 60)
        return f"{m}:{s:02d}"

    def process_file(self, file_path: Path):
        # ... (Same as original process_file logic) ...
        meta = TagParser.extract(file_path)
        if not meta: return

        artist = self._clean(meta.get("artist", "Unknown"))
        album_name = self._clean(meta.get("album", "Unknown"))
        unique_key = f"{artist}||{album_name}"

        if unique_key not in self.albums_map:
            album_hash = hashlib.md5(unique_key.encode('utf-8')).hexdigest()
            cover_filename = f"{album_hash}.png"
            output_cover_path = self.cfg.COVERS_DIR / cover_filename
            
            if not output_cover_path.exists():
                saved = False
                if meta["has_embedded_cover"] and meta["cover_data"]:
                    saved = ImageUtils.save_image(meta["cover_data"], output_cover_path, self.cfg.COVER_SIZE)
                if not saved:
                    backup = self._get_backup_cover(file_path.parent)
                    if backup: ImageUtils.save_file_image(backup, output_cover_path, self.cfg.COVER_SIZE)

            cover_url = f"/static/covers/{cover_filename}" if output_cover_path.exists() else "/static/covers/default_vinyl.png"
            accent_color = ImageUtils.get_average_color(output_cover_path)

            self.albums_map[unique_key] = {
                "id": album_hash,
                "title": album_name,
                "artist": artist,
                "cover_url": cover_url,
                "accent_color": accent_color,
                "raw_tracks": [],
                "source": "LOCAL"
            }

        self.albums_map[unique_key]["raw_tracks"].append({
            "title": meta["title"],
            "duration": meta["duration"],
            "duration_str": self._fmt_time(meta["duration"]),
            "file_path": str(file_path)
        })

    def import_spotify_album(self, spotify_url):
        """Fetches data from Spotify and adds to library map"""
        print(f"Importing Spotify Album: {spotify_url}")
        data = self.spotify_helper.get_album_metadata(spotify_url)
        if not data: return

        artist = data['artist']
        album_name = data['title']
        unique_key = f"{artist}||{album_name}"
        album_hash = hashlib.md5(unique_key.encode('utf-8')).hexdigest()
        
        # Save Cover
        cover_filename = f"{album_hash}.png"
        output_cover_path = self.cfg.COVERS_DIR / cover_filename
        ImageUtils.save_image(data['cover_data'], output_cover_path, self.cfg.COVER_SIZE)
        
        cover_url = f"/static/covers/{cover_filename}"
        accent_color = ImageUtils.get_average_color(output_cover_path)

        self.albums_map[unique_key] = {
            "id": album_hash,
            "title": album_name,
            "artist": artist,
            "cover_url": cover_url,
            "accent_color": accent_color,
            "raw_tracks": [],
            "source": "SPOTIFY"
        }

        for t in data['tracks']:
             self.albums_map[unique_key]["raw_tracks"].append({
                "title": t['title'],
                "duration": t['duration'],
                "duration_str": self._fmt_time(t['duration']),
                "file_path": t['uri'] # Save URI as file_path
            })
        print(f"Imported {album_name}")

    def run(self):
        logging.info(f"Scanning: {self.cfg.MUSIC_DIR}")
        
        # 1. Local Scan
        for root, _, files in os.walk(self.cfg.MUSIC_DIR):
            for file in files:
                if Path(file).suffix.lower() in self.cfg.AUDIO_EXT:
                    self.process_file(Path(root) / file)
        
        # 2. Re-load existing library to keep Spotify imports? 
        # For robustness, we should probably read the existing JSON first and preserve source='SPOTIFY' entries.
        if self.cfg.DB_PATH.exists():
             try:
                with open(self.cfg.DB_PATH, 'r') as f:
                    old_lib = json.load(f)
                    for album in old_lib:
                        if album.get("source") == "SPOTIFY":
                            # Re-construct unique key to avoid duplicate processing
                            key = f"{album['artist']}||{album['title']}"
                            # Reconstruct raw_tracks format from discs if necessary or just trust existing
                            # For simplicity in this example, we assume Spotify imports are added via Main.py UI one by one
                            pass
             except: pass

        # 3. Format and Save
        library_list = list(self.albums_map.values())
        library_list.sort(key=lambda x: (x['artist'].lower(), x['title'].lower()))

        for album in library_list:
            tracks = album['raw_tracks']
            # Only sort local tracks. Spotify tracks usually come in album order.
            if album.get('source', 'LOCAL') == 'LOCAL':
                tracks.sort(key=lambda x: x['title'])

            count = len(tracks)
            album['type'] = "Single" if count <= 2 else "Album"
            album['discs'] = []
            chunk_size = 8
            
            for i in range(0, count, chunk_size):
                chunk = tracks[i : i + chunk_size]
                disc_num = (i // chunk_size) + 1
                album['discs'].append({
                    "disc_number": disc_num,
                    "tracks": chunk
                })

            del album['raw_tracks']

        with open(self.cfg.DB_PATH, 'w', encoding='utf-8') as f:
            json.dump(library_list, f, indent=4)
        
        logging.info(f"Done. Database saved.")

    def _process_local_file(self, file_path: Path):
        # ... (Same logic as before, but storing into self.local_map) ...
        meta = TagParser.extract(file_path)
        if not meta: return

        artist = self._clean(meta.get("artist", "Unknown"))
        album_name = self._clean(meta.get("album", "Unknown"))
        unique_key = f"{artist}||{album_name}"

        if unique_key not in self.local_map:
            album_hash = hashlib.md5(unique_key.encode('utf-8')).hexdigest()
            cover_filename = f"local_{album_hash}.png" # Prefix to avoid collision
            output_cover_path = self.cfg.COVERS_DIR / cover_filename
            
            if not output_cover_path.exists():
                saved = False
                if meta["has_embedded_cover"] and meta["cover_data"]:
                    saved = ImageUtils.save_image(meta["cover_data"], output_cover_path, self.cfg.COVER_SIZE)
                if not saved:
                    backup = self._get_backup_cover(file_path.parent)
                    if backup: ImageUtils.save_file_image(backup, output_cover_path, self.cfg.COVER_SIZE)

            cover_url = f"/static/covers/{cover_filename}" if output_cover_path.exists() else "/static/covers/default_vinyl.png"
            accent_color = ImageUtils.get_average_color(output_cover_path)

            self.local_map[unique_key] = {
                "id": album_hash,
                "title": album_name,
                "artist": artist,
                "cover_url": cover_url,
                "accent_color": accent_color,
                "raw_tracks": [],
                "source": "LOCAL"
            }

        self.local_map[unique_key]["raw_tracks"].append({
            "title": meta["title"],
            "duration": meta["duration"],
            "duration_str": self._fmt_time(meta["duration"]),
            "file_path": str(file_path)
        })

    def run_local_scan(self):
        # FIX: Ensure MUSIC_DIR is a Path object (it might be a string from the UI)
        if isinstance(self.cfg.MUSIC_DIR, str):
            self.cfg.MUSIC_DIR = Path(self.cfg.MUSIC_DIR)

        logging.info(f"Scanning Local: {self.cfg.MUSIC_DIR}")
        self.local_map = {} # Reset
        
        if self.cfg.MUSIC_DIR.exists():
            for root, _, files in os.walk(self.cfg.MUSIC_DIR):
                for file in files:
                    if Path(file).suffix.lower() in self.cfg.AUDIO_EXT:
                        self._process_local_file(Path(root) / file)
        else:
            logging.error(f"Directory not found: {self.cfg.MUSIC_DIR}")
        
        self._save_db(self.local_map, self.cfg.DB_LOCAL, is_spotify=False)

    def sync_spotify_saved_albums(self):
        """Fetches ALL saved albums from the user's Spotify library"""
        if not self.spotify_helper.authenticate():
            print("Spotify Auth Failed")
            return

        print("Fetching Spotify Saved Albums...")
        results = self.spotify_helper.sp.current_user_saved_albums(limit=50)
        albums = results['items']
        
        while results['next']:
            results = self.spotify_helper.sp.next(results)
            albums.extend(results['items'])

        print(f"Found {len(albums)} albums on Spotify.")
        self.spotify_map = {}

        for item in albums:
            album = item['album']
            artist = album['artists'][0]['name']
            album_name = album['name']
            unique_key = f"{artist}||{album_name}"
            album_hash = hashlib.md5(unique_key.encode('utf-8')).hexdigest()

            # Cache Cover
            cover_filename = f"spot_{album_hash}.png"
            output_cover_path = self.cfg.COVERS_DIR / cover_filename
            
            # Only download if we don't have it (speeds up sync)
            if not output_cover_path.exists() and len(album['images']) > 0:
                import requests
                try:
                    cover_url_remote = album['images'][0]['url']
                    img_data = requests.get(cover_url_remote).content
                    ImageUtils.save_image(img_data, output_cover_path, self.cfg.COVER_SIZE)
                except: pass
            
            local_cover_url = f"/static/covers/{cover_filename}" if output_cover_path.exists() else "/static/covers/default_vinyl.png"
            accent_color = ImageUtils.get_average_color(output_cover_path)

            raw_tracks = []
            for t in album['tracks']['items']:
                raw_tracks.append({
                    "title": t['name'],
                    "duration": t['duration_ms'] / 1000,
                    "duration_str": self._fmt_time(t['duration_ms'] / 1000),
                    "file_path": t['uri']
                })

            self.spotify_map[unique_key] = {
                "id": album_hash,
                "title": album_name,
                "artist": artist,
                "cover_url": local_cover_url,
                "accent_color": accent_color,
                "raw_tracks": raw_tracks,
                "source": "SPOTIFY"
            }

        self._save_db(self.spotify_map, self.cfg.DB_SPOTIFY, is_spotify=True)
        print("Spotify Sync Complete.")

    def _save_db(self, map_data, path, is_spotify=False):
        library_list = list(map_data.values())
        library_list.sort(key=lambda x: (x['artist'].lower(), x['title'].lower()))

        for album in library_list:
            tracks = album['raw_tracks']
            # Spotify tracks come pre-sorted usually, local ones need sorting
            if not is_spotify:
                tracks.sort(key=lambda x: x['title'])

            count = len(tracks)
            album['type'] = "Single" if count <= 2 else "Album"
            album['discs'] = []
            chunk_size = 8
            
            for i in range(0, count, chunk_size):
                chunk = tracks[i : i + chunk_size]
                disc_num = (i // chunk_size) + 1
                album['discs'].append({
                    "disc_number": disc_num,
                    "tracks": chunk
                })
            del album['raw_tracks']

        with open(path, 'w', encoding='utf-8') as f:
            json.dump(library_list, f, indent=4)