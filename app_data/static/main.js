import * as THREE from 'three';
import TWEEN from '@tweenjs/tween.js';
import GUI from 'lil-gui';

// ============================================================================
//   THEME & CONFIGURATION
// ============================================================================
const THEME = {
    SCENE: {
        BACKGROUND: 0x121212,
        FOG_COLOR: 0x121212,
        FOG_NEAR: 30,
        FOG_FAR: 150
    },
    LIGHTS: {
        AMBIENT_COLOR: 0xffffff,
        AMBIENT_INTENSITY: 0.5,
        SPOT_COLOR: 0xffffff,
        SPOT_INTENSITY: 10,
        SPOT_POS: { x: 20, y: 60, z: 40 }
    },
    CAMERA: {
        OVERVIEW: { pos: new THREE.Vector3(0, 40, 70), look: new THREE.Vector3(0,0,0) },
        BROWSE:   { pos: new THREE.Vector3(0, 35, 40), look: new THREE.Vector3(0,0,0) },
        INSPECT:  { pos: new THREE.Vector3(0, 0, 22),  look: new THREE.Vector3(0,0,0) },
        PLAYER:   { pos: new THREE.Vector3(0, 15, 15), look: new THREE.Vector3(0,0,0) }
    },
    CRATE: {
        SIZE: 40, 
        COLOR: 0x8B4513, 
        WIDTH: 8, HEIGHT: 5, DEPTH: 8,
        SPACING_X: 12, SPACING_Z: 12
    },
    DIGGING: {
        SPACING: 0.6,
        LIFT_HEIGHT: 4.0, 
        SCROLL_SPEED: 0.003,
        ALBUM_THICKNESS: 0.3,
        SINGLE_THICKNESS: 0.1,
        SLEEVE_COLOR: 0xeeeeee 
    },
    GATEFOLD: {
        OPEN_DURATION: 1000, 
        INNER_BG_COLOR: '#1a1a1a', 
        HEADER_COLOR: '#44aa88', 
        TEXT_COLOR: '#ffffff',     
        HEADER_FONT: 'bold 60px Arial',
        LIST_FONT: '40px monospace',
        DISC_FLY_DELAY: 200,       
    },
    PLAYER: {
        BASE_COLOR: 0x222222,
        PLATTER_COLOR: 0x111111,
        CHROME_COLOR: 0xaaaaaa,
        DISC_COLOR: 0x050505,
        DISC_RADIUS_OUTER: 3.3,
        DISC_RADIUS_INNER: 1.2,
        ANIM_DISC_FLY: 1500,
        ANIM_ARM_MOVE: 1000,
        ARM_REST_ANGLE: 0.5,
        ARM_PLAY_ANGLE: -0.2,
        ROTATION_SPEED: 0.03 
    }
};

const STATES = { OVERVIEW: 0, BROWSE: 1, INSPECT: 2, PLAYER: 3 };

class VinylApp {
    constructor() {
        this.state = STATES.OVERVIEW;
        this.crates = [];
        this.socket = null;
        
        // Navigation
        this.activeCrateIndex = -1;
        this.activeAlbum = null;
        this.activeDiscData = null;
        this.playerReady = false; 
        
        // Scroll
        this.scrollTarget = 0;
        this.scrollCurrent = 0;
        
        // Groups
        this.worldGroup = new THREE.Group(); 
        this.crateGroup = new THREE.Group(); 
        this.inspectGroup = new THREE.Group();
        this.playerGroup = new THREE.Group(); 
        
        this.worldGroup.add(this.crateGroup, this.inspectGroup, this.playerGroup);

        this.browseMeshes = []; 
        this.activeDiscMesh = null; 

        // UI
        this.ui = {
            title: document.getElementById('app-title'),
            status: document.getElementById('state-indicator'),
            backZone: document.getElementById('back-zone'),
            loader: document.getElementById('loader-overlay'),
            playerControls: document.getElementById('player-controls'),
            trackInfo: document.getElementById('track-info')
        };

        this.init();
    }

