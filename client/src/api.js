import { AUTH_URL } from './constants.js';

function keepServerWarm() {
  if (!AUTH_URL) return;
  const ping = () => {
    fetch(AUTH_URL + "/health", { method: "GET" }).catch(() => {});
  };
  ping();
  setInterval(ping, 10 * 60 * 1000);
}
/** HTTP API (same origin as AUTH_URL). Bearer token + refresh on 401. Offline write queue. */
const OFFLINE_QUEUE_KEY = "solana_offline_queue";

function readOfflineQueue() {
  try {
    const r = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!r) return [];
    const a = JSON.parse(r);
    return Array.isArray(a) ? a : [];
  } catch (e) {
    return [];
  }
}
function writeOfflineQueue(q) {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
  } catch (e) {}
}

function dispatchSolanaToast(message, kind) {
  window.dispatchEvent(new CustomEvent("solana-toast", { detail: { message, kind: kind || "info" } }));
}

function isNetworkError(e) {
  if (!e) return false;
  if (e.name === "TypeError") return true;
  const m = String(e.message || "");
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return true;
  return false;
}

function shouldQueueWrite(method, path) {
  const m = String(method || "").toUpperCase();
  if (m !== "POST" && m !== "PUT" && m !== "DELETE") return false;
  const p = path || "";
  if (p.indexOf("/expenses") !== 0) return false;
  return true;
}

function makeOfflineQueuedError() {
  const e = new Error("OFFLINE_QUEUED");
  e.code = "OFFLINE_QUEUED";
  return e;
}

function isOfflineQueuedError(e) {
  return e && (e.code === "OFFLINE_QUEUED" || e.message === "OFFLINE_QUEUED");
}

/** Comment POST failed due to gateway, timeout, missing route, or network — safe to merge locally */
function isCommentPostUnavailable(e) {
  if (isNetworkError(e)) return true;
  const m = String(e && e.message ? e.message : "");
  if (/HTTP 502|HTTP 503|HTTP 504|HTTP 404|Bad Gateway|Gateway Timeout/i.test(m)) return true;
  return false;
}

function enqueueOfflineOp(method, path, body, meta) {
  const q = readOfflineQueue();
  q.push({
    id: "q_" + Date.now() + "_" + Math.random().toString(36).slice(2, 11),
    method: String(method).toUpperCase(),
    path,
    body: body === undefined ? null : body,
    meta: meta && typeof meta === "object" ? meta : {},
    enqueuedAt: Date.now(),
  });
  writeOfflineQueue(q);
  dispatchSolanaToast("Guardado localmente, se sincronizará al reconectar", "offline");
  throw makeOfflineQueuedError();
}

