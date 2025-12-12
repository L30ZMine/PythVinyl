import * as THREE from 'three';
import TWEEN from 'three/addons/libs/tween.module.js';
import { CONFIG } from './config.js';
import { NetworkManager } from './network.js';
import { VinylPlayer } from './vinyl_player.js';

const STATES = { OVERVIEW: 0, BROWSE: 1, INSPECT: 2, PLAYER: 3 };
const STATE_KEYS = ['OVERVIEW', 'BROWSE', 'INSPECT', 'PLAYER'];

class VinylApp {
    constructor() {
        this.stateIndex = 0; 
        this.isTransitioning = false; 
        this.titleInterval = null; 
        
        this.fullLibrary = []; 
        this.crates = [];
        this.browseMeshes = [];
        this.activeAlbum = null;
        this.activeCrate = null;
        
        this.currentSortMode = CONFIG.SORT_MODES.RAW;
        this.sortAscending = true; 
        this.groupingMode = 'FLOW'; 
        this.scrollInverted = false;
        
        this.hasPlayed = false;
        this.libraryLoaded = false;
        this.pendingSyncData = null;

        this.scrollTarget = 0;
        this.scrollCurrent = 0;

        // Track what we are playing currently to avoid DOM scraping
        this.currentTrackInfo = { title: null, artist: null };

        // --- GIMBAL STATE ---
        this.isGimbalActive = false;
        this.gimbalStart = new THREE.Vector2();
        this.gimbalSpherical = new THREE.Spherical();
        this.targetTheta = 0;
        this.targetPhi = 0;
        this.camTheta = 0;
        this.camPhi = 0;
        this.currentLookAt = new THREE.Vector3();
        
        this.activeGimbalConfig = CONFIG.GIMBAL.DEFAULT; 

        this.ui = {
            title: document.getElementById('app-title'),
            status: document.getElementById('state-indicator'),
            backZone: document.getElementById('back-zone'),
            interface: document.getElementById('player-interface'),
            filterBar: document.getElementById('filter-bar'),
            navBtns: document.querySelectorAll('.nav-btn'),
            
            filterBtns: {
                ARTIST: document.getElementById('sort-artist'),
                ALBUM: document.getElementById('sort-album'),
                RAW: document.getElementById('sort-raw')
            },
            
            btnOrder: document.getElementById('toggle-order'),
            btnGroup: document.getElementById('toggle-group'),
            btnScroll: document.getElementById('toggle-scroll'),

            pTitle: document.getElementById('p-title'),
            pArtist: document.getElementById('p-artist'),
            pTime: document.getElementById('p-time'),
            volKnob: document.getElementById('vol-knob'),
            knobMarker: document.querySelector('.knob-marker'),
            iconPlay: document.getElementById('icon-play'),
            iconPause: document.getElementById('icon-pause'),
            cratePrev: document.getElementById('crate-prev'),
            crateNext: document.getElementById('crate-next')
        };

        this.network = new NetworkManager((msg) => this.ui.status.innerText = msg);
        this.initScene();
        this.player = new VinylPlayer(this.scene, this.network, () => this.handleDiscFinish());
        
        const pLoc = CONFIG.STATIONS.PLAYER;
        this.player.group.position.set(pLoc.x, pLoc.y, pLoc.z);
        this.player.group.rotation.y = pLoc.ry;

        this.setupEvents();
        this.setupUIEvents();
        this.setupNetworkEvents();
        
        this.loadLibrary().then(() => {
            this.animate();
            document.getElementById('loader-overlay').style.display = 'none';
        });
    }

    createGradientTexture() {
       const canvas = document.createElement('canvas');
       canvas.width = 32; canvas.height = 512;
       const ctx = canvas.getContext('2d');
       const grd = ctx.createLinearGradient(0, 0, 0, 512);
       grd.addColorStop(0, CONFIG.SCENE.BG_TOP);
       grd.addColorStop(1, CONFIG.SCENE.BG_BOTTOM);
       ctx.fillStyle = grd;
       ctx.fillRect(0, 0, 32, 512);
       const tex = new THREE.CanvasTexture(canvas);
       tex.colorSpace = THREE.SRGBColorSpace;
       return tex;
    }

    initScene() {
       this.scene = new THREE.Scene();
       this.scene.background = this.createGradientTexture();
       this.scene.fog = new THREE.Fog(CONFIG.SCENE.FOG.color, CONFIG.SCENE.FOG.near, CONFIG.SCENE.FOG.far);

       const startConf = CONFIG.CAMERA.STATES.OVERVIEW;
       this.camera = new THREE.PerspectiveCamera(startConf.fov, window.innerWidth/window.innerHeight, 0.1, 1000);
       this.camera.position.set(startConf.pos.x, startConf.pos.y, startConf.pos.z);
       this.camera.lookAt(startConf.look.x, startConf.look.y, startConf.look.z);

       this.renderer = new THREE.WebGLRenderer({ antialias: true });
       this.renderer.setSize(window.innerWidth, window.innerHeight);
       this.renderer.shadowMap.enabled = true;
       document.body.appendChild(this.renderer.domElement);

       this.worldGroup = new THREE.Group();   
       this.crateGroup = new THREE.Group();   
       this.inspectGroup = new THREE.Group(); 
       
       const s0 = CONFIG.STATIONS.OVERVIEW;
       this.worldGroup.position.set(s0.x, s0.y, s0.z);
       this.worldGroup.rotation.y = s0.ry;

       const s1 = CONFIG.STATIONS.BROWSE;
       this.crateGroup.position.set(s1.x, s1.y, s1.z);
       this.crateGroup.rotation.y = s1.ry;

       const s2 = CONFIG.STATIONS.INSPECT;
       this.inspectGroup.position.set(s2.x, s2.y, s2.z);
       this.inspectGroup.rotation.y = s2.ry;

       this.scene.add(this.worldGroup, this.crateGroup, this.inspectGroup);

       const amb = new THREE.AmbientLight(0xffffff, CONFIG.LIGHTS.AMBIENT); 
       this.scene.add(amb);
       const spot = new THREE.SpotLight(0xffffff, CONFIG.LIGHTS.SPOT);
       spot.position.set(0, 100, 0); 
       spot.castShadow = true;
       this.scene.add(spot);
       const dir = new THREE.DirectionalLight(0xffffff, CONFIG.LIGHTS.DIRECTIONAL);
       dir.position.set(-50, 50, 50);
       this.scene.add(dir);
    }

