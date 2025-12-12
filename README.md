# PythVinyl 🎵

**PythVinyl** is a hybrid desktop/web application that brings the tactile experience of vinyl crate digging to your digital music library.

It combines a **Python** backend (for robust file scanning, metadata extraction, and audio processing) with a high-fidelity **Three.js** frontend to create an immersive 3D music player. Browse your collection in crates, inspect gatefold covers, and drop the needle on a virtual turntable.

<img width="400px" src="/github_images/{3EE99E41-D2B6-46B7-BE4B-7EB990D52FEF}.png"/><img width="400px" src="/github_images/{2A60A6D1-DAF0-49C2-B114-633C5B5BEA30}.png"/>

-----

## ✨ Features

### 🎧 The "Analog" Experience

- **Robust Collection System:** Enjoy many different collections and filters to scroll through.
<img width="400px" src="/github_images/{B1FFA4F2-A1FB-4433-BF97-0818571FDB73}.png"/>

- **Crate Digging:** Browse your library as physical crates. Flip through records with realistic physics and lifting animations.
<img width="400px" src="/github_images/{2A60A6D1-DAF0-49C2-B114-633C5B5BEA30}.png"/>
<img width="400px" src="/github_images/{ACA00C66-FA63-41CA-A196-1B40D0AECFAF}.png"/>

- **Gatefold Inspection:** Click an album to pull it out. Watch the sleeve open up to reveal the disc and tracklist.
<img width="400px" src="/github_images/{23C2EAE9-A84B-4702-87BD-5EE7A39584CA}.png"/>

- **Virtual Turntable:** A fully animated 3D turntable. Watch the tone arm move and the record spin.
- **Needle Drop:** Click anywhere on the vinyl surface to seek to that timestamp, calculated by the groove position.
<img width="400px" src="/github_images/{6D8528F4-7FC0-48A4-ACBA-1F668421EDE4}.png"/>

### 🛠️ Powerful Backend

  * **Library Scanner:** Recursively scans local directories for `.mp3` and `.flac` files.
  * **Smart Metadata:** Extracts ID3 tags, FLAC headers, and embedded artwork via `Mutagen`.
  * **Dynamic Theming:** Analyzes cover art to extract dominant colors, automatically theming the UI and 3D environment for each album.
  * **Audio Engine:** Low-latency playback using `Pygame` with cross-platform support.

### 💻 Modern Interface

  * **Hybrid Architecture:** A CustomTkinter desktop launcher controls a FastAPI WebSocket server.
  * **Websocket Sync:** Real-time bi-directional synchronization between the audio engine and the 3D visualizer.
  * **Gimbal Camera:** Custom-written camera controls allowing for smooth panning and zooming (Middle Mouse Button).

-----

## 🚀 Installation

### Prerequisites

  * Python 3.10 or higher
  * A modern web browser (Chrome/Firefox/Edge) with WebGL support.

### 1\. Clone the Repository

```bash
git clone https://github.com/L30ZMine/PythVinyl.git
cd PythVinyl
```

### 2\. Install Dependencies

Create a virtual environment (recommended) and install the required packages.

```bash
# Windows
python -m venv venv
.\venv\Scripts\activate

# Linux/Mac
python3 -m venv venv
source venv/bin/activate

# Install requirements
pip install -r requirements.txt
```

### 3\. Run the Application

Start the desktop launcher.

```bash
python main.py
```

-----

## 🎮 Usage Guide

1.  **Launch:** Run `main.py`. A desktop window titled "Vinyl Stack Helper" will appear.
2.  **Scan:**  
      * Click **"Select Music Directory"** and choose a folder containing your music.
      * Click **"Start New Scan"**. The backend will index your music and generate cover art caches.
3.  **Start Server:**
      * Once scanning is complete, click **"Start Server"**.
      * The status will change to "Server Running on Port 8000".
4.  **Visualize:**
      * Click **"Open in Browser"**.
      * **Left Click:** Select crates, pick albums, play tracks.
      * **Middle Mouse (Hold & Drag):** Rotate camera (Gimbal control).
      * **Scroll Wheel:** Move through crates or zoom in/out.

-----

## ⚙️ Configuration

You can tweak the 3D experience by editing `config.js`.

  * **`CONFIG.SCENE`:** Change background gradients and fog.
  * **`CONFIG.SCROLL`:** Adjust mouse wheel sensitivity.
  * **`CONFIG.GIMBAL`:** Tweak camera rotation limits and smoothing.
  * **`CONFIG.LIGHTS`:** Adjust lighting intensity for different moods.

