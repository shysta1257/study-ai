// polish.js — mobile nav, page loader, network monitor, keyboard shortcuts

function initMobileNav() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  const hamburger = document.createElement('button');
  hamburger.className = 'hamburger';
  hamburger.setAttribute('aria-label', 'Toggle menu');
  hamburger.innerHTML = '<span></span><span></span><span></span>';
  document.body.appendChild(hamburger);
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  document.body.appendChild(overlay);
  const open  = () => { sidebar.classList.add('open'); overlay.classList.add('visible'); hamburger.classList.add('open'); document.body.style.overflow = 'hidden'; };
  const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('visible'); hamburger.classList.remove('open'); document.body.style.overflow = ''; };
  hamburger.addEventListener('click', () => sidebar.classList.contains('open') ? close() : open());
  overlay.addEventListener('click', close);
  sidebar.querySelectorAll('.nav-item').forEach(l => l.addEventListener('click', () => { if (window.innerWidth <= 768) close(); }));
  window.addEventListener('resize', () => { if (window.innerWidth > 768) close(); });
}

function initNetworkMonitor() {
  window.addEventListener('offline', () => showToast('No internet connection', 'error', 6000));
  window.addEventListener('online',  () => showToast('Back online!'));
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const sidebar = document.querySelector('.sidebar');
      if (sidebar?.classList.contains('open')) {
        sidebar.classList.remove('open');
        document.querySelector('.sidebar-overlay')?.classList.remove('visible');
        document.querySelector('.hamburger')?.classList.remove('open');
        document.body.style.overflow = '';
      }
    }
  });
}

const _transStyle = document.createElement('style');
_transStyle.textContent = '.main-content.fade-out{opacity:0;transform:translateY(-8px);transition:opacity .18s ease,transform .18s ease}';
document.head.appendChild(_transStyle);

function initPageTransitions() {
  document.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto')) return;
    link.addEventListener('click', e => {
      e.preventDefault();
      document.querySelector('.main-content')?.classList.add('fade-out');
      setTimeout(() => { window.location.href = href; }, 180);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initMobileNav();
  initNetworkMonitor();
  initKeyboardShortcuts();
  setTimeout(initPageTransitions, 100);
});
