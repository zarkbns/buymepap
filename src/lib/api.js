const BASE = '/api';

export async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export function formatMoney(nairaAmount) {
  return `₦${Number(nairaAmount).toLocaleString('en-NG')}`;
}

export function formatKobo(kobo) {
  return formatMoney(kobo / 100);
}

// SQLite datetime('now') yields "YYYY-MM-DD HH:MM:SS" in UTC.
export function timeAgo(dateStr) {
  if (!dateStr) return '';
  const normalized = dateStr.includes('T') ? dateStr : `${dateStr.replace(' ', 'T')}Z`;
  const elapsed = Math.max(0, Date.now() - new Date(normalized).getTime());
  const mins = Math.round(elapsed / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}