    updateTitleMarquee(text, isPlaying) {
        if (this.titleInterval) clearInterval(this.titleInterval);
        if (!isPlaying) {
            document.title = "PythVinyl";
            return;
        }
        let titleText = `${text}  *** `;
        this.titleInterval = setInterval(() => {
            titleText = titleText.substring(1) + titleText.substring(0, 1);
            document.title = titleText;
        }, 200);
    }

    setupNetworkEvents() {
        this.network.onMessage((data) => {
            if (data.status === 'sync') {
                if (data.playback && data.playback.isPlaying) {
                    this.hasPlayed = true;
                    this.currentTrackInfo.title = data.playback.track;
                    this.currentTrackInfo.artist = data.playback.artist;
                    
                    this.ui.interface.classList.remove('hidden');
                    this.ui.pTitle.innerText = data.playback.track;
                    this.ui.pArtist.innerText = data.playback.artist;
                    this.ui.iconPlay.classList.add('hidden');
                    this.ui.iconPause.classList.remove('hidden');
                    this.updateTitleMarquee(`${data.playback.track} - ${data.playback.artist}`, true);
                }
                
                if (!this.libraryLoaded) {
                    this.pendingSyncData = data.navigation;
                } else {
                    if(data.navigation) this.restoreNavState(data.navigation);
                }

            } else if (data.status === 'playing') {
                this.ui.status.innerText = "Playing";

                // Otherwise, keep the currently cached info (e.g. on resume).
                if (data.track) {
                    this.currentTrackInfo.title = data.track;
                    this.currentTrackInfo.artist = data.artist || "";
                    this.ui.pTitle.innerText = data.track;
                    this.ui.pArtist.innerText = data.artist || "";
                }
                
                this.currentTrackInfo.title = data.track;
                this.currentTrackInfo.artist = data.artist || "";

                this.ui.pTitle.innerText = data.track;
                this.ui.pArtist.innerText = data.artist || "";
                this.ui.iconPlay.classList.add('hidden');
                this.ui.iconPause.classList.remove('hidden');
                this.hasPlayed = true;
                this.updateNavState();
                if(this.ui.interface) this.ui.interface.classList.remove('hidden');
                this.updateTitleMarquee(`${data.track} - ${data.artist}`, true);

            } else if (data.status === 'stopped' || data.status === 'paused') {
                this.ui.iconPlay.classList.remove('hidden');
                this.ui.iconPause.classList.add('hidden');
                this.updateTitleMarquee("", false);

            } else if (data.status === 'finished') {
                console.log("[App] Received FINISHED signal from server");
                // IMPORTANT: Pause local visual immediately
                this.playNextTrack();
            }
        });
    }

    playNextTrack() {
        if (!this.player || !this.player.currentDiscData) {
            console.warn("[App] Cannot play next: No disc loaded in player.");
            return;
        }
        
        const currentTitle = this.currentTrackInfo.title;
        const tracks = this.player.currentDiscData.tracks;
        
        console.log(`[App] Attempting to find next track after: "${currentTitle}"`);

        // Find current track index by title
        let currentIndex = -1;
        if (currentTitle) {
            currentIndex = tracks.findIndex(t => t.title === currentTitle);
        } else {
            console.warn("[App] No current title tracked, guessing 0.");
            currentIndex = 0;
        }
        
        console.log(`[App] Current Index found: ${currentIndex} / ${tracks.length - 1}`);

        if (currentIndex !== -1 && currentIndex < tracks.length - 1) {
            // Next track exists on this disc
            this.player.playTrack(currentIndex + 1, 0);
            const nextTrack = tracks[currentIndex + 1];
            console.log(`[App] Sending PLAY for next track: ${nextTrack.title}`);
            this.network.send("PLAY", { 
                file_path: nextTrack.file_path, 
                title: nextTrack.title, 
                artist: this.activeAlbum.artist 
            });
        } else {
            // End of disc
            console.log("[App] End of disc reached. Calling handleDiscFinish().");
            this.handleDiscFinish();
        }
    }

