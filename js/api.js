class APIClient {
  constructor() {
    // this.baseUrl = "http://localhost:8000/api/v1";
    this.baseUrl = "https://boardviewai.duckdns.org/api/v1";
    // this.baseUrl = "http://emp-monitoring.duckdns.org/api/v1";
    // this.baseUrl = "https://nonobstetrically-nonoptical-raymundo.ngrok-free.dev/api/v1";

    this.token = localStorage.getItem("access_token");
    window.api = this;
    this.initEventListeners();
  }

  initEventListeners() {
    if (!this.token) return;

    let protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let host = "localhost:8000";
    if (
      this.baseUrl.includes("localhost") ||
      this.baseUrl.includes("127.0.0.1")
    ) {
      protocol = "ws:";
    }
    try {
      const url = new URL(this.baseUrl);
      host = url.host;
    } catch (e) {}

    const token = encodeURIComponent(this.token);
    const clientId = localStorage.getItem("client_id") || "";
    const wsUrl = `${protocol}//${host}/api/v1/ws/events?token=${token}&client_id=${clientId}`;
    console.log("Connecting to Admin Events:", wsUrl);

    const ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "NOTIFICATION_REPLY") {
          showAdminToast(data.user_name, data.message);
        } else if (data.type === "error") {
          console.error("Server Error:", data.message);
          if (window.log) window.log(data.message, "error");
          if (data.message.includes("Token invalid or expired")) {
            // Alert user and redirect?
            // For now just log, maybe show a toast
            if (typeof showAdminToast === "function") {
              showAdminToast("System", data.message);
            }
          }
        }
      } catch (e) {
        console.error("Failed to parse event data:", e);
      }
    };

    ws.onerror = (error) => {
      console.error("Admin Events WebSocket Error:", error);
      if (window.log)
        window.log("Events WebSocket Error - Check Auth", "error");
    };

    ws.onclose = () => {
      console.log("Admin Events WebSocket closed. Reconnecting in 5s...");
      setTimeout(() => this.initEventListeners(), 5000);
    };
  }

  async request(endpoint, method = "GET", body = null, signal = null) {
    const headers = {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true", // Bypass ngrok warning page
    };

    const token = localStorage.getItem("access_token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const clientId = localStorage.getItem("client_id");
    if (clientId) {
      headers["X-Client-ID"] = clientId;
    }

    const config = {
      method,
      headers,
      signal,
    };

    if (body) {
      config.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, config);

      if (response.status === 401) {
        // Token expired or invalid
        localStorage.removeItem("access_token");
        if (!window.location.href.includes("login.html")) {
          window.location.href = "login.html";
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
        let errorMessage =
          typeof data.detail === "object"
            ? JSON.stringify(data.detail)
            : data.detail || "Request failed";
        // Capture server-side exception if available (from global_exception_handler)
        if (data.error) {
          errorMessage += ` | Server Error: ${data.error}`;
        }
        throw new Error(errorMessage);
      }

      return data;
    } catch (error) {
      throw error;
    }
  }

  parseJwt(token) {
    try {
      const base64Url = token.split(".")[1];
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split("")
          .map(function (c) {
            return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join(""),
      );
      return JSON.parse(jsonPayload);
    } catch (e) {
      return null;
    }
  }

  async getAuthToken(email, password) {
    const authUrl =
      "https://platform-development-dev.157.20.214.214.nip.io/auth/api/auth/login";
    const response = await fetch(authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Authentication failed");
    }

    const data = await response.json();
    return {
      token: data.access_token || data.token,
      user_info: data.user || {},
    };
  }

  async getAvailableOrganizations(token, keyword = "") {
    let allClients = [];
    let currentPage = 1;
    let totalPages = 1;
    const limit = 200;
    const kParam = keyword ? `&k=${encodeURIComponent(keyword)}` : "";

    try {
      do {
        const clientsUrl = `https://platform-development-dev.157.20.214.214.nip.io/auth/api/clients?page=${currentPage}&limit=${limit}${kParam}`;
        console.log(
          `Fetching organizations page ${currentPage} (keyword: "${keyword}")...`,
        );

        const response = await fetch(clientsUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          console.error(
            `Failed to fetch page ${currentPage}: ${response.statusText}`,
          );
          break;
        }

        const data = await response.json();
        console.log(`Page ${currentPage} data:`, data);

        let clients = [];
        if (Array.isArray(data)) {
          clients = data;
          totalPages = 1;
        } else {
          clients = data.clients || data.data || data.results || [];

          // Update totalPages/pagination info
          totalPages =
            data.total_pages ||
            (data.meta ? data.meta.total_pages : 1) ||
            data.last_page ||
            1;

          if (!data.total_pages && data.total && (data.limit || limit)) {
            totalPages = Math.ceil(data.total / (data.limit || limit));
          }

          const hasNext = !!(
            data.next ||
            (data.links && data.links.next) ||
            (data.meta && data.meta.next_page) ||
            (data.pagination && data.pagination.next_page)
          );
          if (hasNext && totalPages <= currentPage) {
            totalPages = currentPage + 1;
          }
        }

        console.log(
          `Page ${currentPage} returned ${clients.length} clients. Total found so far: ${allClients.length + clients.length}`,
        );
        allClients = [...allClients, ...clients];

        if (currentPage >= totalPages || clients.length === 0) break;
        currentPage++;

        // Safety cap
        if (currentPage > 100) break;
      } while (currentPage <= totalPages);
    } catch (e) {
      console.error("Error during organization fetch loop:", e);
    }

    console.log(`Total raw clients fetched: ${allClients.length}`);

    // Map and ensure uniqueness by ID
    const uniqueClients = [];
    const seenIds = new Set();

    const findName = (obj) => {
      if (!obj || typeof obj !== "object") return null;

      // Priority 1: Likeliest keys
      const highPriorityKeys = [
        "name",
        "orgn_name",
        "organization_name",
        "display_name",
      ];
      for (const key of highPriorityKeys) {
        if (
          obj[key] &&
          typeof obj[key] === "string" &&
          obj[key].trim() !== "" &&
          obj[key].toLowerCase() !== "generic"
        ) {
          return obj[key];
        }
      }

      // Priority 2: Recursion into objects and arrays
      for (const key in obj) {
        if (obj[key] && typeof obj[key] === "object") {
          const n = findName(obj[key]);
          if (n) return n;
        }
      }

      // Priority 3: Any key containing 'name'
      for (const key in obj) {
        if (
          typeof key === "string" &&
          key.toLowerCase().includes("name") &&
          typeof obj[key] === "string"
        ) {
          return obj[key];
        }
      }
      return null;
    };

    for (const c of allClients) {
      const id = c.id || c.uuid || c._id;
      if (id && !seenIds.has(id.toString())) {
        seenIds.add(id.toString());

        let name = findName(c) || "Unknown Organization";

        uniqueClients.push({
          id: id.toString(),
          name: name,
        });
      }
    }

    console.log(`Final unique clients list size: ${uniqueClients.length}`);
    return uniqueClients;
  }

  async login(email, password, clientId = null) {
    const authData = await this.getAuthToken(email, password);
    const token = authData.token;

    if (!token) throw new Error("Invalid response from auth server");

    localStorage.setItem("access_token", token);
    this.token = token; // Set token before sync call

    if (clientId) {
      localStorage.setItem("client_id", clientId);
      try {
        await this.syncOrganization(clientId);
      } catch (e) {
        console.error("Organization sync failed:", e);
      }
    }

    if (arguments[3]) {
      // clientName passed as 4th arg
      localStorage.setItem("client_name", arguments[3]);
    }

    const user = authData.user_info;
    localStorage.setItem(
      "admin_name",
      user.first_name
        ? user.first_name + " " + (user.last_name || "")
        : "Administrator",
    );
    return true;
  }

  async syncOrganization(clientId) {
    return this.request("/auth/sync-organization", "POST", {
      client_id: clientId,
    });
  }

  async getOnlineUsers(signal = null) {
    return this.request("/admin/online-users", "GET", null, signal);
  }

  async getAllUsers(signal = null) {
    return this.request("/admin/users", "GET", null, signal);
  }

  async sendCommand(userId, commandType) {
    return this.request("/admin/command/send", "POST", {
      user_id: userId,
      command: commandType,
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
    return this.request("/admin/notify", "POST", {
      user_id: userId,
      title,
      message,
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

  async getLatestScreenshot(userId, signal = null) {
    return this.request(
      `/admin/screenshot/latest/${userId}`,
      "GET",
      null,
      signal,
    );
  }

  async getScreenshotCount(userId, signal = null) {
    return this.request(
      `/admin/screenshot-count/${userId}`,
      "GET",
      null,
      signal,
    );
  }

  async startLiveStream(userId) {
    return this.request("/admin/live/start", "POST", {
      user_id: userId,
      command: "START_LIVE_STREAM",
    });
  }

  async stopLiveStream(userId) {
    return this.request("/admin/live/stop", "POST", {
      user_id: userId,
      command: "STOP_LIVE_STREAM",
    });
  }

  async debugLog(message) {
    try {
      await fetch(`${this.baseUrl}/admin/debug-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
    } catch (e) {}
  }

  async checkConnection() {
    try {
      await this.request("/", "GET");
      return true;
    } catch (e) {
      // Might return 404 or 401 if '/' is protected, but if we get a response it's connected
      // Let's just catch network errors (where fetch throws)
      if (
        e.message !== "Request failed" &&
        !e.message.includes("Failed to fetch")
      ) {
        return true; // Reached server but got a HTTP error
      }
      return false;
    }
  }

  logout() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("client_id");
    window.location.href = "login.html";
  }
}
