// revision.js — Groq AI bot + logs sessions to backend
// ══════════════════════════════════════════
//  🔑 PASTE YOUR GROQ API KEY HERE
const GROQ_API_KEY = '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';
// ══════════════════════════════════════════

let currentTopic = null, currentSubject = null, currentTopicId = null;
let currentMode = 'socratic', messageHistory = [], isWaiting = false;
let sessionStartTime = null, messageCount = 0;

const MODE_PROMPTS = {
  socratic: `You are a Socratic tutor. NEVER give direct answers. Ask ONE probing question at a time that guides the student to discover the answer. Be encouraging. Keep responses to 2-4 sentences.`,
  debate:   `You are a devil's advocate. Take the OPPOSITE position to whatever the student says. Challenge their reasoning. Be punchy (2-3 sentences). Always end with a counter-argument.`,
  quiz:     `You are a quiz master. Ask ONE question at a time. If correct: "✓ Correct!" + brief explanation + harder question. If wrong: "✗ Not quite —" + hint. Start easy, get harder.`,
};

const MODE_STARTERS = {
  socratic: t => `Let's explore **${t}** using the Socratic method.\n\nWhat do you already know about ${t}? Don't worry about being perfect — just tell me what comes to mind.`,
  debate:   t => `We're debating **${t}**. I'll argue the opposite of whatever you say.\n\nMake your opening statement — what's the most important thing to understand about ${t}? 🥊`,
  quiz:     t => `Quiz time on **${t}**! 📝\n\n**Question 1:** Can you define ${t} in your own words and give one real-world example?`,
};

async function loadTopics() {
  const res = await API.get('/api/topics');
  if (!res?.topics?.length) {
    document.getElementById('topic-list').innerHTML = '<div style="padding:16px;color:var(--text-3);font-size:13px">No topics yet — <a href="/onboarding" style="color:var(--accent)">complete setup first</a></div>';
    return;
  }
  // Populate subject filter
  const subjects = [...new Set(res.topics.map(t => t.subject))];
  const filter = document.getElementById('subject-filter');
  subjects.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; filter.appendChild(o); });

  window._allTopics = res.topics;
  renderTopicList(res.topics);
}

function renderTopicList(topics) {
  const list = document.getElementById('topic-list');
  list.innerHTML = '';
  const bySubject = {};
  topics.filter(t => t.selected).forEach(t => { bySubject[t.subject] = bySubject[t.subject] || []; bySubject[t.subject].push(t); });
  const COLORS = {'Data Structures':'#4ade80','Operating Systems':'#60a5fa','Database Systems':'#fbbf24','Computer Networks':'#a78bfa','General':'#f87171'};
  Object.entries(bySubject).forEach(([subject, ts]) => {
    const label = document.createElement('div');
    label.style.cssText = 'font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-3);padding:10px 10px 4px';
    label.textContent = subject;
    list.appendChild(label);
    ts.forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'topic-btn';
      btn.id = `topic-btn-${t.id}`;
      btn.innerHTML = `<span class="topic-dot" style="background:${COLORS[subject]||'#60a5fa'}"></span>${t.name}`;
      btn.onclick = () => selectTopic(t.id, t.subject, t.name);
      list.appendChild(btn);
    });
  });
}

function filterTopics() {
  const val = document.getElementById('subject-filter').value;
  const all = window._allTopics || [];
  renderTopicList(val === 'all' ? all : all.filter(t => t.subject === val));
  if (currentTopicId) document.getElementById(`topic-btn-${currentTopicId}`)?.classList.add('active');
}

function selectTopic(id, subject, name) {
  currentTopicId = id; currentSubject = subject; currentTopic = name;
  messageHistory = []; messageCount = 0; sessionStartTime = Date.now();
  document.querySelectorAll('.topic-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`topic-btn-${id}`)?.classList.add('active');
  document.getElementById('chat-topic-name').textContent = name;
  document.getElementById('chat-topic-sub').textContent = `${subject} · ${currentMode.charAt(0).toUpperCase()+currentMode.slice(1)} mode`;
  document.getElementById('chat-messages').innerHTML = '';
  document.getElementById('chat-input').disabled = false;
  document.getElementById('send-btn').disabled = false;
  document.getElementById('chat-input').focus();
  const opener = MODE_STARTERS[currentMode](name);
  addMessage('bot', opener);
  messageHistory.push({ role: 'assistant', content: opener });
}

function setMode(mode, btn) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (currentTopic) { showToast(`Switched to ${mode} mode`); setTimeout(() => selectTopic(currentTopicId, currentSubject, currentTopic), 300); }
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || isWaiting) return;
  if (GROQ_API_KEY === 'your_groq_api_key_here') {
    addMessage('bot', '⚠️ **Groq API key not set!**\n\nOpen `static/js/revision.js` and paste your key at the top.\n\nGet one free at **console.groq.com**');
    return;
  }
  input.value = ''; input.style.height = 'auto';
  isWaiting = true; messageCount++;
  document.getElementById('send-btn').disabled = true;
  input.disabled = true;
  addMessage('user', text);
  messageHistory.push({ role: 'user', content: text });
  const typingId = showTyping();
  try {
    const reply = await callGroq();
    removeTyping(typingId);
    addMessage('bot', reply);
    messageHistory.push({ role: 'assistant', content: reply });
  } catch (err) {
    removeTyping(typingId);
    addMessage('bot', `⚠️ Error: ${err.message}`);
  }
  isWaiting = false;
  document.getElementById('send-btn').disabled = false;
  input.disabled = false; input.focus();
}