    setupUIEvents() {
        this.ui.navBtns.forEach(btn => {
            btn.onclick = () => {
                if(btn.classList.contains('disabled')) return;
                const newState = parseInt(btn.dataset.state);
                this.changeState(newState);
            }
        });

        Object.keys(this.ui.filterBtns).forEach(mode => {
            const btn = this.ui.filterBtns[mode];
            if(!btn) return;
            btn.onclick = () => {
                Object.values(this.ui.filterBtns).forEach(b => { if(b) b.classList.remove('active') });
                btn.classList.add('active');
                this.processLibrary(mode);
                this.enterOverview(); 
            };
        });

        if(this.ui.btnOrder) {
            this.ui.btnOrder.onclick = () => {
                if(this.currentSortMode === CONFIG.SORT_MODES.RAW) return;
                this.sortAscending = !this.sortAscending;
                this.ui.btnOrder.innerText = this.sortAscending ? "A-Z" : "Z-A";
                this.processLibrary(this.currentSortMode);
                this.enterOverview();
            }
        }

        if(this.ui.btnGroup) {
            this.ui.btnGroup.onclick = () => {
                if(this.currentSortMode === CONFIG.SORT_MODES.RAW) return;
                this.groupingMode = (this.groupingMode === 'FLOW') ? 'BUCKET' : 'FLOW';
                this.ui.btnGroup.innerText = (this.groupingMode === 'FLOW') ? "FLOW" : "CATS"; 
                this.processLibrary(this.currentSortMode);
                this.enterOverview();
            }
        }

        if (this.ui.btnScroll) {
            this.ui.btnScroll.onclick = () => {
                this.scrollInverted = !this.scrollInverted;
                this.ui.btnScroll.style.color = this.scrollInverted ? "#44aa88" : "#aaa";
            }
        }

        this.ui.cratePrev.onclick = () => this.cycleCrate(-1);
        this.ui.crateNext.onclick = () => this.cycleCrate(1);
        document.getElementById('btn-play').onclick = () => {
            this.player.pause();
            
            // Check the local player state immediately
            const isPlaying = (this.player.state === 'PLAYING');

            if (isPlaying) {
                // Update Icons
                this.ui.iconPlay.classList.add('hidden');
                this.ui.iconPause.classList.remove('hidden');
                this.ui.status.innerText = "Playing";
                
                // Force Marquee Restart using cached info
                const t = this.currentTrackInfo.title || "Unknown Track";
                const a = this.currentTrackInfo.artist || "";
                this.updateTitleMarquee(`${t} - ${a}`, true);
            } else {
                // Update Icons
                this.ui.iconPlay.classList.remove('hidden');
                this.ui.iconPause.classList.add('hidden');
                this.ui.status.innerText = "Paused";
                
                // Stop Marquee
                this.updateTitleMarquee("", false);
            }
        };
        document.getElementById('btn-stop').onclick = () => this.player.stop();
        document.getElementById('btn-next').onclick = () => this.playNextTrack(); 
        document.getElementById('btn-prev').onclick = () => this.player.prevTrack(); 

        
        let isDragging = false; let startY = 0; let vol = 0.5;
        if (this.ui.volKnob) {
            this.ui.volKnob.onmousedown = (e) => { isDragging = true; startY = e.clientY; };
            window.addEventListener('mouseup', () => { isDragging = false; });
            window.addEventListener('mousemove', (e) => {
                if(!isDragging) return;
                const delta = startY - e.clientY;
                startY = e.clientY;
                vol = Math.min(1, Math.max(0, vol + delta * 0.01));
                const deg = (vol * 270) - 135;
                if(this.ui.knobMarker) this.ui.knobMarker.style.transform = `translateX(-50%) rotate(${deg}deg)`;
                this.network.send("VOLUME", { value: vol });
            });
        }
    }

    setupEvents() {
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
        window.addEventListener('mousemove', (e) => {
            this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            if(this.isGimbalActive) this.handleGimbalMove(e);
        });
        window.addEventListener('wheel', (e) => {
            const dir = this.scrollInverted ? -1 : 1;
            const delta = e.deltaY * dir;

            if (this.stateIndex === STATES.OVERVIEW) {
                this.scrollTarget += delta * CONFIG.SCROLL.SPEED_OVERVIEW; 
                this.scrollTarget = Math.max(0, Math.min(this.scrollTarget, this.crates.length - 1));
            } else if (this.stateIndex === STATES.BROWSE) { 
                this.scrollTarget += delta * CONFIG.SCROLL.SPEED_BROWSE;
                this.scrollTarget = Math.max(0, Math.min(this.scrollTarget, this.browseMeshes.length - 1));
            } else if (this.stateIndex === STATES.PLAYER) {
                this.camera.fov += delta * CONFIG.SCROLL.ZOOM_SPEED;
                this.camera.fov = Math.max(CONFIG.PLAYER.FOV_MIN, Math.min(CONFIG.PLAYER.FOV_MAX, this.camera.fov));
                this.camera.updateProjectionMatrix();
            }
        });
        window.addEventListener('click', (e) => {
            if(e.target.closest('#navbar') || e.target.closest('#player-interface') || e.target.closest('.crate-nav') || e.target.closest('#filter-bar')) return;
            this.onClick();
        });

        window.addEventListener('mousedown', (e) => {
            if (e.button === 1 && (this.stateIndex === STATES.INSPECT || this.stateIndex === STATES.PLAYER)) {
                e.preventDefault();
                this.startGimbal(e);
            }
        });
        window.addEventListener('mouseup', (e) => {
            if (e.button === 1 && this.isGimbalActive) this.stopGimbal();
        });
    }

    async loadLibrary() {
        try {
            const res = await fetch('/api/library');
            const data = await res.json();
            this.fullLibrary = data;
            this.libraryLoaded = true;

            document.getElementById('loader-overlay').style.display = 'none';

            if (this.pendingSyncData) {
                this.restoreNavState(this.pendingSyncData);
                this.pendingSyncData = null;
            } else {
                this.processLibrary(CONFIG.SORT_MODES.RAW);
                this.enterOverview();
            }

        } catch(e) { console.error(e); }
    }

