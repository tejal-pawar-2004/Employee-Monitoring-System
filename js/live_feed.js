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

        // Show the spinner immediately upon initialization using the global UI updater
        if (typeof updateLiveFeed === 'function') {
            updateLiveFeed('loading');
        } else if (this.loadingEl) {
            this.loadingEl.classList.remove('hidden');
            this.loadingEl.style.display = 'flex';
        }

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

        // ALWAYS show loading state immediately
        if (typeof updateLiveFeed === 'function') {
            updateLiveFeed('loading');
        } else if (this.loadingEl) {
            this.loadingEl.classList.remove('hidden');
            this.loadingEl.style.display = 'flex';
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

        // THE PURPOSE: Connect to the new WebRTC signaling endpoint to exchange connection details with the desktop agent.
        // THE REPLACEMENT: Replaced the old WebSocket connection to `/admin/{userId}` that used to receive continuous base64 images from the server.
        const token = localStorage.getItem('access_token');
        const wsUrl = `${protocol}//${host}/api/v1/ws/ws?role=viewer&room_id=${this.activeUserId}&token=${token}`;

        if (window.api) window.api.debugLog(`Attempting WS to: ${wsUrl}`);

        console.log(`Connecting signaling websocket to: ${wsUrl}`);

        try {
            this.ws = new WebSocket(wsUrl);
            // We use text for JSON signaling
            this.ws.binaryType = 'blob';
        } catch (e) {
            if (window.api) window.api.debugLog(`WS constructor error: ${e.message}`);
        }

        this.ws.onopen = async () => {
            if (window.api) window.api.debugLog(`Signaling WS Opened for ${this.activeUserId}`);
            console.log("Signaling WebSocket Connected");
            // Wait for video frame to actually render before hiding loading spinner
            const hideLoadingSpinner = () => {
                if (this.loadingEl) {
                    this.loadingEl.classList.add('hidden');
                    this.loadingEl.style.display = 'none';
                }
            };
            this.videoEl.onloadeddata = hideLoadingSpinner;
            this.videoEl.onplaying = hideLoadingSpinner;
            this.videoEl.onplay = hideLoadingSpinner;
            this.placeholderEl.style.display = 'none';
            // Hide image fallback, show video for WebRTC
            this.imageEl.style.display = 'none';
            this.videoEl.style.display = 'block';
            this.videoEl.classList.remove('hidden');
            window.currentLiveFeedMode = 'live';

            if (this.titleEl) {
                this.titleEl.innerHTML = '<i class="fas fa-video text-emerald-500 mr-2 animate-pulse"></i> LIVE STREAMING (P2P)';
            }

            // THE PURPOSE: Create the built-in browser engine for peer-to-peer video streaming (WebRTC). It uses STUN/TURN servers to find the best direct path to the desktop agent.
            // THE REPLACEMENT: Completely replaces the old method of assigning base64 strings to an image element's `.src` property. This provides native video playback and is much smoother.
            const configuration = {
                iceServers: [
                    {
                        urls: 'stun:stun.l.google.com:19302' // Free public STUN server
                    },
                    {
                        urls: 'turn:turn.example.com:3478', // Replace with valid TURN server for production
                        username: 'your_turn_username',
                        credential: 'your_turn_password'
                    }
                ]
            };

            this.pc = new RTCPeerConnection(configuration);

            // Handle incoming tracks (video stream)
            this.pc.ontrack = (event) => {
                console.log("Received remote track:", event.streams[0]);

                const attemptPlay = () => {
                    const vid = document.getElementById('feedVideo') || this.videoEl;
                    if (vid) {
                        if (vid.srcObject !== event.streams[0]) {
                            vid.srcObject = event.streams[0];
                        }
                        vid.play().then(() => {
                            if (this.loadingEl) {
                                this.loadingEl.classList.add('hidden');
                                this.loadingEl.style.display = 'none';
                            }
                        }).catch(e => console.warn("play() failed:", e));
                    } else {
                        setTimeout(attemptPlay, 100);
                    }
                };
                attemptPlay();

                // Fallback: hide immediately when track arrives, just in case DOM events fail
                if (this.loadingEl) {
                    this.loadingEl.classList.add('hidden');
                    this.loadingEl.style.display = 'none';
                }

                if (!this.isStreaming) {
                    this.isStreaming = true;
                    this._updateButtonState(true);
                }
            };

            // Network Gathering: Trickle ICE Candidate
            this.pc.onicecandidate = (event) => {
                if (event.candidate) {
                    this.ws.send(JSON.stringify({
                        type: 'ice_candidate',
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid,
                        sdpMLineIndex: event.candidate.sdpMLineIndex
                    }));
                }
            };

            this.pc.onconnectionstatechange = () => {
                console.log("WebRTC Connection State:", this.pc.connectionState);
                if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
                    if (this.titleEl) this.titleEl.textContent = 'Stream Disconnected/Failed.';
                }
            };

            this.pc.oniceconnectionstatechange = () => {
                console.log("ICE Connection State:", this.pc.iceConnectionState);
                if (this.pc.iceConnectionState === 'disconnected' || this.pc.iceConnectionState === 'failed') {
                    if (this.titleEl) this.titleEl.textContent = 'Connection Blocked by Firewall.';
                    // Show error overlay
                    if (this.placeholderEl) {
                        this.placeholderEl.style.display = 'block';
                        this.placeholderEl.innerHTML = `
                            <div class="text-center p-6 bg-red-900/40 rounded-2xl border border-red-500/50 backdrop-blur-md">
                                <i class="fas fa-shield-alt text-red-500 text-6xl mb-4 drop-shadow-lg"></i>
                                <h3 class="text-white font-bold text-lg mb-2">Connection Blocked by Firewall</h3>
                                <p class="text-red-200 text-xs font-semibold uppercase tracking-widest">(TURN Server Required)</p>
                            </div>
                        `;
                    }
                    if (this.videoEl) this.videoEl.style.display = 'none';
                    if (this.loadingEl) {
                        this.loadingEl.classList.add('hidden');
                        this.loadingEl.style.display = 'none';
                    }
                }
            };

            // The Viewer (Admin) is the initiator: Create Offer
            // We must add a transceiver to signal we want to receive video, 
            // since we are just receiving and not sending tracks initially.
            this.pc.addTransceiver('video', { direction: 'recvonly' });

            try {
                const offer = await this.pc.createOffer();
                await this.pc.setLocalDescription(offer);
                this.ws.send(JSON.stringify({
                    type: offer.type,
                    sdp: offer.sdp
                }));
                console.log("Sent WebRTC Offer");
            } catch (err) {
                console.error("Error creating WebRTC offer:", err);
            }
        };

        this.ws.onmessage = async (event) => {
            try {
                const message = JSON.parse(event.data);

                if (message.type === 'answer') {
                    console.log("Received WebRTC Answer");
                    await this.pc.setRemoteDescription(new RTCSessionDescription(message));
                } else if (message.type === 'ice_candidate') {
                    await this.pc.addIceCandidate(new RTCIceCandidate({
                        candidate: message.candidate,
                        sdpMid: message.sdpMid,
                        sdpMLineIndex: message.sdpMLineIndex
                    }));
                }
            } catch (err) {
                console.error("Error handling signaling message:", err, event.data);
            }
        };

        this.ws.onerror = (error) => {
            if (window.api) window.api.debugLog(`WS Error occurred`);
            console.error("Signaling WebSocket Error:", error);
            // Close will trigger onclose
        };

        this.ws.onclose = (event) => {
            if (window.api) window.api.debugLog(`WS Closed. Code: ${event.code}, Reason: ${event.reason}`);
            console.log("Signaling WebSocket Closed");
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