async function callGroq() {
  const system = `${MODE_PROMPTS[currentMode]}\n\nStudent is revising: "${currentTopic}" (${currentSubject}). Stay focused on this topic.`;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 500, temperature: 0.7,
      messages: [{ role: 'system', content: system }, ...messageHistory.slice(-12)] }),
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error?.message || `HTTP ${res.status}`); }
  return (await res.json()).choices[0]?.message?.content || 'No response.';
}

function addMessage(role, text) {
  document.getElementById('chat-empty')?.remove();
  const msgs = document.getElementById('chat-messages');
  const wrap = document.createElement('div'); wrap.className = `msg ${role}`;
  const avatar = document.createElement('div'); avatar.className = 'msg-avatar'; avatar.textContent = role === 'bot' ? '🤖' : '👤';
  const bubble = document.createElement('div'); bubble.className = 'msg-bubble'; bubble.innerHTML = fmt(text);
  const time = document.createElement('div'); time.className = 'msg-time';
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const inner = document.createElement('div'); inner.appendChild(bubble); inner.appendChild(time);
  wrap.appendChild(avatar); wrap.appendChild(inner); msgs.appendChild(wrap);
  if (role === 'bot') typewrite(bubble, text);
  msgs.scrollTop = msgs.scrollHeight;
}

function typewrite(el, text) {
  const html = fmt(text); el.innerHTML = ''; const chars = html.split(''); let i = 0;
  const iv = setInterval(() => { el.innerHTML += chars[i]||''; i++; if (i >= chars.length) { clearInterval(iv); el.innerHTML = html; document.getElementById('chat-messages').scrollTop=99999; } }, 8);
}

function fmt(text) {
  return text.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>')
    .replace(/`(.*?)`/g,'<code style="background:var(--bg4);padding:1px 5px;border-radius:3px;font-size:12px">$1</code>')
    .replace(/\n\n/g,'</p><p style="margin-top:8px">').replace(/\n/g,'<br>');
}

function showTyping() {
  const msgs = document.getElementById('chat-messages');
  const id = 'typing-' + Date.now();
  const wrap = document.createElement('div'); wrap.className = 'typing-indicator'; wrap.id = id;
  wrap.innerHTML = `<div style="width:30px;height:30px;border-radius:8px;background:var(--accent-dim);border:1px solid var(--accent-border);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">🤖</div>
    <div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
  msgs.appendChild(wrap); msgs.scrollTop = msgs.scrollHeight; return id;
}
function removeTyping(id) { document.getElementById(id)?.remove(); }

async function endSession() {
  if (!currentTopic || messageCount === 0) { showToast('No active session', 'error'); return; }
  const mins = Math.round((Date.now() - sessionStartTime) / 60000);
  // Log to backend
  await API.post('/api/progress/session', {
    topic_id: currentTopicId, topic_name: currentTopic, subject: currentSubject,
    mode: currentMode, duration_minutes: mins, exchanges: messageCount,
  });
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="session-summary">
    <div class="summary-title">📊 Session Summary</div>
    <div class="summary-item"><span>Topic</span><span>${currentTopic}</span></div>
    <div class="summary-item"><span>Subject</span><span>${currentSubject}</span></div>
    <div class="summary-item"><span>Mode</span><span>${currentMode}</span></div>
    <div class="summary-item"><span>Duration</span><span>${mins} min</span></div>
    <div class="summary-item"><span>Exchanges</span><span>${messageCount}</span></div>
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:12px;color:var(--text-2)">
      Saved! See your <a href="/progress" style="color:var(--accent)">Progress page</a>.
    </div></div>`;
  document.getElementById('chat-messages').appendChild(wrap);
  document.getElementById('chat-messages').scrollTop = 99999;
  document.getElementById('chat-input').disabled = true;
  document.getElementById('send-btn').disabled = true;
  showToast(`Session saved — ${mins} min on ${currentTopic}`);
  currentTopic = null; messageCount = 0;
}

function handleKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }

document.addEventListener('DOMContentLoaded', loadTopics);
