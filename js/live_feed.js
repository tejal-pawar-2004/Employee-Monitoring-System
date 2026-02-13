class LiveStreamManager {
    constructor() {
        this.ws = null;
        this.activeUserId = null;
        this.imageEl = document.getElementById('feedImage');
        this.placeholderEl = document.getElementById('feedPlaceholder');
        this.loadingEl = document.getElementById('feedLoading');
        this.titleEl = document.getElementById('liveFeedTitle');
        this.reconnectInterval = null;
        this.isManuallyStopped = false;

        // NEW: Toggle State
        this.isStreaming = false;
        // Cache button elements (assuming class .for-live-stream is unique/stable as per instructions)
        this.streamBtn = document.querySelector('.for-live-stream');
        // We'll update innerText, so no need to cache the span specifically unless we want to preserve icon 
        // The button has: <i ...></i> <span>Start Live Stream</span>
    }

    start(userId) {
        // TOGGLE LOGIC
        // If already streaming the same user, we act as STOP
        if (this.isStreaming && this.activeUserId === userId) {
            this.stop();
            return;
        }

        // If streaming a DIFFERENT user, we stop previous and start new (Switching users)
        if (this.isStreaming && this.activeUserId !== userId) {
            this.stop();
            // Fall through to start new
        }

        // START NEW STREAM
        this.activeUserId = userId;
        this.isManuallyStopped = false;
        this.isStreaming = true;

        // Update Button UI
        this._updateButtonState(true);

        // Notify backend to signal client
        if (window.api) {
            window.api.startLiveStream(userId).then(resp => {
                console.log("Live stream trigger accepted by backend:", resp);
            }).catch(err => {
                console.error("Failed to trigger live stream start on backend:", err);
                const msg = `START TRIGGER FAILED: ${err.message || 'Unknown error'}. Your server at ${window.api.baseUrl} might be outdated or unreachable.`;
                if (this.titleEl) this.titleEl.textContent = msg;
                alert(msg);
            });
        }

        this._connect();
    }

    _connect() {
        if (!this.activeUserId || this.isManuallyStopped) return;

        // Show loading state if not already showing image (avoid flickering on reconnect)
        if (this.imageEl.classList.contains('hidden')) {
            this.loadingEl.classList.remove('hidden');
        }

        if (this.titleEl) this.titleEl.textContent = 'Connecting to Live Stream...';

        let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        let host = 'localhost:8000';

        // Check if we are on localhost and force ws:
        if (host.includes('localhost') || host.includes('127.0.0.1')) {
            protocol = 'ws:';
        }

        // Try to get host from the main API client if it exists
        if (window.api && window.api.baseUrl) {
            try {
                const url = new URL(window.api.baseUrl);
                host = url.host;
                // Update protocol based on baseUrl
                protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            } catch (e) {
                console.error("Failed to parse API base URL for stream:", e);
            }
        } else if (window.location.protocol !== 'file:') {
            host = window.location.host;
            protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        }

        const token = localStorage.getItem('access_token');
        const wsUrl = `${protocol}//${host}/api/v1/ws/admin/${this.activeUserId}?token=${token}`;

        if (window.api) window.api.debugLog(`Attempting WS to: ${wsUrl}`);

        console.log(`Connecting to Stream: ${wsUrl}`);

        try {
            this.ws = new WebSocket(wsUrl);
            this.ws.binaryType = 'arraybuffer';
        } catch (e) {
            if (window.api) window.api.debugLog(`WS constructor error: ${e.message}`);
        }

        this.ws.onopen = () => {
            if (window.api) window.api.debugLog(`WS Opened for ${this.activeUserId}`);
            console.log("Stream WebSocket Connected");
            this.loadingEl.classList.add('hidden');
            this.placeholderEl.style.display = 'none';
            this.imageEl.style.display = 'block';
            this.imageEl.classList.remove('hidden');
            window.currentLiveFeedMode = 'live';

            if (this.titleEl) {
                this.titleEl.innerHTML = '<i class="fas fa-video text-emerald-500 mr-2 animate-pulse"></i> LIVE STREAMING';
            }
        };

        this.ws.onmessage = (event) => {
            const blob = new Blob([event.data], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);

            if (this.imageEl.src.startsWith('blob:')) {
                URL.revokeObjectURL(this.imageEl.src);
            }

            this.imageEl.src = url;
            this.imageEl.style.display = 'block';

            // Ensure UI is in sync (in case it drifted)
            if (!this.isStreaming) {
                this.isStreaming = true;
                this._updateButtonState(true);
            }
            window.currentLiveFeedMode = 'live';
        };

        this.ws.onerror = (error) => {
            if (window.api) window.api.debugLog(`WS Error occurred`);
            console.error("Stream WebSocket Error:", error);
            // Close will trigger onclose
        };

        this.ws.onclose = (event) => {
            if (window.api) window.api.debugLog(`WS Closed. Code: ${event.code}, Reason: ${event.reason}`);
            console.log("Stream WebSocket Closed");
            window.currentLiveFeedMode = 'reset';

            // If it was NOT manually stopped, it's an unexpected closure (or error)
            if (!this.isManuallyStopped) {
                this.isStreaming = false;
                this._updateButtonState(false);
                if (this.titleEl) this.titleEl.textContent = 'Stream Disconnected.';
            }
        };
    }

    stop() {
        this.isManuallyStopped = true;
        this.isStreaming = false;
        window.currentLiveFeedMode = 'reset';

        this._updateButtonState(false);

        // Notify backend to signal client
        if (window.api && this.activeUserId) {
            window.api.stopLiveStream(this.activeUserId).catch(err => {
                console.error("Failed to trigger live stream stop on backend:", err);
            });
        }

        if (this.reconnectInterval) {
            clearTimeout(this.reconnectInterval);
            this.reconnectInterval = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.activeUserId = null;

        // UI Reset
        if (this.imageEl && this.imageEl.src.startsWith('blob:')) {
            URL.revokeObjectURL(this.imageEl.src);
            this.imageEl.src = '';
        }

        this.imageEl.style.display = 'none';
        this.placeholderEl.style.display = 'block';
        this.loadingEl.classList.add('hidden');
        if (this.titleEl) this.titleEl.textContent = 'Live Feed';
    }

    _updateButtonState(isStreaming) {
        // Re-query in case DOM changed
        if (!this.streamBtn) this.streamBtn = document.querySelector('.for-live-stream');
        if (!this.streamBtn) return;

        const icon = this.streamBtn.querySelector('i');
        // Search for the span that is NOT empty (contains the text)
        const textNodes = Array.from(this.streamBtn.querySelectorAll('span')).filter(s => s.innerText.trim() !== '');
        const text = textNodes[textNodes.length - 1]; // Assume the last one is the primary text

        if (isStreaming) {
            if (text) text.innerText = 'Stop Live Stream';
            this.streamBtn.classList.add('bg-gray-900', 'text-white');
            this.streamBtn.classList.remove('bg-emerald-600', 'bg-emerald-600/10', 'text-emerald-600');
            this.streamBtn.classList.add('animate-pulse');
        } else {
            if (text) text.innerText = 'Start Live Stream';
            this.streamBtn.classList.remove('bg-gray-900', 'text-white', 'animate-pulse');
            this.streamBtn.classList.add('bg-emerald-600', 'text-white');
            this.streamBtn.classList.remove('bg-emerald-600/10', 'text-emerald-600');
        }
    }
}

window.liveStreamManager = new LiveStreamManager();