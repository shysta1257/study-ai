function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return {pdf:'📄',docx:'📝',doc:'📝',pptx:'📊',ppt:'📊',txt:'📃'}[ext] || '📁';
}
function showToast(message, type = 'success', duration = 3000) {
  let container = document.querySelector('.toast-container');
  if (!container) { container = document.createElement('div'); container.className = 'toast-container'; document.body.appendChild(container); }
  while (container.children.length >= 3) container.firstChild.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const colors = { success: 'var(--accent)', error: 'var(--coral)', info: 'var(--blue)' };
  toast.innerHTML = `<div class="toast-dot" style="background:${colors[type]||colors.success}"></div><span style="flex:1">${message}</span><button style="background:none;border:none;color:var(--text-3);cursor:pointer;font-size:16px;padding:0 0 0 8px;line-height:1" onclick="this.parentElement.remove()">×</button>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity='0'; toast.style.transform='translateX(20px)'; toast.style.transition='0.2s ease'; setTimeout(() => toast.remove(), 200); }, duration);
}
