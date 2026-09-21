// upload.js — real API-connected upload page

const FILE_LABELS = [
  { value: 'syllabus', label: '📋 Syllabus' },
  { value: 'notes', label: '📝 Lecture Notes' },
  { value: 'slides', label: '📊 Slides' },
  { value: 'exam-schedule', label: '📅 Exam Schedule' },
  { value: 'past-paper', label: '📄 Past Paper' },
  { value: 'other', label: '📁 Other' },
];

let pendingFiles = []; // files not yet uploaded, waiting for label

const dropZone   = document.getElementById('drop-zone');
const fileInput  = document.getElementById('file-input');

// ── Drag and drop ──
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); handleFiles(Array.from(e.dataTransfer.files)); });
fileInput.addEventListener('change', () => { handleFiles(Array.from(fileInput.files)); fileInput.value = ''; });

function handleFiles(incoming) {
  const allowed = ['pdf','doc','docx','ppt','pptx','txt'];
  incoming.forEach(file => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) { showToast(`"${file.name}" not supported`, 'error'); return; }
    pendingFiles.push({ file, label: 'syllabus', id: Date.now() + Math.random() });
  });
  renderPending();
}

function renderPending() {
  const list = document.getElementById('file-list');
  const section = document.getElementById('file-list-section');
  const empty = document.getElementById('empty-state');
  const cta = document.getElementById('upload-cta');

  list.innerHTML = '';
  const hasPending = pendingFiles.length > 0;
  section.style.display = hasPending ? 'block' : 'none';
  empty.style.display = hasPending ? 'none' : 'block';
  document.getElementById('file-count').textContent = pendingFiles.length;

  pendingFiles.forEach((entry, idx) => {
    const labelOptions = FILE_LABELS.map(l =>
      `<option value="${l.value}" ${entry.label === l.value ? 'selected' : ''}>${l.label}</option>`
    ).join('');
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <div class="file-icon-wrap">${getFileIcon(entry.file.name)}</div>
      <div class="file-info">
        <div class="file-name">${entry.file.name}</div>
        <div class="file-meta">${formatFileSize(entry.file.size)}</div>
      </div>
      <select class="file-label-select" onchange="pendingFiles[${idx}].label=this.value">${labelOptions}</select>
      <button class="file-delete" onclick="removePending(${idx})">×</button>
    `;
    list.appendChild(item);
  });

  // Show upload button if there are pending files
  if (hasPending) {
    if (!document.getElementById('do-upload-btn')) {
      const btn = document.createElement('button');
      btn.id = 'do-upload-btn';
      btn.className = 'btn btn-primary';
      btn.style.marginTop = '12px';
      btn.textContent = `Upload ${pendingFiles.length} file${pendingFiles.length > 1 ? 's' : ''} →`;
      btn.onclick = doUpload;
      section.appendChild(btn);
    } else {
      document.getElementById('do-upload-btn').textContent = `Upload ${pendingFiles.length} file${pendingFiles.length > 1 ? 's' : ''} →`;
    }
  }
  cta.style.display = 'none';
}

function removePending(idx) {
  pendingFiles.splice(idx, 1);
  renderPending();
}

async function doUpload() {
  if (!pendingFiles.length) return;
  const progress = document.getElementById('upload-progress');
  const progressText = document.getElementById('upload-progress-text');
  progress.style.display = 'block';
  document.getElementById('do-upload-btn').disabled = true;

  const files = pendingFiles.map(e => e.file);
  const labels = pendingFiles.map(e => e.label);

  progressText.textContent = `Uploading ${files.length} file(s) and extracting text…`;

  const res = await API.uploadFiles(files, labels);
  progress.style.display = 'none';

  if (res?.success) {
    pendingFiles = [];
    showToast(`✅ ${res.files.length} file(s) uploaded successfully!`);
    loadFiles();
    document.getElementById('upload-cta').style.display = 'flex';
  } else {
    showToast(res?.detail || 'Upload failed — try again', 'error');
    document.getElementById('do-upload-btn').disabled = false;
  }
}

async function loadFiles() {
  const res = await API.get('/api/files');
  if (!res?.files) return;
  const list = document.getElementById('file-list');
  const section = document.getElementById('file-list-section');
  const empty = document.getElementById('empty-state');
  const cta = document.getElementById('upload-cta');

  if (res.files.length === 0) {
    section.style.display = 'none';
    empty.style.display = 'block';
    cta.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  empty.style.display = 'none';
  cta.style.display = 'flex';
  document.getElementById('file-count').textContent = res.files.length;

  list.innerHTML = res.files.map(f => `
    <div class="file-item">
      <div class="file-icon-wrap">${getFileIcon(f.name)}</div>
      <div class="file-info">
        <div class="file-name">${f.name}</div>
        <div class="file-meta">${formatFileSize(f.size)} · <span class="badge badge-${labelColor(f.label)}">${f.label}</span></div>
      </div>
      <button class="file-delete" onclick="deleteFile('${f.id}')">×</button>
    </div>
  `).join('');
}

async function deleteFile(id) {
  await API.delete(`/api/files/${id}`);
  showToast('File removed', 'error');
  loadFiles();
}

function labelColor(label) {
  return {syllabus:'green',notes:'blue',slides:'purple','exam-schedule':'amber','past-paper':'coral'}[label] || 'blue';
}

// Load existing files on page load
document.addEventListener('DOMContentLoaded', loadFiles);
