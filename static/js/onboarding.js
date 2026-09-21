// onboarding.js — real API-connected 4-step wizard

let currentStep = 1;
let topics = [];
let exams = [];
let selectedDays = ['Mon','Tue','Wed','Thu','Fri'];
const EXAM_COLORS = ['#4ade80','#60a5fa','#fbbf24','#f87171','#a78bfa','#34d399'];

// ── Step navigation ──
function goToStep(n) {
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${n}`)?.classList.add('active');
  for (let i = 1; i <= 4; i++) {
    const bubble = document.getElementById(`bubble-${i}`);
    const item   = document.getElementById(`step-item-${i}`);
    bubble.classList.remove('active','done');
    item.classList.remove('active','done');
    if (i < n) { bubble.classList.add('done'); bubble.textContent = '✓'; item.classList.add('done'); }
    else if (i === n) { bubble.classList.add('active'); bubble.textContent = i; item.classList.add('active'); }
    else { bubble.textContent = i; }
    const conn = document.getElementById(`conn-${i}`);
    if (conn) conn.classList.toggle('done', i < n);
  }
  currentStep = n;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Step 1: Syllabus upload ──
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('syllabus-file')?.addEventListener('change', async function() {
    if (!this.files[0]) return;
    const file = this.files[0];
    document.getElementById('syllabus-loading').style.display = 'block';
    document.getElementById('syllabus-zone').style.display = 'none';

    // Upload the file
    const res = await API.uploadFiles([file], ['syllabus']);
    if (!res?.success) {
      showToast('Upload failed — try again', 'error');
      document.getElementById('syllabus-loading').style.display = 'none';
      document.getElementById('syllabus-zone').style.display = 'block';
      return;
    }

    const fileId = res.files[0].id;
    document.getElementById('upload-progress-text2').textContent = 'Extracting topics with AI…';

    // Extract topics
    const topicsRes = await API.post('/api/extract-topics', { file_id: fileId });
    document.getElementById('syllabus-loading').style.display = 'none';

    if (topicsRes?.topics?.length) {
      document.getElementById('syllabus-done').style.display = 'block';
      document.getElementById('syllabus-filename').textContent = file.name;
      topics = topicsRes.topics;
      renderTopics();
      showToast(`✅ ${topicsRes.count} topics extracted!`);
    } else {
      showToast('Could not extract topics — try a different file', 'error');
      document.getElementById('syllabus-zone').style.display = 'block';
    }
  });

  loadExistingTopics();
});

async function loadExistingTopics() {
  const res = await API.get('/api/topics');
  if (res?.topics?.length) {
    topics = res.topics;
    renderTopics();
  }
}

async function useSampleSyllabus() {
  document.getElementById('syllabus-loading').style.display = 'block';
  document.getElementById('syllabus-zone').style.display = 'none';
  document.getElementById('upload-progress-text2').textContent = 'Loading sample topics…';

  // Add sample topics directly via API
  const samples = [
    { name: 'Arrays & Linked Lists', subject: 'Data Structures', weight: 'high' },
    { name: 'Sorting Algorithms', subject: 'Data Structures', weight: 'high' },
    { name: 'Trees & Graphs', subject: 'Data Structures', weight: 'medium' },
    { name: 'Dynamic Programming', subject: 'Data Structures', weight: 'medium' },
    { name: 'Process Scheduling', subject: 'Operating Systems', weight: 'high' },
    { name: 'Memory Management', subject: 'Operating Systems', weight: 'high' },
    { name: 'Deadlocks', subject: 'Operating Systems', weight: 'medium' },
    { name: 'SQL Queries', subject: 'Database Systems', weight: 'high' },
    { name: 'Normalization', subject: 'Database Systems', weight: 'medium' },
    { name: 'TCP/IP Model', subject: 'Computer Networks', weight: 'high' },
    { name: 'HTTP & REST', subject: 'Computer Networks', weight: 'medium' },
  ];

  topics = [];
  for (const s of samples) {
    const res = await API.post('/api/topics', s);
    if (res?.id) topics.push({ ...res, selected: true });
  }

  document.getElementById('syllabus-loading').style.display = 'none';
  document.getElementById('syllabus-done').style.display = 'block';
  document.getElementById('syllabus-filename').textContent = 'sample_syllabus.pdf';
  renderTopics();
  showToast(`✅ ${topics.length} sample topics loaded!`);
  goToStep(2);
}

// ── Step 2: Topics ──
function renderTopics() {
  const grid = document.getElementById('topics-grid');
  grid.innerHTML = '';
  topics.forEach((t, i) => {
    const chip = document.createElement('div');
    chip.className = `topic-chip ${t.selected !== false ? 'selected' : ''}`;
    chip.innerHTML = `${t.name} <span class="chip-remove" onclick="removeTopic('${t.id}',event)">×</span>`;
    chip.addEventListener('click', () => toggleTopic(t.id, chip));
    grid.appendChild(chip);
  });
}

async function toggleTopic(id, chip) {
  const t = topics.find(t => t.id === id);
  if (!t) return;
  t.selected = !t.selected;
  chip.classList.toggle('selected', t.selected);
  await API.patch(`/api/topics/${id}`, { selected: t.selected });
}

async function removeTopic(id, e) {
  e.stopPropagation();
  await API.delete(`/api/topics/${id}`);
  topics = topics.filter(t => t.id !== id);
  renderTopics();
}

async function addTopic() {
  const input = document.getElementById('new-topic-input');
  const val = input.value.trim();
  if (!val) return;
  const res = await API.post('/api/topics', { name: val, subject: 'General', weight: 'medium' });
  if (res?.id) { topics.push(res); renderTopics(); input.value = ''; showToast(`"${val}" added`); }
}

// ── Step 3: Exams ──
async function addExam() {
  const name = document.getElementById('exam-name').value.trim();
  const date = document.getElementById('exam-date').value;
  const type = document.getElementById('exam-type').value;
  if (!name) { showToast('Enter a subject name', 'error'); return; }
  if (!date) { showToast('Pick an exam date', 'error'); return; }
  const res = await API.post('/api/exams', { subject: name, date, exam_type: type });
  if (res?.id) {
    exams.push(res);
    renderExams();
    document.getElementById('exam-name').value = '';
    document.getElementById('exam-date').value = '';
    showToast(`${name} added`);
  }
}

function renderExams() {
  const list = document.getElementById('exam-list');
  if (!exams.length) { list.innerHTML = '<div style="color:var(--text-3);font-size:13px;margin-bottom:14px">No exams yet</div>'; return; }
  list.innerHTML = exams.map((e, i) => `
    <div class="exam-item">
      <div class="exam-color-dot" style="background:${EXAM_COLORS[i % EXAM_COLORS.length]}"></div>
      <div class="exam-info"><div class="exam-name">${e.subject}</div><div class="exam-date">${formatDate(e.date)} · ${e.type}</div></div>
      <button class="exam-delete" onclick="removeExam('${e.id}')">×</button>
    </div>`).join('');
}

async function removeExam(id) {
  await API.delete(`/api/exams/${id}`);
  exams = exams.filter(e => e.id !== id);
  renderExams();
}

async function loadExams() {
  const res = await API.get('/api/exams');
  if (res?.exams) { exams = res.exams; renderExams(); }
}

// ── Step 4: Availability ──
function toggleDay(el, day) {
  el.classList.toggle('selected');
  if (el.classList.contains('selected')) selectedDays.push(day);
  else selectedDays = selectedDays.filter(d => d !== day);
}

async function generatePlan() {
  if (!selectedDays.length) { showToast('Pick at least one study day', 'error'); return; }
  const btn = document.querySelector('#panel-4 .btn-primary');
  btn.textContent = '⏳ Generating…'; btn.disabled = true;
  const res = await API.post('/api/generate-plan', {
    days: selectedDays,
    hours_per_day: parseInt(document.getElementById('hours-per-day').value),
    session_minutes: parseInt(document.getElementById('session-length').value),
    style: document.getElementById('study-style').value,
  });
  btn.disabled = false;
  if (res?.plan) {
    showToast(`🎉 Plan generated — ${res.total_sessions} sessions scheduled!`);
    document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-done').classList.add('active');
  } else {
    showToast(res?.detail || 'Plan generation failed', 'error');
    btn.textContent = '🚀 Generate my study plan';
  }
}

function formatDate(str) {
  return new Date(str).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

document.addEventListener('DOMContentLoaded', () => { loadExams(); renderExams(); });
