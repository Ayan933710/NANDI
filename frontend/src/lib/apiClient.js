export function getCustomApiUrl() {
  try {
    return localStorage.getItem('nandi_custom_api_url') || '';
  } catch {
    return '';
  }
}

export function setCustomApiUrl(url) {
  try {
    if (url) localStorage.setItem('nandi_custom_api_url', url.trim());
    else localStorage.removeItem('nandi_custom_api_url');
  } catch {
  }
}

function isCapacitorNative() {
  try {
    return (
      typeof window !== 'undefined' &&
      (window.Capacitor?.isNativePlatform?.() === true ||
        window.Capacitor?.getPlatform?.() === 'android' ||
        window.Capacitor?.getPlatform?.() === 'ios')
    );
  } catch {
    return false;
  }
}

export function getApiUrls() {
  const custom = getCustomApiUrl();
  const configured = import.meta.env.VITE_API_URL?.trim();
  const isNative = isCapacitorNative();

  // In Capacitor, window.location.origin is http://localhost (the webview),
  // not the real backend — so skip it on native platforms.
  const originApi =
    !isNative && typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
      ? `${window.location.origin.replace(/\/+$/, '')}/api`
      : null;

  const rawList = [
    ...(custom ? [custom.replace(/\/+$/, '') + (custom.endsWith('/api') ? '' : '/api')] : []),
    ...(configured ? [configured] : []),
    ...(originApi ? [originApi] : []),
    'http://localhost:5000/api'
  ];
  return Array.from(new Set(rawList.filter(Boolean))).map((value) => value.replace(/\/+$/, ''));
}

const DEFAULT_API_URLS = getApiUrls();
const API_URL = DEFAULT_API_URLS[0] || 'http://localhost:5000/api';
const TOKEN_STORAGE_KEY = 'nandi_token';
const REQUEST_TIMEOUT_MS = 8000;

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
  }
}

async function request(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const finalHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    ...headers
  };
  const token = auth ? getToken() : null;
  if (token) finalHeaders.Authorization = `Bearer ${token}`;

  let lastNetworkError = null;

  for (const baseUrl of getApiUrls()) {
    let response;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: finalHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const isJson = response.headers.get('content-type')?.includes('application/json');
      const payload = isJson ? await response.json().catch(() => ({})) : null;

      if (!response.ok) {
        if (response.status === 401 && auth) {
          window.dispatchEvent(new CustomEvent('nandi:unauthorized'));
        }
        throw new Error(payload?.error || `Request failed with status ${response.status}`);
      }

      return payload;
    } catch (networkErr) {
      if (networkErr.name === 'AbortError') {
        lastNetworkError = new Error(`The NANDI backend did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds.`);
      } else if (networkErr.message?.includes('Failed to fetch') || networkErr.name === 'TypeError') {
        lastNetworkError = new Error(
          `Could not reach the NANDI backend at ${baseUrl}. Is the server running? (${networkErr.message})`
        );
      } else {
        throw networkErr;
      }
      continue;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw lastNetworkError || new Error(`Could not reach the NANDI backend. Is the server running?`);
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
};

export { API_URL };