const API = {
  get base() {
    return AUTH_URL || "";
  },
  token: null,
  _userId: null,
  _flushBusy: false,

  /** Bearer for requests: memory token, or sync from sessionStorage (login / refresh). */
  ensureSessionToken() {
    if (this.token) return;
    try {
      const s = sessionStorage.getItem("sol-session-token");
      if (s) this.token = s;
    } catch (e) {
      this.token = null;
    }
  },

  mergeMeta(meta) {
    if (!meta || typeof meta !== "object") return {};
    const o = { ...meta };
    delete o.skipOfflineQueue;
    return o;
  },

  async _rawFetch(method, path, body) {
    this.ensureSessionToken();
    const opts = { method, headers: {} };
    if (this.token) opts.headers.Authorization = "Bearer " + this.token;
    if (body != null && method !== "GET" && method !== "HEAD" && method !== "DELETE") {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(this.base + path, opts);
  },

  async requestNoQueue(method, path, body) {
    if (!this.base) throw new Error("API no configurada.");
    let res = await this._rawFetch(method, path, body);
    if (res.status === 401) {
      const ok = await this.refresh();
      if (ok) {
        res = await this._rawFetch(method, path, body);
      } else {
        window.dispatchEvent(new Event("solana-session-expired"));
        throw new Error("Sesión expirada");
      }
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const data = ct.includes("application/json") ? await res.json().catch(() => ({})) : {};
    if (res.status === 409) {
      dispatchSolanaToast("Conflicto al sincronizar, revisa los datos", "conflict");
      throw Object.assign(new Error(data.error || "Conflicto"), { status: 409 });
    }
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
    return data;
  },

  async request(method, path, body, meta) {
    if (!this.base) throw new Error("API no configurada.");
    const skipOfflineQueue = !!(meta && meta.skipOfflineQueue);
    const storedMeta = this.mergeMeta(meta);
    const queueWrite = shouldQueueWrite(method, path) && !skipOfflineQueue;

    if (queueWrite && typeof navigator !== "undefined" && !navigator.onLine) {
      enqueueOfflineOp(method, path, body, storedMeta);
    }

    try {
      let res = await this._rawFetch(method, path, body);
      if (res.status === 401) {
        const ok = await this.refresh();
        if (ok) {
          res = await this._rawFetch(method, path, body);
        } else {
          window.dispatchEvent(new Event("solana-session-expired"));
          throw new Error("Sesión expirada");
        }
      }
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const data = ct.includes("application/json") ? await res.json().catch(() => ({})) : {};
      if (res.status === 409) {
        dispatchSolanaToast("Conflicto al sincronizar, revisa los datos", "conflict");
        throw Object.assign(new Error(data.error || "Conflicto"), { status: 409 });
      }
      if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
      return data;
    } catch (e) {
      if (queueWrite && isNetworkError(e)) {
        enqueueOfflineOp(method, path, body, storedMeta);
      }
      throw e;
    }
  },

  async refresh() {
    if (!AUTH_URL) return false;
    this.ensureSessionToken();
    try {
      const res = await fetch(AUTH_URL + "/auth/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + this.token,
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.sessionToken) {
          this.token = data.sessionToken;
          this._userId = data.userId || (data.user && data.user.id) || null;
          try {
            sessionStorage.setItem("sol-session-token", data.sessionToken);
          } catch (e) {}
          return true;
        }
      }
    } catch (e) {}
    return false;
  },

  async logout() {
    if (!this.base || !this.token) return;
    try {
      await fetch(this.base + "/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + this.token,
        },
      });
    } catch (e) {}
    try {
      sessionStorage.removeItem("sol-session-token");
    } catch (e) {}
    this.token = null;
  },

  async flushOfflineQueue() {
    if (this._flushBusy) return;
    if (!this.base) return;
    this.ensureSessionToken();
    if (!this.token) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (readOfflineQueue().length === 0) return;
    this._flushBusy = true;
    try {
      while (readOfflineQueue().length > 0) {
        const q = readOfflineQueue();
        const op = q[0];
        let data;
        try {
          data = await this.requestNoQueue(op.method, op.path, op.body);
        } catch (err) {
          if (err && err.status === 409) break;
          if (isNetworkError(err)) break;
          if (String(err.message || "").indexOf("Sesión expirada") >= 0) break;
          break;
        }

        if (op.method === "POST" && op.path === "/expenses" && op.meta && op.meta.pendingReceipt && data.expense && data.expense.id) {
          try {
            await this.requestNoQueue("POST", "/expenses/" + encodeURIComponent(data.expense.id) + "/receipt", {
              b64: op.meta.pendingReceipt.b64,
              mediaType: op.meta.pendingReceipt.mediaType || op.meta.pendingReceipt.type || "image/jpeg",
            });
          } catch (recErr) {
            if (isNetworkError(recErr)) break;
            if (recErr && recErr.status === 409) break;
            break;
          }
        }

        writeOfflineQueue(q.slice(1));
        dispatchSolanaToast("Sincronizado ✓", "sync");
        window.dispatchEvent(new CustomEvent("solana-offline-sync", { detail: { op, response: data } }));
      }
    } finally {
      this._flushBusy = false;
    }
  },

  async fetchBinary(path) {
    if (!this.base) throw new Error("API no configurada.");
    this.ensureSessionToken();
    const opts = { method: "GET", headers: {} };
    if (this.token) opts.headers.Authorization = "Bearer " + this.token;
    let res = await fetch(this.base + path, opts);
    if (res.status === 401) {
      const ok = await this.refresh();
      if (ok) {
        opts.headers.Authorization = "Bearer " + this.token;
        res = await fetch(this.base + path, opts);
      } else {
        window.dispatchEvent(new Event("solana-session-expired"));
        throw new Error("Sesión expirada");
      }
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.blob();
  },

  get: (path) => API.request("GET", path, null, undefined),
  post: (path, body, meta) => API.request("POST", path, body, meta),
  put: (path, body, meta) => API.request("PUT", path, body, meta),
  delete: (path, meta) => API.request("DELETE", path, null, meta),
};

async function debugApiRequest(method, path, body) {
  if (!API.base) throw new Error("API no configurada.");
  let response = await API._rawFetch(String(method || "GET").toUpperCase(), path, body);
  if (response.status === 401) {
    const ok = await API.refresh();
    if (ok) response = await API._rawFetch(String(method || "GET").toUpperCase(), path, body);
  }
  const rawText = await response.text().catch(() => "");
  let responseBody = {};
  try { responseBody = rawText ? JSON.parse(rawText) : {}; } catch (e) {}
  return { response, responseBody, rawText };
}

export {
  readOfflineQueue,
  writeOfflineQueue,
  dispatchSolanaToast,
  isNetworkError,
  shouldQueueWrite,
  makeOfflineQueuedError,
  isOfflineQueuedError,
  isCommentPostUnavailable,
  enqueueOfflineOp,
  API,
  debugApiRequest,
};

// side effect: ping server
keepServerWarm();