    processLibrary(mode) {
        this.currentSortMode = mode || CONFIG.SORT_MODES.RAW;
        this.crates = [];
        
        const isRaw = (this.currentSortMode === CONFIG.SORT_MODES.RAW);
        if(this.ui.btnOrder) this.ui.btnOrder.style.opacity = isRaw ? "0.3" : "1";
        if(this.ui.btnGroup) this.ui.btnGroup.style.opacity = isRaw ? "0.3" : "1";

        if (isRaw) {
            const size = CONFIG.CRATE.SIZE;
            for(let i=0; i < this.fullLibrary.length; i+=size) {
                const end = Math.min(i + size, this.fullLibrary.length);
                this.crates.push({
                    label: `${i+1} - ${end}`,
                    albums: this.fullLibrary.slice(i, end)
                });
            }
            return;
        }

        let sortedLib = [...this.fullLibrary];
        sortedLib.sort((a, b) => {
            let valA, valB;
            if (this.currentSortMode === CONFIG.SORT_MODES.ARTIST) {
                valA = a.artist.toUpperCase(); valB = b.artist.toUpperCase();
            } else {
                valA = a.title.toUpperCase(); valB = b.title.toUpperCase();
            }
            if (valA < valB) return this.sortAscending ? -1 : 1;
            if (valA > valB) return this.sortAscending ? 1 : -1;
            return 0;
        });

        if (this.groupingMode === 'BUCKET') {
            const buckets = {};
            sortedLib.forEach(album => {
                let key = "#";
                let val = (this.currentSortMode === CONFIG.SORT_MODES.ARTIST) ? album.artist : album.title;
                const char = val.charAt(0).toUpperCase();
                if (char >= 'A' && char <= 'Z') key = char;
                if (!buckets[key]) buckets[key] = [];
                buckets[key].push(album);
            });
            const keys = Object.keys(buckets).sort();
            if(!this.sortAscending) keys.reverse();
            
            keys.forEach(key => {
                const items = buckets[key];
                const size = CONFIG.CRATE.SIZE;
                for(let i=0; i < items.length; i+=size) {
                    this.crates.push({
                        label: items.length > size ? `${key} (${Math.floor(i/size)+1})` : key,
                        albums: items.slice(i, i+size)
                    });
                }
            });
        } 
        else {
            const augmentedList = [];
            let lastValue = null;

            sortedLib.forEach(album => {
                let currentValue = "";
                let displayLabel = "";

                if (this.currentSortMode === CONFIG.SORT_MODES.ARTIST) {
                    currentValue = album.artist.toUpperCase();
                    displayLabel = album.artist; 
                } else {
                    const char = album.title.charAt(0).toUpperCase();
                    currentValue = (char >= 'A' && char <= 'Z') ? char : "#";
                    displayLabel = currentValue;
                }

                if (currentValue !== lastValue) {
                    augmentedList.push({
                        type: 'separator',
                        label: displayLabel
                    });
                    lastValue = currentValue;
                }
                augmentedList.push(album);
            });

            const size = CONFIG.CRATE.SIZE;
            for(let i=0; i < augmentedList.length; i+=size) {
                const end = Math.min(i + size, augmentedList.length);
                const chunk = augmentedList.slice(i, end);
                
                let label = "Collection";
                const firstAlb = chunk.find(x => x.type !== 'separator');
                let lastAlb = null;
                for(let k=chunk.length-1; k>=0; k--) { 
                    if(chunk[k].type !== 'separator') { lastAlb = chunk[k]; break; } 
                }

                if(firstAlb && lastAlb) {
                    let v1 = (this.currentSortMode === CONFIG.SORT_MODES.ARTIST) ? firstAlb.artist : firstAlb.title;
                    let v2 = (this.currentSortMode === CONFIG.SORT_MODES.ARTIST) ? lastAlb.artist : lastAlb.title;
                    label = `${v1.substring(0,3).toUpperCase()} - ${v2.substring(0,3).toUpperCase()}`;
                }

                this.crates.push({
                    label: label,
                    albums: chunk 
                });
            }
        }
        
        if (!this.activeCrate && this.crates.length > 0) this.activeCrate = this.crates[0];
        this.scrollTarget = 0;
        this.scrollCurrent = 0;
    }

    createSeparatorTexture(label) {
        const w = 512;
        const h = 512;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0,0,w,h);
        
        ctx.fillStyle = CONFIG.DIGGING.SEPARATOR_TEXT_COLOR;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        
        let fontSize = CONFIG.DIGGING.SEPARATOR_FONT_SIZE;
        let fontFamily = CONFIG.FONTS.SEPARATOR;
        ctx.font = `900 ${fontSize}px ${fontFamily}`;
        
        const maxW = w - 40;
        const textW = ctx.measureText(label).width;
        
        if (textW > maxW) {
            fontSize = Math.floor(fontSize * (maxW / textW));
            ctx.font = `900 ${fontSize}px ${fontFamily}`;
        }

