import { CONFIG } from './config.js';

export class NetworkManager {
    constructor(statusCallback) {
        this.socket = null;
        this.connected = false;
        this.statusCallback = statusCallback; // Updates UI text
        this.msgHandlers = [];
        this.connect();
    }

    connect() {
        this.socket = new WebSocket("ws://127.0.0.1:8000/ws");

        this.socket.onopen = () => {
            this.connected = true;
            if(CONFIG.DEBUG.LOG_NETWORK) console.log("[Net] Connected");
        };

        this.socket.onclose = () => {
            this.connected = false;
            this.statusCallback("Connection Lost. Retrying...");
            setTimeout(() => this.connect(), 3000); // Auto-retry
        };

        this.socket.onerror = (err) => {
            console.error("[Net] Error:", err);
        };

        this.socket.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                this.msgHandlers.forEach(h => h(data));
            } catch (err) {
                console.warn("[Net] Bad JSON:", e.data);
            }
        };
    }

    send(action, payload = {}) {
        if (!this.connected) {
            console.warn("[Net] Cannot send, disconnected.");
            return;
        }
        this.socket.send(JSON.stringify({ action, payload }));
    }

    onMessage(handler) {
        this.msgHandlers.push(handler);
    }
}