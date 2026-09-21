// roadmap.js — loads real study plan from backend

const SUBJECT_COLORS = {
  'Data Structures':  { color: '#4ade80', bg: 'rgba(74,222,128,0.15)' },
  'Operating Systems':{ color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
  'Database Systems': { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
  'Computer Networks':{ color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
  'General':          { color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
};

function getSubjectStyle(subject) {
  return SUBJECT_COLORS[subject] || { color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' };
}

let currentDate = new Date();
let studyPlan = {};
let exams = [];

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function loadData() {
  const [planRes, examRes] = await Promise.all([API.get('/api/plan'), API.get('/api/exams')]);

  studyPlan = {};
  if (planRes?.plan) {
    planRes.plan.forEach(day => {
      studyPlan[day.date] = day.sessions.map(s => ({
        subject: s.subject, topic: s.topic_name || s.topic,
        duration: `${s.duration_minutes} min`,
        ...getSubjectStyle(s.subject), isExam: false,
      }));
    });
  }

  exams = examRes?.exams || [];
  exams.forEach(e => {
    const key = e.date;
    if (!studyPlan[key]) studyPlan[key] = [];
    studyPlan[key].push({ subject: e.subject, topic: '🎯 EXAM', duration: '', isExam: true, ...getSubjectStyle(e.subject) });
  });

  renderExamStrip();
  renderLegend();
  renderCalendar();
  renderTodayTasks();
  renderWeekStats();
}

function renderCalendar() {
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';
  const year = currentDate.getFullYear(), month = currentDate.getMonth();
  document.getElementById('month-label').textContent = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev  = new Date(year, month, 0).getDate();
  const todayKey = dateKey(new Date());

  for (let i = firstDay - 1; i >= 0; i--) grid.appendChild(makeCell(daysInPrev - i, true, null, false, []));
  for (let d = 1; d <= daysInMonth; d++) {
    const cellDate = new Date(year, month, d);
    const key = dateKey(cellDate);
    grid.appendChild(makeCell(d, false, key, key === todayKey, studyPlan[key] || []));
  }
  const total = firstDay + daysInMonth;
  const remaining = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let d = 1; d <= remaining; d++) grid.appendChild(makeCell(d, true, null, false, []));
}

function makeCell(day, otherMonth, key, isToday, events) {
  const cell = document.createElement('div');
  cell.className = `cal-cell${otherMonth ? ' other-month' : ''}${isToday ? ' today' : ''}`;
  const num = document.createElement('span');
  num.className = 'cell-num'; num.textContent = day;
  cell.appendChild(num);
  events.slice(0, 3).forEach(ev => {
    const tag = document.createElement('div');
    tag.className = `cal-event${ev.isExam ? ' exam-marker' : ''}`;
    tag.style.background = ev.isExam ? ev.color + '22' : ev.bg;
    tag.style.color = ev.color;
    if (ev.isExam) tag.style.borderColor = ev.color;
    tag.textContent = ev.isExam ? `🎯 ${ev.subject}` : ev.topic;
    tag.addEventListener('mouseenter', e => showTooltip(e, ev));
    tag.addEventListener('mouseleave', hideTooltip);
    cell.appendChild(tag);
  });
  if (events.length > 3) {
    const more = document.createElement('div');
    more.style.cssText = 'font-size:11px;color:var(--text-3);padding:2px 4px';
    more.textContent = `+${events.length - 3} more`;
    cell.appendChild(more);
  }
  return cell;
}

function showTooltip(e, ev) {
  const tip = document.getElementById('tooltip');
  document.getElementById('tooltip-title').textContent = ev.isExam ? `🎯 ${ev.subject} EXAM` : ev.subject;
  document.getElementById('tooltip-meta').textContent  = ev.isExam ? 'Good luck!' : `${ev.topic} · ${ev.duration}`;
  tip.style.display = 'block';
  tip.style.left = (e.clientX + 12) + 'px';
  tip.style.top  = (e.clientY - 10) + 'px';
}
function hideTooltip() { document.getElementById('tooltip').style.display = 'none'; }

function renderExamStrip() {
  const strip = document.getElementById('exam-strip');
  strip.innerHTML = '';
  const today = new Date();
  exams.forEach(e => {
    const d = new Date(e.date);
    const days = Math.ceil((d - today) / 86400000);
    const style = getSubjectStyle(e.subject);
    strip.innerHTML += `
      <div class="exam-countdown" style="border-left-color:${style.color}">
        <div class="exam-countdown-subject">${e.subject}</div>
        <div class="exam-countdown-days" style="color:${style.color}">${days > 0 ? days + 'd' : 'Today!'}</div>
        <div class="exam-countdown-date">${d.toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</div>
      </div>`;
  });
  if (!exams.length) strip.innerHTML = '<div style="color:var(--text-3);font-size:13px;padding:12px 0">No exams added yet — <a href="/onboarding" style="color:var(--accent)">add them in setup</a></div>';
}

function renderLegend() {
  const row = document.getElementById('legend-row');
  const subjects = [...new Set(Object.values(studyPlan).flat().map(s => s.subject).filter(Boolean))];
  row.innerHTML = subjects.map(s => {
    const style = getSubjectStyle(s);
    return `<div class="legend-item"><div class="legend-dot" style="background:${style.color}"></div>${s}</div>`;
  }).join('');
}

function renderTodayTasks() {
  const tasks = studyPlan[dateKey(new Date())] || [];
  const container = document.getElementById('today-tasks');
  if (!tasks.length) { container.innerHTML = '<div style="color:var(--text-3);font-size:13px">No sessions today</div>'; return; }
  container.innerHTML = tasks.map(t => `
    <div class="today-task">
      <div class="task-dot" style="background:${t.color}"></div>
      <div style="flex:1"><div class="task-info-text">${t.topic}</div><div class="task-info-meta">${t.subject} · ${t.duration}</div></div>
    </div>`).join('');
}

function renderWeekStats() {
  const today = new Date();
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    total += (studyPlan[dateKey(d)] || []).length;
  }
  document.getElementById('week-stats').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;color:var(--text-2)">Sessions this week</span>
        <span style="font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--accent)">${total}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;color:var(--text-2)">Exams scheduled</span>
        <span style="font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--text)">${exams.length}</span>
      </div>
      <a href="/revision" class="btn btn-primary btn-sm" style="margin-top:4px;justify-content:center">Start revision →</a>
    </div>`;
}

function changeMonth(dir) { currentDate.setMonth(currentDate.getMonth() + dir); renderCalendar(); }

async function regeneratePlan() {
  showToast('Regenerating plan…');
  await loadData();
  showToast('Plan updated! ✓');
}

document.addEventListener('DOMContentLoaded', loadData);