        ctx.fillText(label, w/2, 20);
        ctx.fillRect(0, 100, w, 10);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }

    createNumberTexture(n, label) {
       const canvas = document.createElement('canvas');
       canvas.width = 256; canvas.height = 256;
       const ctx = canvas.getContext('2d');
       ctx.fillStyle = "rgba(0,0,0,0.6)"; 
       ctx.fillRect(0,0,256,256);
       ctx.strokeStyle = "#44aa88";
       ctx.lineWidth = 10;
       ctx.strokeRect(5,5,246,246);
       ctx.fillStyle = "#ffffff";
       ctx.font = "bold 40px Arial";
       ctx.textAlign = "center";
       ctx.textBaseline = "middle";
       ctx.fillText(label || "CRATE", 128, 80);
       ctx.font = "bold 120px Arial";
       ctx.fillText(n, 128, 160);
       const tex = new THREE.CanvasTexture(canvas);
       tex.colorSpace = THREE.SRGBColorSpace;
       return tex;
    }

    createTracklistTexture(albumData) {
       const w = 512, h = 1024;
       const canvas = document.createElement('canvas');
       canvas.width = w; canvas.height = h;
       const ctx = canvas.getContext('2d');
       ctx.fillStyle = "rgba(0,0,0,0.8)";
       ctx.fillRect(0,0,w,h);
       ctx.fillStyle = albumData.accent_color || CONFIG.INSPECT_VIEW.ACCENT_COLOR;
       
       ctx.font = CONFIG.FONTS.TRACKLIST_HEADER;
       ctx.textAlign = 'center';
       ctx.fillText("TRACKLIST", w/2, 80);
       
       let totalLines = 0;
       albumData.discs.forEach(d => { totalLines += 1.5 + d.tracks.length; });
       const availH = 880; const baseH = 35;
       const scale = (totalLines * baseH > availH) ? availH / (totalLines * baseH) : 1;
       const lh = Math.floor(35 * scale);
       
       ctx.font = CONFIG.FONTS.TRACKLIST_BODY; 
       ctx.textAlign = 'left';
       let y = 140;
       
       albumData.discs.forEach((disc) => {
           if (y > 1000) return;
           ctx.fillStyle = albumData.accent_color || "#888";
           ctx.textAlign = 'center';
           ctx.fillText(`--- DISC ${disc.disc_number} ---`, w/2, y);
           y += lh;
           ctx.textAlign = 'left';
           ctx.fillStyle = CONFIG.INSPECT_VIEW.TEXT_COLOR;
           disc.tracks.forEach((t, j) => {
               if (y > 1000) return;
               const dur = t.duration_str || "--:--";
               let title = t.title;
               if (title.length > 30) title = title.substring(0, 27) + "...";
               
               ctx.fillText(`${j+1}. ${title}`, 20, y);
               ctx.textAlign = 'right';
               ctx.fillText(dur, w-20, y);
               ctx.textAlign = 'left';
               y += lh;
           });
           y += lh * 0.5;
       });
       const tex = new THREE.CanvasTexture(canvas);
       tex.colorSpace = THREE.SRGBColorSpace;
       return tex;
    }

    saveNavState() {
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
        const state = {
            sortMode: this.currentSortMode,
            crateIndex: this.activeCrate ? this.crates.indexOf(this.activeCrate) : 0,
            albumId: this.activeAlbum ? this.activeAlbum.id : null,
            viewState: this.stateIndex,
            accentColor: accent,
            sortAscending: this.sortAscending,
            groupingMode: this.groupingMode
        };
        this.network.send("UPDATE_NAV", state);
    }

    restoreNavState(savedState) {
        const sort = (savedState && savedState.sortMode) ? savedState.sortMode : CONFIG.SORT_MODES.RAW;
        
        if (savedState) {
            if (savedState.accentColor) document.documentElement.style.setProperty('--primary', savedState.accentColor);
            if (typeof savedState.sortAscending !== 'undefined') this.sortAscending = savedState.sortAscending;
            if (savedState.groupingMode) this.groupingMode = savedState.groupingMode;
        }
        
        if(this.ui.btnOrder) this.ui.btnOrder.innerText = this.sortAscending ? "A-Z" : "Z-A";
        if(this.ui.btnGroup) this.ui.btnGroup.innerText = (this.groupingMode === 'FLOW') ? "FLOW" : "CATS";

        this.processLibrary(sort);
        Object.values(this.ui.filterBtns).forEach(b => { if(b) b.classList.remove('active') });
        if(this.ui.filterBtns[sort]) this.ui.filterBtns[sort].classList.add('active');
        
        let crateIdx = 0;
        let album = null;

        if (savedState && savedState.albumId) {
            for(let i=0; i<this.crates.length; i++) {
                const found = this.crates[i].albums.find(a => a.type !== 'separator' && a.id === savedState.albumId);
                if(found) {
                    album = found;
                    crateIdx = i;
                    break;
                }
            }
        } 
        else if (savedState && savedState.crateIndex >= 0) {
            crateIdx = savedState.crateIndex;
        }

        const targetView = (savedState) ? savedState.viewState : STATES.OVERVIEW;

        this.enterOverview(); 
        if (targetView >= STATES.BROWSE) {
            if (crateIdx < this.crates.length) this.enterBrowse(crateIdx); 
        }
        if (targetView >= STATES.INSPECT && album) {
            this.enterInspect(album); 
        }
        if (targetView === STATES.PLAYER && album) {
            const discIndex = savedState.discIndex || 0;
            if (album.discs[discIndex]) this.enterPlayer(album.discs[discIndex], true);
        }
        
        this.updateNavState();
    }

    cycleCrate(direction) {
        if (!this.activeCrate) return;
        const currentIdx = this.crates.indexOf(this.activeCrate);
        const nextIdx = (currentIdx + direction + this.crates.length) % this.crates.length;
        this.enterBrowse(nextIdx);
    }

    updateNavState() {
        this.ui.navBtns[0].classList.remove('disabled');
        this.ui.navBtns[1].classList.toggle('disabled', !this.activeCrate);
        this.ui.navBtns[2].classList.toggle('disabled', !this.activeAlbum);
        this.ui.navBtns[3].classList.toggle('disabled', !this.hasPlayed);
    }

    handleDiscFinish() {
        if (this.activeAlbum) {
            const currentDiscIdx = this.player.currentDiscData.disc_number - 1;
            const nextDiscIdx = currentDiscIdx + 1;
            if (nextDiscIdx < this.activeAlbum.discs.length) {
                // Advance to next Disc
                this.enterPlayer(this.activeAlbum.discs[nextDiscIdx]);
            } else {
                // End of Album
                this.player.stop();
            }
        }
    }

    onClick() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        let targets = [];
        if(this.stateIndex === 0) targets = this.worldGroup.children;
        else if(this.stateIndex === 1) targets = this.crateGroup.children;
        else if(this.stateIndex === 2) targets = this.inspectGroup.children;
        else if(this.stateIndex === 3) targets = this.player.group.children;

        const intersects = this.raycaster.intersectObjects(targets, true);
        if(intersects.length === 0) return;

        let obj = intersects[0].object;
        while(obj.parent && !obj.userData.type) obj = obj.parent;
        const data = obj.userData;

        if (data.type === 'separator') return;

        if (data.type === 'crate') this.enterBrowse(data.index);
        else if (data.type === 'album') {
            if(Math.abs(data.index - this.scrollCurrent) < 1.0) this.enterInspect(data.data);
            else this.scrollTarget = data.index;
        }
        else if (data.type === 'disc_item') this.enterPlayer(data.disc);
        else if (data.type === 'vinyl_surface') this.player.handleInput(intersects[0].point);
    }

    startGimbal(e) {
       this.isGimbalActive = true;
       this.gimbalStart.set(e.clientX, e.clientY);
       document.body.style.cursor = "move";
       
       if (this.stateIndex === STATES.INSPECT) {
           this.activeGimbalConfig = CONFIG.GIMBAL.INSPECT;
       } else if (this.stateIndex === STATES.PLAYER) {
           this.activeGimbalConfig = CONFIG.GIMBAL.PLAYER;
       } else {
           this.activeGimbalConfig = CONFIG.GIMBAL.DEFAULT;
       }

       const offset = new THREE.Vector3().copy(this.camera.position).sub(this.currentLookAt);
       this.gimbalSpherical.setFromVector3(offset);
       
       this.targetTheta = this.gimbalSpherical.theta;
       this.targetPhi = this.gimbalSpherical.phi;
       this.camTheta = this.gimbalSpherical.theta;
       this.camPhi = this.gimbalSpherical.phi;
       
       this.gimbalBaseTheta = this.gimbalSpherical.theta;
       this.gimbalBasePhi = this.gimbalSpherical.phi;
    }

    handleGimbalMove(e) {
       if (!this.isGimbalActive) return;
       const conf = this.activeGimbalConfig;
       
       const deltaX = (e.clientX - this.gimbalStart.x) * conf.SENSITIVITY;
       const deltaY = (e.clientY - this.gimbalStart.y) * conf.SENSITIVITY;
       
       let theta = this.gimbalBaseTheta - deltaX;
       let phi = this.gimbalBasePhi - deltaY;
       
       const minTheta = this.gimbalBaseTheta - conf.LIMIT_AZIMUTH;
       const maxTheta = this.gimbalBaseTheta + conf.LIMIT_AZIMUTH;
       theta = Math.max(minTheta, Math.min(maxTheta, theta));
       
       const minPhi = Math.max(conf.MIN_POLAR, this.gimbalBasePhi - conf.LIMIT_POLAR);
       const maxPhi = Math.min(conf.MAX_POLAR, this.gimbalBasePhi + conf.LIMIT_POLAR);
       phi = Math.max(minPhi, Math.min(maxPhi, phi));
       
       this.targetTheta = theta;
       this.targetPhi = phi;
    }

    stopGimbal() {
       this.isGimbalActive = false;
       document.body.style.cursor = "default";
    }

    changeState(newState) {
        this.stateIndex = newState;
        this.ui.navBtns.forEach(b => b.classList.remove('active'));
        if(this.ui.navBtns[newState]) this.ui.navBtns[newState].classList.add('active');

        this.worldGroup.visible = (newState === STATES.OVERVIEW);
        this.crateGroup.visible = (newState === STATES.BROWSE);
        this.inspectGroup.visible = (newState === STATES.INSPECT);
        
        // BUG FIX: Reset scroll when going back to Overview
        if (newState === STATES.OVERVIEW) {
            this.scrollTarget = 0;
            this.scrollCurrent = 0;
        }

        if (newState === STATES.PLAYER) {
            if(this.ui.interface) this.ui.interface.classList.remove('hidden');
        } else {
            if(this.ui.interface) this.ui.interface.classList.add('hidden');
        }

        if (newState === STATES.BROWSE || newState === STATES.OVERVIEW) {
            this.ui.filterBar.classList.remove('hidden');
            this.ui.filterBar.style.display = 'flex';
        } else {
            this.ui.filterBar.classList.add('hidden');
            this.ui.filterBar.style.display = 'none';
        }

        if (newState === STATES.BROWSE) {
            this.ui.cratePrev.classList.remove('hidden');
            this.ui.crateNext.classList.remove('hidden');
        } else {
            this.ui.cratePrev.classList.add('hidden');
            this.ui.crateNext.classList.add('hidden');
        }

        const instant = (newState === STATES.BROWSE);
        this.updateView(instant);
    }

    updateView(instant = false) {
        const key = STATE_KEYS[this.stateIndex];
        const target = CONFIG.CAMERA.STATES[key];
        this.isTransitioning = true; 

        let lookX = target.look.x;
        let lookY = target.look.y;
        let lookZ = target.look.z;

        if(this.stateIndex === STATES.BROWSE) {
            const depth = this.scrollCurrent * CONFIG.DIGGING.SPACING;
            lookX = 100 + depth;
            lookY = 5;
            lookZ = 0;
        } else if (this.stateIndex === STATES.OVERVIEW) {
            const offX = this.scrollCurrent * CONFIG.CRATE.SPACING_X;
            lookX = offX;
        }

        this.currentLookAt.set(lookX, lookY, lookZ);

        let destX, destY, destZ;
        if(this.stateIndex === STATES.BROWSE) {
            destX = lookX + CONFIG.CAMERA.BROWSE_OFFSET.x;
            destY = CONFIG.CAMERA.BROWSE_OFFSET.y;
            destZ = CONFIG.CAMERA.BROWSE_OFFSET.z;
        } else if (this.stateIndex === STATES.OVERVIEW) {
            destX = lookX; 
            destY = target.pos.y;
            destZ = target.pos.z;
        } else {
            destX = target.pos.x;
            destY = target.pos.y;
            destZ = target.pos.z;
        }

        if (instant || target.transitionTime === 0) {
            this.camera.fov = target.fov;
            this.camera.updateProjectionMatrix();
            this.camera.position.set(destX, destY, destZ);
            this.camera.lookAt(this.currentLookAt);
            
            this.isTransitioning = false;
            const offset = new THREE.Vector3().copy(this.camera.position).sub(this.currentLookAt);
            this.gimbalSpherical.setFromVector3(offset);
            this.camTheta = this.gimbalSpherical.theta;
            this.camPhi = this.gimbalSpherical.phi;
            this.targetTheta = this.camTheta;
            this.targetPhi = this.camPhi;

        } else {
            new TWEEN.Tween(this.camera)
                .to({ fov: target.fov }, target.transitionTime)
                .onUpdate(() => this.camera.updateProjectionMatrix())
                .start();
            new TWEEN.Tween(this.camera.position)
                .to({ x: destX, y: destY, z: destZ }, target.transitionTime)
                .easing(TWEEN.Easing.Cubic.InOut)
                .onUpdate(() => this.camera.lookAt(this.currentLookAt))
                .onComplete(() => { 
                    this.isTransitioning = false; 
                    const offset = new THREE.Vector3().copy(this.camera.position).sub(this.currentLookAt);
                    this.gimbalSpherical.setFromVector3(offset);
                    this.camTheta = this.gimbalSpherical.theta;
                    this.camPhi = this.gimbalSpherical.phi;
                    this.targetTheta = this.camTheta;
                    this.targetPhi = this.camPhi;
                })
                .start();
        }
    }

    enterOverview() {
        this.saveNavState();
        this.changeState(STATES.OVERVIEW);
        this.ui.title.innerText = `Collection (${this.currentSortMode})`;
        
        while(this.worldGroup.children.length) this.worldGroup.remove(this.worldGroup.children[0]);

        const boxGeo = new THREE.BoxGeometry(CONFIG.CRATE.WIDTH, CONFIG.CRATE.HEIGHT, CONFIG.CRATE.DEPTH);
        const mat = new THREE.MeshStandardMaterial({color: CONFIG.CRATE.COLOR});
        
        this.crates.forEach((c, i) => {
            const mesh = new THREE.Mesh(boxGeo, mat);
            const x = (i * CONFIG.CRATE.SPACING_X);
            const z = 0; 
            
            mesh.position.set(x, 0, z);
            mesh.userData = { type: 'crate', index: i };
            this.worldGroup.add(mesh);

            const numTex = this.createNumberTexture(i+1, c.label.substring(0,12));
            const numMesh = new THREE.Mesh(new THREE.PlaneGeometry(6,6), new THREE.MeshBasicMaterial({map: numTex, transparent:true}));
            numMesh.position.set(0, 0, CONFIG.CRATE.DEPTH/2 + 0.1);
            mesh.add(numMesh);
            
            if(CONFIG.DEBUG.SHOW_HITBOXES) {
                const helper = new THREE.BoxHelper(mesh, 0xff0000);
                this.worldGroup.add(helper);
            }
        });
        
        this.scrollTarget = 0;
        this.scrollCurrent = 0;
        this.updateView(true);
    }

    enterBrowse(index) {
        this.activeCrate = this.crates[index];
        this.saveNavState();
        this.changeState(STATES.BROWSE);
        this.ui.title.innerText = this.activeCrate.label;

        while(this.crateGroup.children.length) this.crateGroup.remove(this.crateGroup.children[0]);
        this.browseMeshes = [];

        const bw = CONFIG.DIGGING.BOX_WIDTH; const bh = CONFIG.DIGGING.BOX_HEIGHT; const bd = CONFIG.DIGGING.BOX_DEPTH; const th = CONFIG.DIGGING.BOX_THICKNESS;
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, side: THREE.DoubleSide });
        const floor = new THREE.Mesh(new THREE.BoxGeometry(bw, th, bd), woodMat); floor.position.set(0, 0, -bd/2 + 2); 
        const left = new THREE.Mesh(new THREE.BoxGeometry(th, bh, bd), woodMat); left.position.set(-bw/2, bh/2, -bd/2 + 2);
        const right = new THREE.Mesh(new THREE.BoxGeometry(th, bh, bd), woodMat); right.position.set(bw/2, bh/2, -bd/2 + 2);
        const front = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, th), woodMat); front.position.set(0, bh/2, 2);
        const back = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, th), woodMat); back.position.set(0, bh/2, -bd + 2);
        this.crateGroup.add(floor, left, right, front, back);

        const loader = new THREE.TextureLoader();
        
        this.activeCrate.albums.forEach((item, i) => {
            if (item.type === 'separator') {
                const sHeight = CONFIG.DIGGING.SEPARATOR_HEIGHT;
                const tex = this.createSeparatorTexture(item.label);
                const mat = new THREE.MeshBasicMaterial({map: tex});
                const matEdge = new THREE.MeshBasicMaterial({color: CONFIG.DIGGING.SEPARATOR_COLOR});
                
                const mesh = new THREE.Mesh(
                    new THREE.BoxGeometry(10, sHeight, CONFIG.DIGGING.SEPARATOR_THICKNESS), 
                    [matEdge, matEdge, matEdge, matEdge, mat, matEdge]
                );
                
                const yPos = sHeight / 2 + 0.5; 
                
                mesh.position.set(0, yPos, -i * CONFIG.DIGGING.SPACING);
                mesh.userData = { type: 'separator', index: i };
                this.crateGroup.add(mesh);
                this.browseMeshes.push(mesh);
            } 
            else {
                const thickness = CONFIG.DIGGING.ALBUM_THICKNESS;
                const tex = loader.load(item.cover_url);
                tex.colorSpace = THREE.SRGBColorSpace;
                const mat = new THREE.MeshBasicMaterial({map: tex});
                const matEdge = new THREE.MeshBasicMaterial({color: item.accent_color || CONFIG.DIGGING.SLEEVE_COLOR});
                const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, thickness), [matEdge, matEdge, matEdge, matEdge, mat, matEdge]);
                mesh.position.set(0, CONFIG.DIGGING.BASE_HEIGHT, -i * CONFIG.DIGGING.SPACING);
                mesh.userData = { type: 'album', data: item, index: i };
                this.crateGroup.add(mesh);
                this.browseMeshes.push(mesh);
            }
        });
        
        this.scrollTarget = 0; 
        this.scrollCurrent = 0;
        this.updateView(true);
    }

    enterInspect(album) {
        this.activeAlbum = album;
        if(album.accent_color) {
            document.documentElement.style.setProperty('--primary', album.accent_color);
        }
        
        this.saveNavState();
        this.changeState(STATES.INSPECT);
        this.ui.title.innerText = album.title;

        while(this.inspectGroup.children.length) this.inspectGroup.remove(this.inspectGroup.children[0]);

        const loader = new THREE.TextureLoader();
        const tex = loader.load(album.cover_url);
        tex.colorSpace = THREE.SRGBColorSpace;

        const matEdge = new THREE.MeshBasicMaterial({ color: album.accent_color || "#fff" });
        const matCover = new THREE.MeshBasicMaterial({map: tex});
        
        const tf = CONFIG.INSPECT_VIEW.TRANSFORMS;
        
        const coverMesh = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 0.4), [matEdge, matEdge, matEdge, matEdge, matCover, matEdge]);
        coverMesh.position.set(tf.COVER.x, tf.COVER.y, tf.COVER.z);
        this.inspectGroup.add(coverMesh);

        const listTex = this.createTracklistTexture(album);
        const listMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(CONFIG.INSPECT_VIEW.TRACKLIST_WIDTH, CONFIG.INSPECT_VIEW.TRACKLIST_HEIGHT), 
            new THREE.MeshBasicMaterial({map: listTex, transparent: true})
        );
        listMesh.position.set(tf.TRACKLIST.x, tf.TRACKLIST.y, tf.TRACKLIST.z);
        this.inspectGroup.add(listMesh);

        const discGeo = new THREE.CylinderGeometry(2.5, 2.5, 0.08, 64);
        const discMat = new THREE.MeshStandardMaterial({ color: 0x050505 });
        const labelMat = new THREE.MeshBasicMaterial({ map: tex });

        album.discs.forEach((d, i) => {
             const g = new THREE.Group();
             g.add(new THREE.Mesh(discGeo, discMat), new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.09, 32), labelMat));
             g.children[0].rotation.x = Math.PI/2;
             g.children[1].rotation.x = Math.PI/2;
             
             const x = tf.COVER.x + (i * tf.DISC_SPACING_X);
             g.position.set(x, tf.DISC_START_Y, 0); 
             g.userData = { type: 'disc_item', disc: d }; 
             this.inspectGroup.add(g);
             new TWEEN.Tween(g.position).to({ y: tf.DISC_END_Y }, 800).delay(i*200).easing(TWEEN.Easing.Back.Out).start();
        });
        this.updateView(true);
    }

    enterPlayer(discData, instant = false) {
        this.hasPlayed = true;
        this.saveNavState();
        this.changeState(STATES.PLAYER);
        
        const accent = this.activeAlbum.accent_color || '#44aa88';
        document.documentElement.style.setProperty('--primary', accent);

        const loader = new THREE.TextureLoader();
        loader.load(this.activeAlbum.cover_url, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            this.player.loadDisc(discData, tex, {x: -10, y: 5, z: 0}, this.activeAlbum.artist, instant);
        });
        this.updateView(true);
    }

    animate(time) {
        requestAnimationFrame((t) => this.animate(t));
        TWEEN.update(time);
        this.player.update();
        
        if(this.ui.pTime && this.player) {
            const secs = this.player.getProgress();
            if(secs > 0) {
                const m = Math.floor(secs / 60);
                const s = Math.floor(secs % 60);
                this.ui.pTime.innerText = `${m}:${s < 10 ? '0'+s : s}`;
            } else {
                this.ui.pTime.innerText = "--:--";
            }
        }
        
        if (this.stateIndex === 1) {
            this.scrollCurrent += (this.scrollTarget - this.scrollCurrent) * 0.1;
            
            this.browseMeshes.forEach((mesh, i) => {
                const diff = Math.abs(i - this.scrollCurrent);
                let targetY = CONFIG.DIGGING.BASE_HEIGHT;
                
                if (mesh.userData.type === 'album') {
                    if (diff < 1.0) {
                        const lift = Math.cos(diff * Math.PI / 2); 
                        targetY += lift * CONFIG.DIGGING.LIFT_HEIGHT;
                    }
                } else {
                    targetY = CONFIG.DIGGING.SEPARATOR_HEIGHT/2 + 0.5;
                }
                
                mesh.position.y += (targetY - mesh.position.y) * 0.1;
            });

            if (!this.isTransitioning) {
                const depth = this.scrollCurrent * CONFIG.DIGGING.SPACING;
                const worldX = 100 + depth; 
                this.currentLookAt.set(worldX, 5, 0);
            }
        } else if (this.stateIndex === 0) {
            this.scrollCurrent += (this.scrollTarget - this.scrollCurrent) * 0.1;
            
            if (!this.isTransitioning) {
                const targetX = this.scrollCurrent * CONFIG.CRATE.SPACING_X;
                this.currentLookAt.set(targetX, CONFIG.CAMERA.STATES.OVERVIEW.look.y, CONFIG.CAMERA.STATES.OVERVIEW.look.z);
            }
        }
        
        if (!this.isTransitioning) {
            this.camTheta += (this.targetTheta - this.camTheta) * CONFIG.GIMBAL.SMOOTHING;
            this.camPhi += (this.targetPhi - this.camPhi) * CONFIG.GIMBAL.SMOOTHING;
            
            this.gimbalSpherical.theta = this.camTheta;
            this.gimbalSpherical.phi = this.camPhi;
            this.gimbalSpherical.makeSafe();
            
            const offset = new THREE.Vector3().setFromSpherical(this.gimbalSpherical);
            const newPos = new THREE.Vector3().copy(this.currentLookAt).add(offset);
            
            this.camera.position.copy(newPos);
            this.camera.lookAt(this.currentLookAt);
        }
        
        this.renderer.render(this.scene, this.camera);
    }
}

new VinylApp();