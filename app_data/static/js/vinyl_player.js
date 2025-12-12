import * as THREE from 'three';
import TWEEN from 'three/addons/libs/tween.module.js';
import { CONFIG } from './config.js';

const P_STATES = { EMPTY: 'EMPTY', LOADING: 'LOADING', READY: 'READY', PLAYING: 'PLAYING', PAUSED: 'PAUSED' };

export class VinylPlayer {
    constructor(scene, network, onDiscFinish) {
        this.scene = scene;
        this.network = network;
        this.onDiscFinish = onDiscFinish; 
        this.state = P_STATES.EMPTY;
        
        this.group = new THREE.Group();
        this.scene.add(this.group);

        this.discMesh = null;
        this.currentDiscData = null;
        this.currentArtist = "Unknown";
        this.currentTrackIndex = 0;
        this.playbackStartTime = 0; 
        this.trackOffset = 0; 
        
        this._buildTurntable();
    }

    _buildTurntable() {
        // ... (No changes to geometry building)
        const base = new THREE.Mesh(new THREE.BoxGeometry(11, 1, 9), new THREE.MeshStandardMaterial({ color: CONFIG.PLAYER.BASE_COLOR, roughness: 0.3 }));
        base.position.y = -0.5;
        this.group.add(base);

        this.platter = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 0.2, 64), new THREE.MeshStandardMaterial({ color: CONFIG.PLAYER.PLATTER_COLOR, metalness: 0.6 }));
        this.platter.position.y = 0.2;
        this.group.add(this.platter);

        const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5), new THREE.MeshStandardMaterial({ color: CONFIG.PLAYER.CHROME_COLOR, metalness: 0.8 }));
        pivot.position.set(4.5, 0, -3);
        this.group.add(pivot);

        this.toneArm = new THREE.Group();
        this.toneArm.position.set(4.5, 0.8, -3);
        
        const armBar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 7), new THREE.MeshStandardMaterial({ color: CONFIG.PLAYER.CHROME_COLOR, metalness: 0.8 }));
        armBar.position.z = 2.5; 
        const headShell = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.8), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        headShell.position.z = 6; headShell.position.y = -0.2;

        this.toneArm.add(armBar, headShell);
        this.toneArm.rotation.y = CONFIG.PLAYER.ANGLE_ARM_REST;
        this.group.add(this.toneArm);
        this.group.visible = false;
    }

    _createVinylTexture(coverTex, tracks) {
        // ... (Keep existing texture logic)
        const size = 1024;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const cx = size/2; const cy = size/2;

        ctx.fillStyle = '#050505';
        ctx.beginPath(); ctx.arc(cx, cy, size/2, 0, Math.PI*2); ctx.fill();

        ctx.strokeStyle = CONFIG.PLAYER.GROOVE_COLOR; 
        ctx.lineWidth = 1;
        for(let r=150; r<size/2 - 10; r+=3) { 
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
        }

        if (tracks && tracks.length > 0) {
            const totalDur = tracks.reduce((sum, t) => sum + (t.duration || 180), 0);
            let currentDur = 0;
            const rMax = size/2 - 10; 
            const rMin = 150;           
            ctx.strokeStyle = '#000000'; ctx.lineWidth = 4;
            tracks.forEach(t => {
                currentDur += (t.duration || 180);
                const progress = currentDur / totalDur;
                const r = rMax - (progress * (rMax - rMin));
                if (r > rMin) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke(); }
            });
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = 4;
        return tex;
    }

    loadDisc(discData, coverTexture, startPosition, artistName, instant = false) {
        if (this.state !== P_STATES.EMPTY) this.unloadDisc();
        this.state = P_STATES.LOADING;
        this.group.visible = true;
        this.currentDiscData = discData;
        this.currentArtist = artistName || "Unknown";

        const vinylTex = this._createVinylTexture(coverTexture, discData.tracks);
        this.discMesh = new THREE.Group();
        const discGeo = new THREE.CylinderGeometry(3.3, 3.3, 0.05, 64);
        const discMat = new THREE.MeshStandardMaterial({ map: vinylTex, roughness: 0.4, metalness: 0.1 });
        const vinylObj = new THREE.Mesh(discGeo, discMat);
        vinylObj.userData = { type: 'vinyl_surface' }; 
        this.discMesh.add(vinylObj);

        const labelGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.06, 32);
        const labelMat = new THREE.MeshBasicMaterial({ map: coverTexture });
        const labelObj = new THREE.Mesh(labelGeo, labelMat);
        labelObj.rotation.y = -Math.PI/2; 
        labelObj.userData = { type: 'vinyl_surface' };
        this.discMesh.add(labelObj);

        this.discMesh.position.copy(startPosition);
        this.group.add(this.discMesh);

        if (instant) {
            this.discMesh.position.set(0, 0.4, 0);
            this.toneArm.rotation.y = CONFIG.PLAYER.ANGLE_ARM_START;
            this.state = P_STATES.READY;
        } else {
            new TWEEN.Tween(this.discMesh.position)
                .to({ x: 0, y: 0.4, z: 0 }, CONFIG.PLAYER.ANIM_DISC_FLY)
                .easing(TWEEN.Easing.Cubic.Out)
                .onComplete(() => {
                    this.state = P_STATES.READY;
                    this.playTrack(0, 0); 
                })
                .start();
        }
    }

    unloadDisc() {
        this.stop();
        if(this.discMesh) { this.group.remove(this.discMesh); this.discMesh = null; }
        this.state = P_STATES.EMPTY;
        this.group.visible = false;
    }

    playTrack(trackIndex, timeOffset) {
        if (!this.currentDiscData || trackIndex < 0 || trackIndex >= this.currentDiscData.tracks.length) return;
        
        this.currentTrackIndex = trackIndex;
        this.trackOffset = timeOffset;
        this.playbackStartTime = Date.now();
        this.state = P_STATES.PLAYING;
        const track = this.currentDiscData.tracks[trackIndex];
        
        this.network.send("PLAY", { 
            file_path: track.file_path, 
            title: track.title, 
            artist: this.currentArtist, 
            start_time: timeOffset 
        });
    }

    nextTrack() {
        if(this.currentDiscData && this.currentTrackIndex < this.currentDiscData.tracks.length - 1) {
            this.playTrack(this.currentTrackIndex + 1, 0);
        }
    }

    prevTrack() {
        if(this.currentDiscData && this.currentTrackIndex > 0) {
            this.playTrack(this.currentTrackIndex - 1, 0);
        } else {
            this.playTrack(0, 0); 
        }
    }

    pause() {
        // FIX: If the player was stopped (READY), start from the beginning
        // instead of just sending a "resume" command.
        if (this.state === P_STATES.READY) {
            this.playTrack(this.currentTrackIndex, 0);
            return; 
        }

        // Standard toggle behavior for Playing/Paused states
        this.network.send("PAUSE");
        this.state = (this.state === P_STATES.PLAYING) ? P_STATES.PAUSED : P_STATES.PLAYING;
    }

    stop() {
        this.network.send("STOP");
        this.state = P_STATES.READY;
        // Added the missing closing brace below
        new TWEEN.Tween(this.toneArm.rotation).to({ y: CONFIG.PLAYER.ANGLE_ARM_REST }, 1000).start();
    }

    // NEW: Helper to get current playback time for UI
    getProgress() {
        if (this.state !== P_STATES.PLAYING && this.state !== P_STATES.PAUSED) return 0;
        
        let elapsed = this.trackOffset;
        if (this.state === P_STATES.PLAYING) {
            elapsed += (Date.now() - this.playbackStartTime) / 1000;
        }
        return elapsed;
    }

    update() {
        if (this.state === P_STATES.PLAYING && this.discMesh) {
            this.discMesh.rotation.y -= CONFIG.PLAYER.ROTATION_SPEED;
            
            // REMOVED: The logic that checks totalDur vs elapsed time and calls this.stop().
            // REASON: We want the server to dictate when the song is actually over.
            // However, we DO need to move the tonearm visually.
            
            const tracks = this.currentDiscData.tracks;
            let totalDur = 0;
            let currentDur = 0;
            
            tracks.forEach((t, i) => {
               const dur = t.duration || 180;
               totalDur += dur;
               if(i < this.currentTrackIndex) currentDur += dur; 
            });

            // For visual estimate only
            const elapsed = this.getProgress(); 
            currentDur += elapsed;
            
            const progress = Math.min(1, currentDur / totalDur);
            const angle = CONFIG.PLAYER.ANGLE_ARM_START + (progress * (CONFIG.PLAYER.ANGLE_ARM_END - CONFIG.PLAYER.ANGLE_ARM_START));
            this.toneArm.rotation.y += (angle - this.toneArm.rotation.y) * 0.1;
        }
    }

    handleInput(intersectPoint) {
        if (!this.discMesh || !this.currentDiscData) return;
        const localPoint = this.group.worldToLocal(intersectPoint.clone());
        const dx = localPoint.x - this.discMesh.position.x;
        const dz = localPoint.z - this.discMesh.position.z;
        const radius = Math.sqrt(dx*dx + dz*dz);

        const rMax = CONFIG.PLAYER.RADIUS_OUTER;
        const rMin = CONFIG.PLAYER.RADIUS_INNER;

        if (radius <= rMax && radius >= rMin) {
            const progress = (rMax - radius) / (rMax - rMin);
            const tracks = this.currentDiscData.tracks;
            const totalDur = tracks.reduce((sum, t) => sum + (t.duration || 180), 0);
            const targetTime = totalDur * progress;
            let acc = 0;
            for (let i = 0; i < tracks.length; i++) {
                const dur = tracks[i].duration || 180;
                if (targetTime <= acc + dur) {
                    this.playTrack(i, targetTime - acc);
                    return;
                }
                acc += dur;
            }
        }
    }
}