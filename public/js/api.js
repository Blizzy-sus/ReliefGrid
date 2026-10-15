// Thin fetch wrapper: bearer token, JSON in/out, uniform errors.
const KEY = 'reliefgrid.token';

let token = null;
try { token = sessionStorage.getItem(KEY); } catch { /* storage blocked */ }
let onUnauthorized = () => {};

export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
export const hasToken = () => Boolean(token);
export function setToken(t) {
  token = t;
  try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

async function call(method, url, body) {
  let res;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the ReliefGrid server. Check that it is running.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error?.code || 'ERROR', data?.error?.message || `Request failed (${res.status})`);
    if (res.status === 401 && token) { setToken(null); onUnauthorized(); }
    throw err;
  }
  return data;
}

export const api = {
  get: (u) => call('GET', u),
  post: (u, b = {}) => call('POST', u, b),
  patch: (u, b = {}) => call('PATCH', u, b),
  put: (u, b = {}) => call('PUT', u, b),
};
