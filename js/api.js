class APIClient {
    constructor() {
        // this.baseUrl = "http://localhost:8000/api/v1";
        this.baseUrl = "https://empmonitoring.duckdns.org/api/v1";
        // this.baseUrl = "http://emp-monitoring.duckdns.org/api/v1";
        // this.baseUrl = "https://nonobstetrically-nonoptical-raymundo.ngrok-free.dev/api/v1";

        this.token = localStorage.getItem('access_token');
        window.api = this;
        this.initEventListeners();
    }

    initEventListeners() {
        if (!this.token) return;

        let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        let host = 'localhost:8000';
        if (this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1')) {
            protocol = 'ws:';
        }
        try {
            const url = new URL(this.baseUrl);
            host = url.host;
        } catch (e) { }

        const wsUrl = `${protocol}//${host}/api/v1/ws/events?token=${this.token}`;
        console.log("Connecting to Admin Events:", wsUrl);

        const ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'NOTIFICATION_REPLY') {
                    showAdminToast(data.user_name, data.message);
                }
            } catch (e) {
                console.error("Failed to parse event data:", e);
            }
        };

        ws.onerror = (error) => {
            console.error("Admin Events WebSocket Error:", error);
            if (window.log) window.log("Events WebSocket Error - Check Auth", "error");
        };

        ws.onclose = () => {
            console.log("Admin Events WebSocket closed. Reconnecting in 5s...");
            setTimeout(() => this.initEventListeners(), 5000);
        };
    }

    async request(endpoint, method = 'GET', body = null) {
        const headers = {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true' // Bypass ngrok warning page
        };

        const token = localStorage.getItem('access_token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const config = {
            method,
            headers
        };

        if (body) {
            config.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, config);

            if (response.status === 401) {
                // Token expired or invalid
                localStorage.removeItem('access_token');
                if (!window.location.href.includes('login.html')) {
                    window.location.href = 'login.html';
                }
                throw new Error("Unauthorized");
            }

            // Handle text/plain 500s or JSON errors
            let data;
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                data = await response.json();
            } else {
                data = { detail: await response.text() };
            }

            if (!response.ok) {
                const errorMessage = typeof data.detail === 'object' ? JSON.stringify(data.detail) : (data.detail || 'Request failed');
                throw new Error(errorMessage);
            }

            return data;
        } catch (error) {
            throw error;
        }
    }

    parseJwt(token) {
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            return JSON.parse(jsonPayload);
        } catch (e) {
            return null;
        }
    }

    async login(email, password, clientId = null) {
        const authUrl = "https://platform-development-dev.157.20.214.214.nip.io/auth/api/auth/login";

        console.log(`Attempting login for ${email} in organization: ${clientId || 'None'}`);

        const response = await fetch(authUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || 'Authentication failed');
        }

        const data = await response.json();
        const token = data.access_token || data.token;

        if (!token) throw new Error("Invalid response from auth server");

        localStorage.setItem('access_token', token);
        localStorage.setItem('admin_name', data.user ? (data.user.first_name + " " + data.user.last_name) : 'Administrator');
        this.token = token;
        return true;
    }

    async getOnlineUsers() {
        return this.request('/admin/online-users');
    }

    async getAllUsers() {
        return this.request('/admin/users');
    }

    async sendCommand(userId, commandType) {
        return this.request('/admin/command/send', 'POST', {
            user_id: userId,
            command: commandType
        });
    }

    async sendNotification(userId, title, message) {
        // Backend endpoint: /api/v1/admin/notify 
        // Note: I haven't implemented /notify endpoint in backend yet! 
        // I need to double check backend code.
        // Checking `admin.py`: `get_online_users`, `get_all_users`, `send_command`.
        // MISSING: `/notify` endpoint in `admin.py`.
        // I will add it if I have time, or just skip. 
        // PRD says "POST /api/v1/admin/notify". I should implement it.
        return this.request('/admin/notify', 'POST', {
            user_id: userId,
            title,
            message
        });
    }

    async getScreenshot(commandId) {
        return this.request(`/admin/screenshot/${commandId}`);
    }

    async getApps(userId) {
        return this.request(`/admin/apps/${userId}`);
    }

    async getBrowser(userId) {
        return this.request(`/admin/browser/${userId}`);
    }

    async getCommandHistory(userId) {
        return this.request(`/admin/commands?user_id=${userId}`);
    }

    async getLatestScreenshot(userId) {
        return this.request(`/admin/screenshot/latest/${userId}`);
    }

    async getScreenshotCount(userId) {
        return this.request(`/admin/screenshot-count/${userId}`);
    }

    async startLiveStream(userId) {
        return this.request('/admin/live/start', 'POST', {
            user_id: userId,
            command: 'START_LIVE_STREAM'
        });
    }

    async stopLiveStream(userId) {
        return this.request('/admin/live/stop', 'POST', {
            user_id: userId,
            command: 'STOP_LIVE_STREAM'
        });
    }

    async debugLog(message) {
        try {
            await fetch(`${this.baseUrl}/admin/debug-log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });
        } catch (e) { }
    }

    async checkConnection() {
        try {
            await this.request('/', 'GET');
            return true;
        } catch (e) {
            // Might return 404 or 401 if '/' is protected, but if we get a response it's connected
            // Let's just catch network errors (where fetch throws)
            if (e.message !== "Request failed" && !e.message.includes("Failed to fetch")) {
                return true; // Reached server but got a HTTP error
            }
            return false;
        }
    }

    logout() {
        localStorage.removeItem('access_token');
        window.location.href = 'login.html';
    }
}