    async init() {
        try {
            this.setupScene();
            await this.loadDebugConfig();
            this.setupTurntable();
            this.setupWebsocket();
            this.setupEvents();
            this.setupGUI();
            await this.loadLibrary(); 
            this.animate();
            
            setTimeout(() => {
                this.ui.loader.style.opacity = 0;
                setTimeout(() => this.ui.loader.style.display = 'none', 500);
            }, 500);
        } catch (e) { console.error(e); }
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(THEME.SCENE.BACKGROUND);
        this.scene.fog = new THREE.Fog(THEME.SCENE.FOG_COLOR, THEME.SCENE.FOG_NEAR, THEME.SCENE.FOG_FAR);

        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 1000);
        this.camera.position.copy(THEME.CAMERA.OVERVIEW.pos);
        this.camera.lookAt(THEME.CAMERA.OVERVIEW.look);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        document.body.appendChild(this.renderer.domElement);
        this.scene.add(this.worldGroup);
        
        const ambient = new THREE.AmbientLight(THEME.LIGHTS.AMBIENT_COLOR, THEME.LIGHTS.AMBIENT_INTENSITY);
        const spot = new THREE.SpotLight(THEME.LIGHTS.SPOT_COLOR, THEME.LIGHTS.SPOT_INTENSITY);
        spot.position.set(THEME.LIGHTS.SPOT_POS.x, THEME.LIGHTS.SPOT_POS.y, THEME.LIGHTS.SPOT_POS.z);
        spot.castShadow = true;
        this.scene.add(ambient, spot);
    }

    setupTurntable() {
        const baseGeo = new THREE.BoxGeometry(10, 1, 8);
        const baseMat = new THREE.MeshStandardMaterial({ color: THEME.PLAYER.BASE_COLOR, roughness: 0.2 });
        this.turntableBase = new THREE.Mesh(baseGeo, baseMat);
        this.turntableBase.position.y = -0.5;

        const platterGeo = new THREE.CylinderGeometry(3.4, 3.4, 0.2, 64);
        const platterMat = new THREE.MeshStandardMaterial({ color: THEME.PLAYER.PLATTER_COLOR, metalness: 0.5 });
        this.platter = new THREE.Mesh(platterGeo, platterMat);
        this.platter.position.y = 0.2;

        const pivotGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
        const chromeMat = new THREE.MeshStandardMaterial({ color: THEME.PLAYER.CHROME_COLOR, metalness: 0.9, roughness: 0.1 });
        const pivot = new THREE.Mesh(pivotGeo, chromeMat);
        pivot.position.set(4, 0.5, -3);

        this.toneArmGroup = new THREE.Group();
        this.toneArmGroup.position.set(4, 1, -3);
        
        const armBarGeo = new THREE.BoxGeometry(0.2, 0.2, 6);
        const armBar = new THREE.Mesh(armBarGeo, chromeMat);
        armBar.position.set(0, 0, 2); 
        
        const headGeo = new THREE.BoxGeometry(0.5, 0.5, 1);
        const head = new THREE.Mesh(headGeo, chromeMat);
        head.position.set(0, -0.2, 5); 

        this.toneArmGroup.add(armBar, head);
        this.toneArmGroup.rotation.y = THEME.PLAYER.ARM_REST_ANGLE; 

        this.playerGroup.add(this.turntableBase, this.platter, pivot, this.toneArmGroup);
        this.playerGroup.visible = false; 
    }

    setupWebsocket() {
        this.socket = new WebSocket("ws://127.0.0.1:8000/ws");
        this.socket.onopen = () => console.log("WS Open");
        this.socket.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if(data.status === "playing") {
                this.ui.status.innerText = "Playing";
                this.ui.trackInfo.innerText = `${data.artist} - ${data.track}`;
                this.ui.trackInfo.style.color = "#44aa88";
            } else if (data.status === "error") {
                this.ui.trackInfo.innerText = `Error: ${data.message}`;
                this.ui.trackInfo.style.color = "red";
            }
        };
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
        });
        window.addEventListener('wheel', (e) => {
            if (this.state === STATES.BROWSE) {
                this.scrollTarget += e.deltaY * THEME.DIGGING.SCROLL_SPEED;
                this.scrollTarget = Math.max(0, Math.min(this.scrollTarget, this.browseMeshes.length - 1));
            }
        });

        window.addEventListener('click', () => this.handleClick());
        this.ui.backZone.addEventListener('click', () => this.goBack());

        document.getElementById('btn-play').onclick = () => this.togglePlayback();
        document.getElementById('btn-stop').onclick = () => this.stopPlayback();
        document.getElementById('vol-slider').oninput = (e) => {
            if(this.socket) this.socket.send(JSON.stringify({action:"VOLUME", payload:{value: e.target.value}}));
        };
    }

    setupGUI() {
        this.gui = new GUI({ title: 'Theme Controls' });
        const camFolder = this.gui.addFolder('Camera');
        camFolder.add(this.camera.position, 'x').listen();
        camFolder.add(this.camera.position, 'y').listen();
        camFolder.add(this.camera.position, 'z').listen();
        camFolder.add({ save: () => this.saveDebugConfig() }, 'save').name("Save Cam Position");
    }

    async loadDebugConfig() {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (data.CAMERA) {
            Object.assign(THEME.CAMERA, data.CAMERA);
            for(let key in THEME.CAMERA) {
                THEME.CAMERA[key].pos = new THREE.Vector3(...Object.values(THEME.CAMERA[key].pos));
                THEME.CAMERA[key].look = new THREE.Vector3(...Object.values(THEME.CAMERA[key].look));
            }
        }
    }

    async saveDebugConfig() {
        let stateKey = Object.keys(STATES).find(key => STATES[key] === this.state);
        if (stateKey) THEME.CAMERA[stateKey].pos.copy(this.camera.position);
        await fetch('/api/config', { method: 'POST', body: JSON.stringify({ CAMERA: THEME.CAMERA }) });
        alert("Saved current camera angle for state: " + stateKey);
    }

    async loadLibrary() {
        const res = await fetch('/api/library');
        const data = await res.json();
        
        this.crates = [];
        for (let i = 0; i < data.length; i += THEME.CRATE.SIZE) {
            const chunk = data.slice(i, i + THEME.CRATE.SIZE);
            if (chunk.length === 0) continue;
            const label = `${chunk[0].artist[0].toUpperCase()} - ${chunk[chunk.length-1].artist[0].toUpperCase()}`;
            this.crates.push({ label: label, count: chunk.length, albums: chunk });
        }
        this.enterOverview();
    }

    createTracklistTexture(tracks) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = THEME.GATEFOLD.INNER_BG_COLOR;
        ctx.fillRect(0, 0, 1024, 1024);
        ctx.fillStyle = THEME.GATEFOLD.HEADER_COLOR;
        ctx.font = THEME.GATEFOLD.HEADER_FONT;
        ctx.textAlign = 'center';
        ctx.fillText("TRACKLIST", 512, 100);
        ctx.fillStyle = THEME.GATEFOLD.TEXT_COLOR;
        ctx.font = THEME.GATEFOLD.LIST_FONT;
        let y = 200;
        tracks.forEach((t, i) => {
            if(y > 950) return;
            const dur = t.duration_str || "--:--";
            ctx.fillText(`${i+1}. ${t.title} - ${dur}`, 512, y);
            y += 60;
        });
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }

    // --- STATES ---

    clearWorld() {
        this.crateGroup.visible = (this.state === STATES.BROWSE);
        this.inspectGroup.visible = (this.state === STATES.INSPECT);
        this.playerGroup.visible = (this.state === STATES.PLAYER);
        this.worldGroup.children.forEach(c => {
            if(c.userData.type === 'crate') c.visible = (this.state === STATES.OVERVIEW);
        });
        if(this.state !== STATES.PLAYER) this.ui.playerControls.classList.add('hidden');
    }

    moveCamera(targetCfg) {
        new TWEEN.Tween(this.camera.position)
            .to(targetCfg.pos, 1500)
            .easing(TWEEN.Easing.Cubic.InOut)
            .onUpdate(() => this.camera.lookAt(targetCfg.look))
            .start();
    }

    // STATE 0: OVERVIEW
    enterOverview() {
        this.state = STATES.OVERVIEW;
        this.clearWorld();
        this.ui.title.innerText = "Vinyl Collection";
        this.ui.backZone.classList.add('hidden');
        this.moveCamera(THEME.CAMERA.OVERVIEW);

        if(this.worldGroup.children.filter(c => c.userData.type === 'crate').length === 0) {
            const geo = new THREE.BoxGeometry(THEME.CRATE.WIDTH, THEME.CRATE.HEIGHT, THEME.CRATE.DEPTH); 
            const mat = new THREE.MeshStandardMaterial({ color: THEME.CRATE.COLOR }); 
            const cols = 5;
            this.crates.forEach((crate, i) => {
                const mesh = new THREE.Mesh(geo, mat);
                const x = (i % cols) * THEME.CRATE.SPACING_X - ((cols * THEME.CRATE.SPACING_X)/2) + 6;
                const z = Math.floor(i / cols) * THEME.CRATE.SPACING_Z;
                mesh.position.set(x, 0, -z);
                mesh.userData = { type: 'crate', index: i, info: crate };
                this.worldGroup.add(mesh);
            });
        }
    }

    // STATE 1: BROWSE
    enterBrowse(crateIndex) {
        this.state = STATES.BROWSE;
        this.activeCrateIndex = crateIndex;
        this.clearWorld();
        this.ui.backZone.classList.remove('hidden');
        this.moveCamera(THEME.CAMERA.BROWSE);
        
        if(this.crateGroup.children.length === 0) {
             const crate = this.crates[crateIndex];
             this.ui.title.innerText = crate.label;
             const loader = new THREE.TextureLoader();
             crate.albums.forEach((album, i) => {
                const thickness = album.type === "Single" ? THEME.DIGGING.SINGLE_THICKNESS : THEME.DIGGING.ALBUM_THICKNESS;
                const tex = loader.load(album.cover_url);
                tex.colorSpace = THREE.SRGBColorSpace;
                const mat = new THREE.MeshBasicMaterial({map:tex});
                const matEdge = new THREE.MeshBasicMaterial({color: THEME.DIGGING.SLEEVE_COLOR});
                const mesh = new THREE.Mesh(new THREE.BoxGeometry(10,10,thickness), [matEdge,matEdge,matEdge,matEdge,mat,matEdge]);
                mesh.position.set(0, 5, -i*THEME.DIGGING.SPACING);
                mesh.userData = {type:'album', data:album, index:i};
                this.crateGroup.add(mesh);
                this.browseMeshes.push(mesh);
             });
        }
    }

    // STATE 2: INSPECT
    enterInspect(album) {
        this.state = STATES.INSPECT;
        this.activeAlbum = album;
        this.clearWorld();
        this.ui.title.innerText = album.title;
        this.moveCamera(THEME.CAMERA.INSPECT);

        while(this.inspectGroup.children.length > 0) this.inspectGroup.remove(this.inspectGroup.children[0]);

        const tex = new THREE.TextureLoader().load(album.cover_url);
        tex.colorSpace = THREE.SRGBColorSpace;
        
        const allTracks = album.discs.flatMap(d => d.tracks);
        const innerTex = this.createTracklistTexture(allTracks);
        
        const panelGeo = new THREE.BoxGeometry(10, 10, 0.2);
        const matCover = new THREE.MeshBasicMaterial({ map: tex });
        const matInner = new THREE.MeshBasicMaterial({ map: innerTex });
        const matEdge = new THREE.MeshBasicMaterial({ color: 0x111111 });

        const left = new THREE.Mesh(panelGeo, [matEdge, matEdge, matEdge, matEdge, matInner, matCover]);
        left.position.set(-5, 0, 0);
        const right = new THREE.Mesh(panelGeo, [matEdge, matEdge, matEdge, matEdge, matInner, matCover]);
        right.position.set(5, 0, 0);
        
        left.rotation.y = Math.PI; 
        left.position.set(0,0,-0.1); 
        right.position.set(0,0,0);
        
        this.inspectGroup.add(left, right);
        
        new TWEEN.Tween(left.rotation).to({ y: 0 }, THEME.GATEFOLD.OPEN_DURATION).easing(TWEEN.Easing.Cubic.Out).start();
        new TWEEN.Tween(left.position).to({ x: -5, z: 0 }, THEME.GATEFOLD.OPEN_DURATION).easing(TWEEN.Easing.Cubic.Out).start();
        new TWEEN.Tween(right.position).to({ x: 5 }, THEME.GATEFOLD.OPEN_DURATION).easing(TWEEN.Easing.Cubic.Out).start();

        const discGeo = new THREE.CylinderGeometry(3.3, 3.3, 0.05, 64);
        const discMat = new THREE.MeshStandardMaterial({ color: THEME.PLAYER.DISC_COLOR });
        const labelGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.06, 32);
        const labelMat = new THREE.MeshBasicMaterial({ map: tex });

        album.discs.forEach((d, i) => {
             const g = new THREE.Group();
             g.add(new THREE.Mesh(discGeo, discMat), new THREE.Mesh(labelGeo, labelMat));
             g.children[0].rotation.x = Math.PI/2;
             g.children[1].rotation.x = Math.PI/2;
             g.position.set(0,0,-0.5);
             g.visible = false;
             g.userData = { type: 'action_play', discIndex: i };
             this.inspectGroup.add(g);
             
             let tx = (i===0)? -5 : (i===1)? 5 : (i-2)*7;
             let ty = (i>1)? -11 : 0;
             
             setTimeout(() => {
                 g.visible = true;
                 new TWEEN.Tween(g.position).to({x:tx, y:ty, z:0.5}, 800).start();
             }, THEME.GATEFOLD.OPEN_DURATION + (i*THEME.GATEFOLD.DISC_FLY_DELAY));
        });
    }

    // STATE 4: PLAYER
    enterPlayer(discIndex) {
        this.state = STATES.PLAYER;
        this.clearWorld();
        this.moveCamera(THEME.CAMERA.PLAYER);
        this.ui.playerControls.classList.remove('hidden');
        this.ui.trackInfo.innerText = "Loading Record...";
        
        this.playerReady = false; 

        if (!this.activeAlbum || !this.activeAlbum.discs || !this.activeAlbum.discs[discIndex]) return;
        this.activeDiscData = this.activeAlbum.discs[discIndex];
        
        if(this.activeDiscMesh) this.playerGroup.remove(this.activeDiscMesh);

        const tex = new THREE.TextureLoader().load(this.activeAlbum.cover_url);
        tex.colorSpace = THREE.SRGBColorSpace;
        const discGeo = new THREE.CylinderGeometry(3.3, 3.3, 0.05, 64);
        const discMat = new THREE.MeshStandardMaterial({ color: THEME.PLAYER.DISC_COLOR, roughness: 0.4 });
        const labelGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.06, 32);
        const labelMat = new THREE.MeshBasicMaterial({ map: tex });
        
        this.activeDiscMesh = new THREE.Group();
        this.activeDiscMesh.add(new THREE.Mesh(discGeo, discMat), new THREE.Mesh(labelGeo, labelMat));
        this.activeDiscMesh.userData = { type: 'vinyl_surface' }; 
        this.activeDiscMesh.children.forEach(c => c.userData = { type: 'vinyl_surface' });

        this.activeDiscMesh.position.set(-10, 5, 0); 
        this.playerGroup.add(this.activeDiscMesh);

        new TWEEN.Tween(this.activeDiscMesh.position)
            .to({ x: 0, y: 0.4, z: 0 }, THEME.PLAYER.ANIM_DISC_FLY)
            .easing(TWEEN.Easing.Cubic.Out)
            .onComplete(() => {
                // FIXED EASING HERE
                new TWEEN.Tween(this.toneArmGroup.rotation)
                    .to({ y: THEME.PLAYER.ARM_PLAY_ANGLE }, THEME.PLAYER.ANIM_ARM_MOVE)
                    .easing(TWEEN.Easing.Quadratic.Out) 
                    .onComplete(() => {
                        this.playerReady = true; 
                        if(this.activeDiscData.tracks.length > 0) {
                            const track = this.activeDiscData.tracks[0];
                            if(this.socket) {
                                this.socket.send(JSON.stringify({
                                    action: "PLAY",
                                    payload: { 
                                        file_path: track.file_path, 
                                        title: track.title, 
                                        artist: this.activeAlbum.artist 
                                    }
                                }));
                            }
                        }
                    })
                    .start();
            })
            .start();
    }

    togglePlayback() {
        if(this.socket) this.socket.send(JSON.stringify({action: "PAUSE"}));
    }
    stopPlayback() {
        if(this.socket) this.socket.send(JSON.stringify({action: "STOP"}));
        new TWEEN.Tween(this.toneArmGroup.rotation).to({ y: THEME.PLAYER.ARM_REST_ANGLE }, 1000).start();
        this.playerReady = false;
    }

    animate(time) {
        requestAnimationFrame((t) => this.animate(t));
        TWEEN.update(time);
        
        if (this.state === STATES.BROWSE) {
            this.scrollCurrent += (this.scrollTarget - this.scrollCurrent) * 0.1;
            this.browseMeshes.forEach((mesh, i) => {
                const diff = i - this.scrollCurrent;
                let z, y, rx;
                if (diff < -0.2) { z = (diff*1.5)+2; rx = -Math.PI/2.5; y=3; }
                else if (diff > 0.2) { z = -diff*THEME.DIGGING.SPACING; rx = -0.1; y=5; }
                else { z=2; y=5+THEME.DIGGING.LIFT_HEIGHT; rx=0; }
                mesh.position.z += (z-mesh.position.z)*0.1;
                mesh.position.y += (y-mesh.position.y)*0.1;
                mesh.rotation.x += (rx-mesh.rotation.x)*0.1;
            });
        }

        if(this.state === STATES.PLAYER && this.activeDiscMesh) {
            this.activeDiscMesh.rotation.y -= THEME.PLAYER.ROTATION_SPEED;
        }
        
        this.renderer.render(this.scene, this.camera);
    }

    handleClick() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        let objects = [];
        if(this.state === STATES.OVERVIEW) objects = this.worldGroup.children;
        else if(this.state === STATES.BROWSE) objects = this.crateGroup.children;
        else if(this.state === STATES.INSPECT) objects = this.inspectGroup.children;
        else if(this.state === STATES.PLAYER) objects = this.activeDiscMesh ? this.activeDiscMesh.children : [];

        const intersects = this.raycaster.intersectObjects(objects, true);
        if (intersects.length === 0) return;
        
        let obj = intersects[0].object;
        let point = intersects[0].point;
        
        while(obj.parent && !obj.userData.type) obj = obj.parent;
        const type = obj.userData.type;

        if (this.state === STATES.OVERVIEW && type === 'crate') {
            this.enterBrowse(obj.userData.index);
        } 
        else if (this.state === STATES.BROWSE && type === 'album') {
            const idx = obj.userData.index;
            if (Math.abs(idx - this.scrollCurrent) < 1.0) this.enterInspect(obj.userData.data);
            else this.scrollTarget = idx;
        } 
        else if (this.state === STATES.INSPECT && type === 'action_play') {
            this.enterPlayer(obj.userData.discIndex);
        }
        else if (this.state === STATES.PLAYER && type === 'vinyl_surface') {
            if (!this.playerReady) return;

            const dx = point.x - this.activeDiscMesh.position.x;
            const dz = point.z - this.activeDiscMesh.position.z;
            const radius = Math.sqrt(dx*dx + dz*dz);
            const rMax = THEME.PLAYER.DISC_RADIUS_OUTER;
            const rMin = THEME.PLAYER.DISC_RADIUS_INNER;
            
            if (radius <= rMax && radius >= rMin) {
                const progress = (rMax - radius) / (rMax - rMin);
                const track = this.activeDiscData.tracks[0];
                const dur = track.duration || 180;
                const seekTime = dur * progress;
                if(this.socket) this.socket.send(JSON.stringify({action: "SEEK", payload: { time: seekTime }}));
            }
        }
    }

    goBack() {
        if (this.state === STATES.PLAYER) {
            this.stopPlayback();
            this.state = STATES.INSPECT;
            this.moveCamera(THEME.CAMERA.INSPECT);
        } else if (this.state === STATES.INSPECT) {
            this.enterBrowse(this.activeCrateIndex);
        } else if (this.state === STATES.BROWSE) {
            this.enterOverview();
        }
    }
}

const app = new VinylApp();