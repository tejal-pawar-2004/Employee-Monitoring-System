class LiveStreamManager {
    constructor() {
        this.ws = null;
        this.pc = null;
        this.activeUserId = null;
        this.imageEl = document.getElementById('feedImage');
        this.videoEl = document.getElementById('feedVideo');
        this.placeholderEl = document.getElementById('feedPlaceholder');
        this.loadingEl = document.getElementById('feedLoading');
        this.titleEl = document.getElementById('liveFeedTitle');
        this.reconnectInterval = null;
        this.isManuallyStopped = false;
        this.rtcConfig = null;
        this.useTurnFallback = false;
        this.fallbackTimeout = null;

        // NEW: Toggle State
        this.isStreaming = false;
        this.streamBtn = document.querySelector('.for-live-stream');
    }

    start(userId) {
        if (this.isStreaming && this.activeUserId === userId) {
            this.stop();
            return;
        }
        if (this.isStreaming && this.activeUserId !== userId) {
            this.stop();
        }

        this.activeUserId = userId;
        this.isManuallyStopped = false;
        this.isStreaming = true;
        this.useTurnFallback = false;
        if (this.fallbackTimeout) {
            clearTimeout(this.fallbackTimeout);
            this.fallbackTimeout = null;
        }

        this._updateButtonState(true);

        if (typeof updateLiveFeed === 'function') {
            updateLiveFeed('loading');
        } else if (this.loadingEl) {
            this.loadingEl.classList.remove('hidden');
            this.loadingEl.style.display = 'flex';
        }

        if (window.api) {
            window.api.startLiveStream(userId).then(resp => {
                console.log("Live stream trigger accepted by backend:", resp);
            }).catch(err => {
                console.error("Failed to trigger live stream start on backend:", err);
                const msg = `START TRIGGER FAILED: ${err.message || 'Unknown error'}.`;
                if (this.titleEl) this.titleEl.textContent = msg;
                alert(msg);
            });
        }

        this._connect();
    }

    _connect() {
        if (!this.activeUserId || this.isManuallyStopped) return;

        if (typeof updateLiveFeed === 'function') {
            updateLiveFeed('loading');
        } else if (this.loadingEl) {
            this.loadingEl.classList.remove('hidden');
            this.loadingEl.style.display = 'flex';
        }

        if (this.titleEl) this.titleEl.textContent = 'Connecting to Live Stream...';

        let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        let host = window.location.host || 'localhost:8000';

        if (window.api && window.api.baseUrl) {
            try {
                const url = new URL(window.api.baseUrl);
                host = url.host;
                protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            } catch (e) {
                console.error("Failed to parse API base URL for stream:", e);
            }
        }

        const token = localStorage.getItem('access_token');
        const wsUrl = `${protocol}//${host}/api/v1/ws/ws?role=viewer&room_id=${this.activeUserId}&token=${token}`;

        console.log(`Connecting signaling websocket to: ${wsUrl}`);

        try {
            this.ws = new WebSocket(wsUrl);
            this.ws.binaryType = 'blob';
        } catch (e) {
            console.error("WS constructor error:", e);
        }

        this.ws.onopen = () => {
            console.log("Signaling WebSocket Connected");
            if (this.titleEl) {
                this.titleEl.innerHTML = '<i class="fas fa-video text-emerald-500 mr-2 animate-pulse"></i> LIVE STREAMING (P2P)';
            }
            this._initializePeerConnection();
        };

        this.ws.onmessage = async (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'rtc_config') {
                    console.log("Received RTC Configuration from server");
                    this.rtcConfig = message.iceServers;
                    // If we haven't initialized PC yet, _onopen will do it. 
                    // If we did, we might want to update it if fallback hasn't happened.
                } else if (message.type === 'answer') {
                    console.log("Received WebRTC Answer");
                    if (this.pc) await this.pc.setRemoteDescription(new RTCSessionDescription(message));
                } else if (message.type === 'ice_candidate') {
                    if (this.pc) {
                        await this.pc.addIceCandidate(new RTCIceCandidate({
                            candidate: message.candidate,
                            sdpMid: message.sdpMid,
                            sdpMLineIndex: message.sdpMLineIndex
                        }));
                    }
                }
            } catch (err) {
                console.error("Error handling signaling message:", err);
            }
        };

        this.ws.onclose = (event) => {
            console.log("Signaling WebSocket Closed");
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


        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }


        this.activeUserId = null;


        // UI Reset
        if (this.imageEl && this.imageEl.src.startsWith('blob:')) {
            URL.revokeObjectURL(this.imageEl.src);
            this.imageEl.src = '';
        }
        if (this.videoEl) {
            this.videoEl.srcObject = null;
            this.videoEl.style.display = 'none';
        }


        this.imageEl.style.display = 'none';
        this.placeholderEl.style.display = 'block';
        if (this.loadingEl) {
            this.loadingEl.classList.add('hidden');
            this.loadingEl.style.display = 'none';
        }
        if (this.titleEl) this.titleEl.textContent = 'Live Feed';
    }


    _initializePeerConnection() {
        if (this.pc) {
            this.pc.close();
        }

        let configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };

        if (this.useTurnFallback && this.rtcConfig) {
            console.log("Using TURN relay fallback configuration");
            configuration.iceServers = this.rtcConfig;
        }

        this.pc = new RTCPeerConnection(configuration);
        console.log("RTCPeerConnection initialized. Mode:", this.useTurnFallback ? "TURN Fallback" : "STUN Only");

        this._setupPeerConnectionHandlers();

        if (!this.useTurnFallback) {
            if (this.fallbackTimeout) clearTimeout(this.fallbackTimeout);
            this.fallbackTimeout = setTimeout(() => {
                if (this.pc && this.pc.connectionState !== 'connected') {
                    console.warn("STUN connection timed out after 10s. Falling back to TURN.");
                    this._triggerFallback();
                }
            }, 10000);
        }

        // Create Offer
        this.pc.addTransceiver('video', { direction: 'recvonly' });
        this._createAndSendOffer();
    }

    _setupPeerConnectionHandlers() {
        this.pc.ontrack = (event) => {
            console.log("SUCCESS: Received remote video track");
            const vid = this.videoEl;
            if (vid) {
                vid.srcObject = event.streams[0];
                vid.play().catch(e => console.warn("play() failed:", e));
                
                // Hide other content and show video
                if (typeof updateLiveFeed === 'function') {
                    // This will reset others but might hide video, so we handle video next
                    updateLiveFeed('live_active'); 
                }
                
                this.imageEl.classList.add('hidden');
                
                vid.classList.remove('hidden');
                
                if (this.loadingEl) {
                    this.loadingEl.classList.add('hidden');
                }
            }
        };

        this.pc.onicecandidate = (event) => {
            if (event.candidate && this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'ice_candidate',
                    candidate: event.candidate.candidate,
                    sdpMid: event.candidate.sdpMid,
                    sdpMLineIndex: event.candidate.sdpMLineIndex
                }));
            }
        };

        this.pc.onconnectionstatechange = () => {
            console.log("WebRTC Connection State Change:", this.pc.connectionState);
            if (this.pc.connectionState === 'connected') {
                if (this.fallbackTimeout) {
                    clearTimeout(this.fallbackTimeout);
                    this.fallbackTimeout = null;
                }
                if (this.titleEl) {
                    this.titleEl.innerHTML = this.useTurnFallback 
                        ? '<i class="fas fa-video text-yellow-500 mr-2 animate-pulse"></i> LIVE STREAMING (RELAY)'
                        : '<i class="fas fa-video text-emerald-500 mr-2 animate-pulse"></i> LIVE STREAMING (P2P)';
                }
            } else if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
                if (!this.useTurnFallback && this.pc.connectionState === 'failed') {
                    console.warn("WebRTC connection failed. Triggering fallback.");
                    this._triggerFallback();
                } else if (this.pc.connectionState === 'failed') {
                    if (this.titleEl) this.titleEl.textContent = 'Connection Blocked by Firewall.';
                }
            }
        };

        this.pc.oniceconnectionstatechange = () => {
            if (this.pc.iceConnectionState === 'failed' && !this.useTurnFallback) {
                console.warn("ICE connection failed. Triggering fallback.");
                this._triggerFallback();
            }
        };
    }

    async _createAndSendOffer() {
        try {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: offer.type,
                    sdp: offer.sdp
                }));
                console.log("Sent WebRTC Offer");
            }
        } catch (err) {
            console.error("Error creating WebRTC offer:", err);
        }
    }

    async _triggerFallback() {
        if (this.useTurnFallback) return;
        this.useTurnFallback = true;
        if (this.fallbackTimeout) {
            clearTimeout(this.fallbackTimeout);
            this.fallbackTimeout = null;
        }
        console.log("Restarting WebRTC with TURN credentials...");
        this._initializePeerConnection();
    }

    _updateButtonState(isStreaming) {
        if (!this.streamBtn) this.streamBtn = document.querySelector('.for-live-stream');
        if (!this.streamBtn) return;
        const textNodes = Array.from(this.streamBtn.querySelectorAll('span')).filter(s => s.innerText.trim() !== '');
        const text = textNodes[textNodes.length - 1];

        if (isStreaming) {
            if (text) text.innerText = 'Stop Live Stream';
            this.streamBtn.classList.add('bg-gray-900', 'text-white', 'animate-pulse');
            this.streamBtn.classList.remove('bg-emerald-600');
        } else {
            if (text) text.innerText = 'Start Live Stream';
            this.streamBtn.classList.remove('bg-gray-900', 'text-white', 'animate-pulse');
            this.streamBtn.classList.add('bg-emerald-600', 'text-white');
        }
    }
}

window.liveStreamManager = new LiveStreamManager();