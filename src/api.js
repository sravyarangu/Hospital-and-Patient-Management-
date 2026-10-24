export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    signal: options.signal,
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'string' ? payload : payload?.message || 'Request failed.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return payload;
}

export async function getBackendHealth(options = {}) {
  return apiRequest('/health', options);
}

export async function registerPatient(details) {
  return apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify(details),
  });
}

export async function login(email, password) {
  return apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function logout() {
  return apiRequest('/auth/logout', { method: 'POST' });
}

export async function getCurrentUser(options = {}) {
  return apiRequest('/auth/me', options);
}

export async function requestApi(path, options = {}) {
  const requestOptions = { ...options };
  if (requestOptions.body && typeof requestOptions.body !== 'string') {
    requestOptions.body = JSON.stringify(requestOptions.body);
  }
  return apiRequest(path, requestOptions);
}

export default {
  getBackendHealth,
  registerPatient,
  login,
  logout,
  getCurrentUser,
  requestApi,
};
