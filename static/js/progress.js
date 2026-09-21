// progress.js — loads real progress data from backend

async function loadProgress() {
  const res = await API.get('/api/progress');
  if (!res) return;

  // Stats
  document.getElementById('p-topics').textContent    = res.topics_covered || 0;
  document.getElementById('p-hours').textContent     = (res.total_study_hours || 0) + 'h';
  document.getElementById('p-exchanges').textContent = res.total_exchanges || 0;
  document.getElementById('p-pct').textContent       = (res.overall_percent || 0) + '%';

  renderStreak(res.streak_days || 0);
  renderTopicProgress(res.subjects || []);
  renderHeatmap(res.activity || []);
  renderExamCards(res.exams || []);
}

function renderStreak(streak) {
  const today = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    days.push({ name: ['S','M','T','W','T','F','S'][d.getDay()], done: i < streak });
  }
  document.getElementById('streak-card').innerHTML = `
    <div class="streak-flame">🔥</div>
    <div style="flex:1">
      <div style="display:flex;align-items:baseline;gap:10px">
        <div class="streak-num">${streak}</div>
        <div>
          <div class="streak-label">Day streak</div>
          <div class="streak-sub">${streak > 0 ? "Keep it up!" : "Study today to start your streak!"}</div>
        </div>
      </div>
      <div class="streak-days">
        ${days.map(d => `<div class="streak-day ${d.done?'done':''}">
          <span class="day-icon">${d.done?'🔥':'·'}</span>
          <span class="day-name">${d.name}</span>
        </div>`).join('')}
      </div>
    </div>`;
}

function renderTopicProgress(subjects) {
  const container = document.getElementById('topics-progress');
  if (!subjects.length) {
    container.innerHTML = '<div style="color:var(--text-3);font-size:13px;padding:20px 0">No topics yet — <a href="/onboarding" style="color:var(--accent)">complete setup first</a></div>';
    return;
  }
  container.innerHTML = '';
  subjects.forEach(subject => {
    const avg = subject.topics.length ? Math.round(subject.topics.reduce((s,t) => s+t.percent,0) / subject.topics.length) : 0;
    const section = document.createElement('div');
    section.className = 'subject-section';
    section.innerHTML = `
      <div class="subject-header">
        <div class="subject-name-row">
          <div class="subject-color-bar" style="background:${subject.color}"></div>
          <span class="subject-name">${subject.name}</span>
        </div>
        <span class="subject-pct" style="color:${subject.color}">${avg}%</span>
      </div>
      <div class="topic-rows">
        ${subject.topics.map(t => {
          const status = t.percent >= 80 ? '✅' : t.percent >= 50 ? '🔄' : t.percent > 0 ? '⚠️' : '⭕';
          return `<div class="topic-row">
            <div class="topic-name">${t.name}</div>
            <div class="topic-bar-wrap"><div class="topic-bar-fill" style="width:0%;background:${subject.color};opacity:0.8" data-pct="${t.percent}"></div></div>
            <div class="topic-pct-label">${t.percent}%</div>
            <div class="topic-status">${status}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="divider" style="margin:0"></div>`;
    container.appendChild(section);
  });
  setTimeout(() => {
    document.querySelectorAll('.topic-bar-fill').forEach(b => { b.style.width = b.dataset.pct + '%'; });
  }, 100);
}

function renderHeatmap(activity) {
  const container = document.getElementById('heatmap');
  const actMap = {};
  activity.forEach(a => { actMap[a.date] = a.sessions; });
  const colors = ['var(--bg4)','rgba(74,222,128,0.2)','rgba(74,222,128,0.4)','rgba(74,222,128,0.65)','#4ade80'];

  const grid = document.createElement('div'); grid.className = 'heatmap-grid';
  const dayLabels = document.createElement('div'); dayLabels.className = 'heatmap-day-labels';
  ['','M','','W','','F',''].forEach(d => {
    const l = document.createElement('div'); l.className = 'heatmap-day-label'; l.textContent = d; dayLabels.appendChild(l);
  });
  grid.appendChild(dayLabels);

  const weeksWrap = document.createElement('div'); weeksWrap.className = 'heatmap-weeks';
  const today = new Date();
  for (let w = 15; w >= 0; w--) {
    const col = document.createElement('div'); col.className = 'heatmap-week';
    for (let d = 6; d >= 0; d--) {
      const date = new Date(today);
      date.setDate(today.getDate() - (w * 7 + d));
      const key = date.toISOString().split('T')[0];
      const val = Math.min(actMap[key] || 0, 4);
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      cell.style.background = colors[val];
      cell.title = val === 0 ? 'No activity' : `${val} session${val > 1?'s':''} on ${key}`;
      col.appendChild(cell);
    }
    weeksWrap.appendChild(col);
  }
  grid.appendChild(weeksWrap);
  container.appendChild(grid);

  const legend = document.createElement('div'); legend.className = 'heatmap-legend';
  legend.innerHTML = `<span>Less</span><div class="heatmap-legend-cells">${colors.map(c=>`<div class="heatmap-cell" style="background:${c};cursor:default"></div>`).join('')}</div><span>More</span>`;
  container.appendChild(legend);
}

function renderExamCards(exams) {
  const container = document.getElementById('exam-cards');
  if (!exams.length) {
    container.innerHTML = '<div style="color:var(--text-3);font-size:13px">No exams added — <a href="/onboarding" style="color:var(--accent)">add them in setup</a></div>';
    return;
  }
  container.innerHTML = exams.map(e => {
    const urgency = e.days_left < 7 ? '#f87171' : e.days_left < 14 ? '#fbbf24' : e.color;
    return `<div class="exam-card">
      <div class="exam-card-left">
        <div class="exam-card-name">${e.subject}</div>
        <div class="exam-card-date">${formatDate(e.date)} · ${e.readiness}% ready</div>
        <div class="exam-card-bar-wrap"><div class="exam-card-bar" style="width:${e.readiness}%;background:${e.color}"></div></div>
      </div>
      <div class="exam-days-left">
        <div class="exam-days-num" style="color:${urgency}">${e.days_left > 0 ? e.days_left : '!'}</div>
        <div class="exam-days-lbl">days left</div>
      </div>
    </div>`;
  }).join('');
}

function formatDate(str) {
  return new Date(str).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

document.addEventListener('DOMContentLoaded', loadProgress);
