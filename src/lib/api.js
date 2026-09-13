const BASE = '/api';

function csrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)buymepap_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

/** Same-origin fetch with cookies + CSRF header; server errors become Error with .status. */
export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = csrfToken();
  if (token) headers['X-CSRF-Token'] = token;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

/** Integer-safe kobo formatting (no float math), matching server/money.js. */
export function formatKobo(kobo, symbol = '₦') {
  const safe = Number.isSafeInteger(Number(kobo)) ? Number(kobo) : 0;
  const whole = Math.trunc(safe / 100);
  const frac = safe % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === 0 ? `${symbol}${grouped}` : `${symbol}${grouped}.${String(frac).padStart(2, '0')}`;
}

export function formatNaira(nairaAmount) {
  return `₦${Number(nairaAmount).toLocaleString('en-NG')}`;
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
