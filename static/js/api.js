// api.js — shared API client for all pages
// Talks to the Python backend running on the same server

const API = {
  _token() { return localStorage.getItem('token'); },

  async _fetch(method, url, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (this._token()) headers['Authorization'] = `Bearer ${this._token()}`;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res = await fetch(url, opts);
      const data = await res.json();
      if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return null;
      }
      return data;
    } catch (err) {
      console.error('API error:', err);
      return null;
    }
  },

  get(url)         { return this._fetch('GET', url); },
  post(url, body)  { return this._fetch('POST', url, body); },
  patch(url, body) { return this._fetch('PATCH', url, body); },
  delete(url)      { return this._fetch('DELETE', url); },

  async uploadFiles(files, labels) {
    const form = new FormData();
    files.forEach(f => form.append('files', f));
    labels.forEach(l => form.append('labels', l));
    const headers = {};
    if (this._token()) headers['Authorization'] = `Bearer ${this._token()}`;
    try {
      const res = await fetch('/api/upload', { method: 'POST', headers, body: form });
      return await res.json();
    } catch (err) {
      console.error('Upload error:', err);
      return null;
    }
  }
};

// Show logged-in user name in sidebar
document.addEventListener('DOMContentLoaded', () => {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (user.name) {
    const el = document.getElementById('user-name');
    const av = document.getElementById('user-avatar');
    if (el) el.textContent = user.name;
    if (av) av.textContent = user.name[0].toUpperCase();
  }
  // Redirect to login if no token (skip login/register pages)
  const path = window.location.pathname;
  if (!localStorage.getItem('token') && path !== '/login' && path !== '/register') {
    const banner = document.getElementById('auth-banner');
    if (banner) banner.style.display = 'flex';
  }
});
