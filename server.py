"""
StudyAI — Unified Server
Runs the full app: backend API + serves all frontend pages
Usage: python server.py
Then open: http://localhost:8000
"""

import os, io, uuid, json, requests, webbrowser
from datetime import datetime, timedelta
from typing import List

import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from sqlalchemy import create_engine, Column, String, Integer, Text, DateTime, Boolean, ForeignKey, Date
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

from passlib.context import CryptContext
from jose import JWTError, jwt
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from pydantic import BaseModel
from dotenv import load_dotenv

import pdfplumber
from docx import Document
from pptx import Presentation

load_dotenv()

# ════════════════════════════════════════════
#  CONFIG
# ════════════════════════════════════════════
GROQ_API_KEY  = os.getenv("GROQ_API_KEY", "your_groq_api_key_here")
JWT_SECRET    = os.getenv("JWT_SECRET", "dev_secret_change_in_production")
DATABASE_URL  = os.getenv("DATABASE_URL", "sqlite:///./studyai.db")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30
GROQ_URL      = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL    = "llama-3.3-70b-versatile"

# ════════════════════════════════════════════
#  DATABASE
# ════════════════════════════════════════════
engine       = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base         = declarative_base()

class User(Base):
    __tablename__ = "users"
    id            = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email         = Column(String, unique=True, nullable=False)
    name          = Column(String)
    password_hash = Column(String, nullable=False)
    created_at    = Column(DateTime, default=datetime.utcnow)

class FileRecord(Base):
    __tablename__ = "files"
    id             = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id        = Column(String, ForeignKey("users.id"))
    name           = Column(String)
    label          = Column(String)
    size           = Column(Integer)
    extracted_text = Column(Text)
    uploaded_at    = Column(DateTime, default=datetime.utcnow)

class Topic(Base):
    __tablename__ = "topics"
    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = Column(String, ForeignKey("users.id"))
    name       = Column(String)
    subject    = Column(String)
    weight     = Column(String, default="medium")
    selected   = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Exam(Base):
    __tablename__ = "exams"
    id        = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id   = Column(String, ForeignKey("users.id"))
    subject   = Column(String)
    exam_date = Column(String)
    exam_type = Column(String, default="final")

class StudySession(Base):
    __tablename__ = "study_sessions"
    id               = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id          = Column(String, ForeignKey("users.id"))
    topic_id         = Column(String)
    subject          = Column(String)
    topic_name       = Column(String)
    scheduled_date   = Column(String)
    duration_minutes = Column(Integer, default=45)
    completed        = Column(Boolean, default=False)

class RevisionLog(Base):
    __tablename__ = "revision_logs"
    id               = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id          = Column(String, ForeignKey("users.id"))
    topic_id         = Column(String)
    topic_name       = Column(String)
    subject          = Column(String)
    mode             = Column(String)
    duration_minutes = Column(Integer)
    exchanges        = Column(Integer)
    logged_at        = Column(DateTime, default=datetime.utcnow)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ════════════════════════════════════════════
#  AUTH HELPERS
# ════════════════════════════════════════════
pwd_context   = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)

def hash_password(p): return pwd_context.hash(p)
def verify_password(plain, hashed): return pwd_context.verify(plain, hashed)

def create_token(user_id: str) -> str:
    return jwt.encode(
        {"sub": user_id, "exp": datetime.utcnow() + timedelta(days=JWT_EXPIRE_DAYS)},
        JWT_SECRET, algorithm=JWT_ALGORITHM
    )

def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db)
) -> User:
    if not creds:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
    except JWTError:
        raise HTTPException(401, "Invalid or expired token")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(401, "User not found")
    return user

# ════════════════════════════════════════════
#  FILE EXTRACTION
# ════════════════════════════════════════════
def extract_text(filename: str, file_bytes: bytes) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    try:
        if ext == "pdf":
            parts = []
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                for page in pdf.pages:
                    t = page.extract_text()
                    if t: parts.append(t)
            return "\n\n".join(parts)
        elif ext in ("doc", "docx"):
            doc = Document(io.BytesIO(file_bytes))
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        elif ext in ("ppt", "pptx"):
            prs = Presentation(io.BytesIO(file_bytes))
            parts = []
            for i, slide in enumerate(prs.slides, 1):
                texts = [s.text.strip() for s in slide.shapes if hasattr(s, "text") and s.text.strip()]
                if texts: parts.append(f"[Slide {i}]\n" + "\n".join(texts))
            return "\n\n".join(parts)
        elif ext == "txt":
            return file_bytes.decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"Extraction error: {e}")
    return ""

# ════════════════════════════════════════════
#  GROQ AI HELPERS
# ════════════════════════════════════════════
def call_groq(system: str, user: str, max_tokens: int = 2000) -> str:
    if not GROQ_API_KEY or GROQ_API_KEY == "your_groq_api_key_here":
        raise ValueError("GROQ_API_KEY not set in .env")
    r = requests.post(GROQ_URL,
        headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
        json={"model": GROQ_MODEL, "max_tokens": max_tokens, "temperature": 0.3,
              "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
        timeout=30)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]

def parse_json_response(raw: str) -> any:
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"): raw = raw[4:]
    return json.loads(raw.strip())

# ════════════════════════════════════════════
#  FASTAPI APP
# ════════════════════════════════════════════
app = FastAPI(title="StudyAI", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory="static"), name="static")

# ── Pydantic models ──
class RegisterBody(BaseModel):
    email: str
    password: str
    name: str = ""

class LoginBody(BaseModel):
    email: str
    password: str

class TopicCreate(BaseModel):
    name: str
    subject: str = "General"
    weight: str = "medium"

class TopicUpdate(BaseModel):
    name: str | None = None
    selected: bool | None = None

class ExamCreate(BaseModel):
    subject: str
    date: str
    exam_type: str = "final"

class GeneratePlanBody(BaseModel):
    days: List[str]
    hours_per_day: int = 3
    session_minutes: int = 45
    style: str = "balanced"

class LogSessionBody(BaseModel):
    topic_id: str
    topic_name: str
    subject: str
    mode: str
    duration_minutes: int
    exchanges: int

# ════════════════════════════════════════════
#  FRONTEND PAGE ROUTES
# ════════════════════════════════════════════
def page(title: str, active: str, body: str) -> str:
    nav_items = [
        ("index", "Dashboard", "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"),
        ("upload", "Upload Materials", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12"),
        ("onboarding", "Setup Plan", "M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"),
        ("roadmap", "Roadmap", "M3 4h18v16H3z M16 2v4 M8 2v4 M3 10h18"),
        ("revision", "Revision Bot", "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"),
        ("progress", "Progress", "M18 20V10 M12 20V4 M6 20v-6"),
    ]
    nav_html = ""
    for key, label, path in nav_items:
        active_class = "active" if key == active else ""
        nav_html += f'''<a href="/{key}" class="nav-item {active_class}">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="{path}"/></svg>
          {label}</a>'''

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StudyAI — {title}</title>
  <link rel="stylesheet" href="/static/css/style.css">
  <link rel="stylesheet" href="/static/css/mobile.css">
</head>
<body>
<div class="app-layout">
  <nav class="sidebar">
    <div class="sidebar-logo"><div class="logo-icon">🎓</div><span class="logo-text">StudyAI</span></div>
    <span class="nav-section-label">Main</span>
    {nav_html}
    <div class="sidebar-bottom">
      <div class="user-pill">
        <div class="user-avatar" id="user-avatar">S</div>
        <div><div class="user-name" id="user-name">Student</div><div class="user-plan">Free plan</div></div>
      </div>
    </div>
  </nav>
  <main class="main-content page-enter">
    <div id="auth-banner" style="display:none" class="error-banner">
      <span class="error-banner-icon">🔒</span>
      <span class="error-banner-text">Please <a href="/login" style="color:var(--accent)">log in</a> to use StudyAI</span>
    </div>
    {body}
  </main>
</div>
<div class="toast-container"></div>
<script src="/static/js/app.js"></script>
<script src="/static/js/polish.js"></script>
<script src="/static/js/api.js"></script>
</body>
</html>"""

@app.get("/", response_class=HTMLResponse)
@app.get("/index", response_class=HTMLResponse)
def home():
    return page("Dashboard", "index", """
    <div class="welcome-banner">
      <div class="welcome-title">Good morning 👋</div>
      <div class="welcome-sub">Ready to study smart? Upload your materials to get started.</div>
      <div class="flex gap-8">
        <a href="/upload" class="btn btn-primary">Upload materials</a>
        <a href="/onboarding" class="btn btn-secondary">Setup study plan</a>
      </div>
    </div>
    <div class="step-banner">
      <div>
        <div class="step-banner-text">🚀 Complete your setup to unlock your personalised roadmap</div>
        <div class="step-banner-sub">Step 1 of 4 — Upload your syllabus and study materials</div>
      </div>
      <a href="/upload" class="btn btn-sm" style="background:var(--amber-dim);color:var(--amber);border:1px solid rgba(251,191,36,0.3);flex-shrink:0">Continue →</a>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Files uploaded</div><div class="stat-value" id="stat-files">—</div><div class="stat-note">Syllabus, notes, slides</div></div>
      <div class="stat-card"><div class="stat-label">Topics identified</div><div class="stat-value" id="stat-topics">—</div><div class="stat-note">From your syllabus</div></div>
      <div class="stat-card"><div class="stat-label">Days to next exam</div><div class="stat-value" id="stat-days">—</div><div class="stat-note">Upcoming exam</div></div>
    </div>
    <div class="page-header" style="margin-bottom:16px"><div class="card-title">Quick actions</div></div>
    <div class="action-grid">
      <a href="/upload" class="action-card"><div class="action-icon">📁</div><div class="action-title">Upload materials</div><div class="action-desc">Add your syllabus, lecture notes, and slides</div></a>
      <a href="/onboarding" class="action-card"><div class="action-icon">🗺️</div><div class="action-title">Build study plan</div><div class="action-desc">Set up your exam schedule and daily availability</div></a>
      <a href="/revision" class="action-card"><div class="action-icon">🤖</div><div class="action-title">Start revision</div><div class="action-desc">Practice with Socratic dialogues and debates</div></a>
      <a href="/progress" class="action-card"><div class="action-icon">📈</div><div class="action-title">View progress</div><div class="action-desc">Track topics covered and upcoming deadlines</div></a>
    </div>
    <script>
    (async()=>{
      const token=localStorage.getItem('token');
      if(!token){document.getElementById('auth-banner').style.display='flex';return;}
      const [files,topics,exams]=await Promise.all([
        API.get('/api/files'),API.get('/api/topics'),API.get('/api/exams')
      ]);
      if(files?.files) document.getElementById('stat-files').textContent=files.files.length;
      if(topics?.topics) document.getElementById('stat-topics').textContent=topics.topics.filter(t=>t.selected).length;
      if(exams?.exams?.length){
        const next=exams.exams.sort((a,b)=>new Date(a.date)-new Date(b.date))[0];
        const days=Math.ceil((new Date(next.date)-new Date())/86400000);
        document.getElementById('stat-days').textContent=days>0?days+'d':'Today!';
      }
    })();
    </script>
    """)

@app.get("/login", response_class=HTMLResponse)
def login_page():
    return """<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StudyAI — Login</title>
<link rel="stylesheet" href="/static/css/style.css">
<style>
.auth-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:20px;}
.auth-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:40px;width:100%;max-width:400px;}
.auth-logo{display:flex;align-items:center;gap:10px;margin-bottom:28px;}
.auth-logo .logo-icon{width:36px;height:36px;background:var(--accent);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px;}
.auth-logo span{font-family:var(--font-display);font-size:20px;font-weight:700;color:var(--text);}
.auth-title{font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--text);margin-bottom:6px;}
.auth-sub{font-size:14px;color:var(--text-2);margin-bottom:28px;}
.auth-footer{text-align:center;margin-top:20px;font-size:13px;color:var(--text-2);}
.auth-footer a{color:var(--accent);text-decoration:none;}
</style></head>
<body>
<div class="auth-wrap">
  <div class="auth-card">
    <div class="auth-logo"><div class="logo-icon">🎓</div><span>StudyAI</span></div>
    <div class="auth-title">Welcome back</div>
    <div class="auth-sub">Log in to continue studying</div>
    <div class="form-group"><label class="form-label">Email</label><input type="email" class="form-input" id="email" placeholder="you@university.edu"></div>
    <div class="form-group"><label class="form-label">Password</label><input type="password" class="form-input" id="password" placeholder="Your password" onkeydown="if(event.key==='Enter')doLogin()"></div>
    <div id="err" style="display:none;color:var(--coral);font-size:13px;margin-bottom:12px"></div>
    <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="doLogin()" id="login-btn">Log in</button>
    <div class="auth-footer">Don't have an account? <a href="/register">Sign up free</a></div>
  </div>
</div>
<script src="/static/js/app.js"></script>
<script src="/static/js/api.js"></script>
<script>
async function doLogin(){
  const email=document.getElementById('email').value.trim();
  const password=document.getElementById('password').value;
  const err=document.getElementById('err');
  const btn=document.getElementById('login-btn');
  if(!email||!password){err.style.display='block';err.textContent='Please fill in all fields';return;}
  btn.textContent='Logging in…';btn.disabled=true;
  const res=await API.post('/api/auth/login',{email,password});
  if(res.token){localStorage.setItem('token',res.token);localStorage.setItem('user',JSON.stringify(res.user));window.location.href='/';}
  else{err.style.display='block';err.textContent=res.detail||'Login failed';btn.textContent='Log in';btn.disabled=false;}
}
</script>
</body></html>"""

@app.get("/register", response_class=HTMLResponse)
def register_page():
    return """<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StudyAI — Sign Up</title>
<link rel="stylesheet" href="/static/css/style.css">
<style>
.auth-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:20px;}
.auth-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:40px;width:100%;max-width:400px;}
.auth-logo{display:flex;align-items:center;gap:10px;margin-bottom:28px;}
.auth-logo .logo-icon{width:36px;height:36px;background:var(--accent);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px;}
.auth-logo span{font-family:var(--font-display);font-size:20px;font-weight:700;color:var(--text);}
.auth-title{font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--text);margin-bottom:6px;}
.auth-sub{font-size:14px;color:var(--text-2);margin-bottom:28px;}
.auth-footer{text-align:center;margin-top:20px;font-size:13px;color:var(--text-2);}
.auth-footer a{color:var(--accent);text-decoration:none;}
</style></head>
<body>
<div class="auth-wrap">
  <div class="auth-card">
    <div class="auth-logo"><div class="logo-icon">🎓</div><span>StudyAI</span></div>
    <div class="auth-title">Create your account</div>
    <div class="auth-sub">Free forever for students</div>
    <div class="form-group"><label class="form-label">Name</label><input type="text" class="form-input" id="name" placeholder="Your name"></div>
    <div class="form-group"><label class="form-label">Email</label><input type="email" class="form-input" id="email" placeholder="you@university.edu"></div>
    <div class="form-group"><label class="form-label">Password</label><input type="password" class="form-input" id="password" placeholder="Choose a password" onkeydown="if(event.key==='Enter')doRegister()"></div>
    <div id="err" style="display:none;color:var(--coral);font-size:13px;margin-bottom:12px"></div>
    <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="doRegister()" id="reg-btn">Create account</button>
    <div class="auth-footer">Already have an account? <a href="/login">Log in</a></div>
  </div>
</div>
<script src="/static/js/app.js"></script>
<script src="/static/js/api.js"></script>
<script>
async function doRegister(){
  const name=document.getElementById('name').value.trim();
  const email=document.getElementById('email').value.trim();
  const password=document.getElementById('password').value;
  const err=document.getElementById('err');
  const btn=document.getElementById('reg-btn');
  if(!email||!password){err.style.display='block';err.textContent='Please fill in all fields';return;}
  btn.textContent='Creating account…';btn.disabled=true;
  const res=await API.post('/api/auth/register',{name,email,password});
  if(res.token){localStorage.setItem('token',res.token);localStorage.setItem('user',JSON.stringify(res.user));window.location.href='/';}
  else{err.style.display='block';err.textContent=res.detail||'Registration failed';btn.textContent='Create account';btn.disabled=false;}
}
</script>
</body></html>"""

@app.get("/upload", response_class=HTMLResponse)
def upload_page():
    return page("Upload Materials", "upload", """
    <div class="page-header">
      <div class="page-tag">Step 1 of 4</div>
      <h1 class="page-title">Upload your materials</h1>
      <p class="page-subtitle">Add your syllabus, lecture notes, slides, and exam schedule</p>
    </div>
    <div class="upload-zone" id="drop-zone" onclick="document.getElementById('file-input').click()">
      <span style="font-size:48px;display:block;margin-bottom:16px">📂</span>
      <div class="upload-title">Drop files here or click to browse</div>
      <div class="upload-sub">PDF, DOCX, PPTX, TXT — max 20MB each</div>
      <div class="upload-types">
        <span class="type-pill">PDF</span><span class="type-pill">DOCX</span><span class="type-pill">PPTX</span><span class="type-pill">TXT</span>
      </div>
      <input type="file" id="file-input" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.txt" style="display:none">
    </div>
    <div id="upload-progress" style="display:none" class="card" style="margin-top:16px">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="ai-spinner"></div>
        <div><div style="font-size:14px;font-weight:500;color:var(--text)">Uploading and extracting text…</div>
        <div style="font-size:12px;color:var(--text-2);margin-top:2px" id="upload-progress-text">Processing files</div></div>
      </div>
    </div>
    <div class="file-list" id="file-list-section" style="display:none;margin-top:28px">
      <div class="file-list-header">
        <span class="file-list-title">Uploaded files <span id="file-count" class="badge badge-green" style="margin-left:8px">0</span></span>
        <button class="btn btn-ghost btn-sm" onclick="loadFiles()">↺ Refresh</button>
      </div>
      <div id="file-list"></div>
    </div>
    <div class="empty-state" id="empty-state">No files yet — drag and drop above to get started</div>
    <div class="upload-cta" id="upload-cta" style="display:none">
      <div><div class="upload-cta-text">✅ Files ready — move to next step</div>
      <div class="upload-cta-sub">Continue to confirm your topics</div></div>
      <a href="/onboarding" class="btn btn-primary">Continue to setup →</a>
    </div>
    <style>
    .upload-zone{border:2px dashed var(--border);border-radius:var(--radius-lg);padding:60px 40px;text-align:center;transition:all .2s;cursor:pointer;background:var(--bg2);}
    .upload-zone:hover,.upload-zone.drag-over{border-color:var(--accent);background:var(--accent-dim);}
    .upload-title{font-family:var(--font-display);font-size:20px;font-weight:700;color:var(--text);margin-bottom:8px;}
    .upload-sub{font-size:14px;color:var(--text-2);margin-bottom:20px;}
    .upload-types{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;}
    .type-pill{font-size:11px;padding:3px 10px;border-radius:20px;background:var(--bg3);border:1px solid var(--border);color:var(--text-2);font-weight:500;}
    .file-list-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
    .file-list-title{font-family:var(--font-display);font-size:16px;font-weight:600;color:var(--text);}
    .file-item{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 18px;display:flex;align-items:center;gap:14px;margin-bottom:10px;}
    .file-icon-wrap{width:40px;height:40px;background:var(--bg3);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}
    .file-info{flex:1;min-width:0;}
    .file-name{font-size:14px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .file-meta{font-size:12px;color:var(--text-3);margin-top:2px;}
    .file-delete{background:none;border:none;color:var(--text-3);cursor:pointer;font-size:18px;padding:4px;border-radius:4px;transition:color .15s;line-height:1;}
    .file-delete:hover{color:var(--coral);}
    .upload-cta{margin-top:32px;display:flex;align-items:center;justify-content:space-between;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:18px 22px;}
    .upload-cta-text{font-size:14px;color:var(--text);}
    .upload-cta-sub{font-size:12px;color:var(--text-2);margin-top:2px;}
    .ai-spinner{width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0;}
    @keyframes spin{to{transform:rotate(360deg)}}
    </style>
    <script src="/static/js/upload.js"></script>
    """)

@app.get("/onboarding", response_class=HTMLResponse)
def onboarding_page():
    return page("Setup Plan", "onboarding", open("static/partials/onboarding_body.html").read() if os.path.exists("static/partials/onboarding_body.html") else "<p>Loading...</p>")

@app.get("/roadmap", response_class=HTMLResponse)
def roadmap_page():
    return page("Roadmap", "roadmap", """
    <div class="page-header">
      <div class="page-tag">Study plan</div>
      <h1 class="page-title">Study Roadmap</h1>
      <p class="page-subtitle">Your AI-generated day-by-day study plan</p>
    </div>
    <div id="exam-strip" class="exam-strip"></div>
    <div class="roadmap-controls">
      <div class="month-nav">
        <button class="month-nav-btn" onclick="changeMonth(-1)">‹</button>
        <div class="month-label" id="month-label"></div>
        <button class="month-nav-btn" onclick="changeMonth(1)">›</button>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <div class="legend-row" id="legend-row"></div>
        <button class="btn btn-secondary btn-sm" onclick="regeneratePlan()">↺ Regenerate</button>
      </div>
    </div>
    <div class="roadmap-layout">
      <div>
        <div class="calendar-wrap">
          <div class="cal-header">
            <div class="cal-day-label">Sun</div><div class="cal-day-label">Mon</div>
            <div class="cal-day-label">Tue</div><div class="cal-day-label">Wed</div>
            <div class="cal-day-label">Thu</div><div class="cal-day-label">Fri</div>
            <div class="cal-day-label">Sat</div>
          </div>
          <div class="cal-grid" id="cal-grid"></div>
        </div>
      </div>
      <div class="side-panel">
        <div class="today-card"><div class="today-card-title">📅 Today's sessions</div><div id="today-tasks"></div></div>
        <div class="today-card"><div class="today-card-title">📊 This week</div><div id="week-stats"></div></div>
      </div>
    </div>
    <div class="event-tooltip" id="tooltip"><div class="tooltip-title" id="tooltip-title"></div><div class="tooltip-meta" id="tooltip-meta"></div></div>
    <script src="/static/js/roadmap.js"></script>
    """)

@app.get("/revision", response_class=HTMLResponse)
def revision_page():
    return page("Revision Bot", "revision", """
    <div class="page-header" style="margin-bottom:20px">
      <div class="page-tag">AI Tutor</div>
      <h1 class="page-title">Revision Bot</h1>
      <p class="page-subtitle">Learn through Socratic dialogue, debate, and active recall</p>
    </div>
    <div class="revision-layout">
      <div class="topic-sidebar">
        <div class="topic-sidebar-head">
          <div class="topic-sidebar-title">Topics</div>
          <select class="subject-filter" id="subject-filter" onchange="filterTopics()">
            <option value="all">All subjects</option>
          </select>
        </div>
        <div class="topic-list" id="topic-list"><div style="padding:16px;color:var(--text-3);font-size:13px">Loading topics…</div></div>
      </div>
      <div class="chat-area">
        <div class="chat-header">
          <div class="chat-header-left">
            <div class="bot-avatar">🤖</div>
            <div>
              <div class="chat-topic-name" id="chat-topic-name">Select a topic</div>
              <div class="chat-topic-sub" id="chat-topic-sub">Choose a topic from the left to begin</div>
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            <div class="mode-switcher">
              <button class="mode-btn active" onclick="setMode('socratic',this)">🧠 Socratic</button>
              <button class="mode-btn" onclick="setMode('debate',this)">⚔️ Debate</button>
              <button class="mode-btn" onclick="setMode('quiz',this)">📝 Quiz</button>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="endSession()">End session</button>
          </div>
        </div>
        <div class="chat-messages" id="chat-messages">
          <div class="chat-empty" id="chat-empty">
            <div class="chat-empty-icon">🤖</div>
            <div class="chat-empty-title">Pick a topic to start revising</div>
            <div class="chat-empty-sub">The bot will guide you using questions, debates, and active recall.</div>
          </div>
        </div>
        <div class="chat-input-bar">
          <textarea class="chat-input" id="chat-input" placeholder="Type your answer…" rows="1"
            onkeydown="handleKey(event)" oninput="autoResize(this)" disabled></textarea>
          <button class="send-btn" id="send-btn" onclick="sendMessage()" disabled>➤</button>
        </div>
      </div>
    </div>
    <script src="/static/js/revision.js"></script>
    """)

@app.get("/progress", response_class=HTMLResponse)
def progress_page():
    return page("Progress", "progress", """
    <div class="page-header">
      <div class="page-tag">Analytics</div>
      <h1 class="page-title">Your Progress</h1>
      <p class="page-subtitle">Track what you've covered and what needs more attention</p>
    </div>
    <div class="stat-row" id="stat-row">
      <div class="stat-card"><div class="stat-icon">📚</div><div class="stat-val" id="p-topics">—</div><div class="stat-lbl">Topics covered</div></div>
      <div class="stat-card"><div class="stat-icon">⏱️</div><div class="stat-val" id="p-hours">—</div><div class="stat-lbl">Study time</div></div>
      <div class="stat-card"><div class="stat-icon">🤖</div><div class="stat-val" id="p-exchanges">—</div><div class="stat-lbl">Bot exchanges</div></div>
      <div class="stat-card"><div class="stat-icon">🎯</div><div class="stat-val" id="p-pct">—</div><div class="stat-lbl">Syllabus covered</div></div>
    </div>
    <div class="streak-card" id="streak-card"></div>
    <div class="progress-grid">
      <div class="card"><div class="card-title">Topic coverage</div><div class="card-subtitle">Per subject breakdown</div><div id="topics-progress"></div></div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card"><div class="heatmap-title">Study activity</div><div id="heatmap"></div></div>
        <div class="card"><div class="card-title">Upcoming exams</div><div class="card-subtitle">Days remaining</div><div id="exam-cards"></div></div>
      </div>
    </div>
    <script src="/static/js/progress.js"></script>
    """)

# ════════════════════════════════════════════
#  API ROUTES
# ════════════════════════════════════════════

# ── Auth ──
@app.post("/api/auth/register")
def register(body: RegisterBody, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(400, "Email already registered")
    user = User(email=body.email, name=body.name, password_hash=hash_password(body.password))
    db.add(user); db.commit(); db.refresh(user)
    return {"token": create_token(user.id), "user": {"id": user.id, "name": user.name, "email": user.email}}

@app.post("/api/auth/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")
    return {"token": create_token(user.id), "user": {"id": user.id, "name": user.name, "email": user.email}}

@app.get("/api/auth/me")
def me(u: User = Depends(get_current_user)):
    return {"id": u.id, "name": u.name, "email": u.email}

# ── Files ──
@app.post("/api/upload")
async def upload(files: List[UploadFile] = File(...), labels: List[str] = Form(...),
                 db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    results = []
    for f, label in zip(files, labels):
        ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
        if ext not in {"pdf","doc","docx","ppt","pptx","txt"}:
            raise HTTPException(400, f"'{f.filename}' not supported")
        data = await f.read()
        if len(data) > 20*1024*1024: raise HTTPException(400, f"'{f.filename}' too large (max 20MB)")
        rec = FileRecord(user_id=u.id, name=f.filename, label=label, size=len(data), extracted_text=extract_text(f.filename, data))
        db.add(rec); db.commit(); db.refresh(rec)
        results.append({"id": rec.id, "name": rec.name, "label": rec.label, "size": rec.size,
                        "uploaded_at": rec.uploaded_at.isoformat(), "has_text": bool(rec.extracted_text)})
    return {"success": True, "files": results}

@app.get("/api/files")
def list_files(db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    files = db.query(FileRecord).filter(FileRecord.user_id == u.id).all()
    return {"files": [{"id": f.id,"name": f.name,"label": f.label,"size": f.size,"uploaded_at": f.uploaded_at.isoformat()} for f in files]}

@app.delete("/api/files/{file_id}")
def delete_file(file_id: str, db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    f = db.query(FileRecord).filter(FileRecord.id == file_id, FileRecord.user_id == u.id).first()
    if not f: raise HTTPException(404, "File not found")
    db.delete(f); db.commit()
    return {"success": True}

# ── Topics ──
@app.post("/api/extract-topics")
def extract_topics_route(body: dict, db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    f = db.query(FileRecord).filter(FileRecord.id == body.get("file_id"), FileRecord.user_id == u.id).first()
    if not f: raise HTTPException(404, "File not found")
    if not f.extracted_text: raise HTTPException(400, "No text extracted from file")
    try:
        raw = call_groq(
            "Extract study topics from syllabus text. Return ONLY a JSON array. Each item: {name, subject, weight (high|medium|low)}. No markdown, no explanation.",
            f"Extract topics from:\n\n{f.extracted_text[:6000]}\n\nReturn ONLY a JSON array."
        )
        topics_data = parse_json_response(raw)
    except Exception as e:
        raise HTTPException(500, f"AI extraction failed: {e}")
    db.query(Topic).filter(Topic.user_id == u.id).delete()
    saved = []
    for t in topics_data:
        if not isinstance(t, dict) or "name" not in t: continue
        topic = Topic(user_id=u.id, name=t.get("name","").strip(), subject=t.get("subject","General").strip(),
                      weight=t.get("weight","medium") if t.get("weight") in ["high","medium","low"] else "medium")
        db.add(topic); db.commit(); db.refresh(topic)
        saved.append({"id": topic.id,"name": topic.name,"subject": topic.subject,"weight": topic.weight,"selected": topic.selected})
    return {"topics": saved, "count": len(saved)}

@app.get("/api/topics")
def list_topics(db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    topics = db.query(Topic).filter(Topic.user_id == u.id).all()
    return {"topics": [{"id": t.id,"name": t.name,"subject": t.subject,"weight": t.weight,"selected": t.selected} for t in topics]}

@app.post("/api/topics")
def add_topic(body: TopicCreate, db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    t = Topic(user_id=u.id, name=body.name, subject=body.subject, weight=body.weight)
    db.add(t); db.commit(); db.refresh(t)
    return {"id": t.id,"name": t.name,"subject": t.subject,"weight": t.weight,"selected": t.selected}

@app.patch("/api/topics/{topic_id}")
def update_topic(topic_id: str, body: TopicUpdate, db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    t = db.query(Topic).filter(Topic.id == topic_id, Topic.user_id == u.id).first()
    if not t: raise HTTPException(404, "Topic not found")
    if body.name is not None: t.name = body.name
    if body.selected is not None: t.selected = body.selected
    db.commit()
    return {"id": t.id,"name": t.name,"selected": t.selected}

@app.delete("/api/topics/{topic_id}")
def delete_topic(topic_id: str, db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    t = db.query(Topic).filter(Topic.id == topic_id, Topic.user_id == u.id).first()
    if not t: raise HTTPException(404, "Topic not found")
    db.delete(t); db.commit()
    return {"success": True}

# ── Exams ──
@app.post("/api/exams")
def add_exam(body: ExamCreate, db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    e = Exam(user_id=u.id, subject=body.subject, exam_date=body.date, exam_type=body.exam_type)
    db.add(e); db.commit(); db.refresh(e)
    return {"id": e.id,"subject": e.subject,"date": e.exam_date,"type": e.exam_type}

@app.get("/api/exams")
def list_exams(db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    exams = db.query(Exam).filter(Exam.user_id == u.id).all()
    return {"exams": [{"id": e.id,"subject": e.subject,"date": e.exam_date,"type": e.exam_type} for e in exams]}

@app.delete("/api/exams/{exam_id}")
def delete_exam(exam_id: str, db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    e = db.query(Exam).filter(Exam.id == exam_id, Exam.user_id == u.id).first()
    if not e: raise HTTPException(404, "Exam not found")
    db.delete(e); db.commit()
    return {"success": True}

# ── Study plan generation ──
@app.post("/api/generate-plan")
def generate_plan(body: GeneratePlanBody, db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    topics = db.query(Topic).filter(Topic.user_id == u.id, Topic.selected == True).all()
    exams  = db.query(Exam).filter(Exam.user_id == u.id).all()
    if not topics: raise HTTPException(400, "No topics found — complete onboarding first")
    if not exams:  raise HTTPException(400, "No exams found — add exams in onboarding first")
    topics_data = [{"name": t.name, "subject": t.subject, "weight": t.weight} for t in topics]
    exams_data  = [{"subject": e.subject, "date": e.exam_date, "type": e.exam_type} for e in exams]
    try:
        raw = call_groq(
            "You are a study planner. Generate a study schedule. Return ONLY a JSON array, no explanation, no markdown.",
            f"""Generate a study plan.
Topics: {json.dumps(topics_data)}
Exams: {json.dumps(exams_data)}
Available days: {body.days}, {body.hours_per_day} hrs/day, {body.session_minutes} min sessions, style: {body.style}

Rules: prioritise by exam proximity and weight. Leave day before each exam free. No weekends unless listed.

Return ONLY JSON array:
[{{"date":"2026-07-03","sessions":[{{"subject":"X","topic":"Y","duration_minutes":45}}]}}]"""
        )
        plan = parse_json_response(raw)
    except Exception as e:
        raise HTTPException(500, f"Plan generation failed: {e}")
    # Save sessions
    db.query(StudySession).filter(StudySession.user_id == u.id).delete()
    for day in plan:
        for s in day.get("sessions", []):
            topic = db.query(Topic).filter(Topic.user_id == u.id, Topic.name == s.get("topic")).first()
            session = StudySession(user_id=u.id, topic_id=topic.id if topic else "",
                subject=s.get("subject",""), topic_name=s.get("topic",""),
                scheduled_date=day["date"], duration_minutes=s.get("duration_minutes", body.session_minutes))
            db.add(session)
    db.commit()
    return {"plan": plan, "total_sessions": sum(len(d.get("sessions",[])) for d in plan)}

@app.get("/api/plan")
def get_plan(db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    sessions = db.query(StudySession).filter(StudySession.user_id == u.id).all()
    by_date = {}
    for s in sessions:
        by_date.setdefault(s.scheduled_date, []).append(
            {"subject": s.subject,"topic": s.topic_name,"duration_minutes": s.duration_minutes,"completed": s.completed})
    return {"plan": [{"date": d,"sessions": by_date[d]} for d in sorted(by_date.keys())]}

# ── Progress ──
@app.post("/api/progress/session")
def log_session(body: LogSessionBody, db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    log = RevisionLog(user_id=u.id, topic_id=body.topic_id, topic_name=body.topic_name,
                      subject=body.subject, mode=body.mode,
                      duration_minutes=body.duration_minutes, exchanges=body.exchanges)
    db.add(log); db.commit()
    return {"success": True}

@app.get("/api/progress")
def get_progress(db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    logs   = db.query(RevisionLog).filter(RevisionLog.user_id == u.id).all()
    topics = db.query(Topic).filter(Topic.user_id == u.id, Topic.selected == True).all()
    exams  = db.query(Exam).filter(Exam.user_id == u.id).all()
    total_mins = sum(l.duration_minutes or 0 for l in logs)
    total_exchanges = sum(l.exchanges or 0 for l in logs)
    studied_topics = {l.topic_id for l in logs}
    pct = round(len(studied_topics) / max(len(topics), 1) * 100)
    # Group topics by subject
    subjects_map = {}
    for t in topics:
        subjects_map.setdefault(t.subject, []).append(t)
    COLORS = {"Data Structures":"#4ade80","Operating Systems":"#60a5fa","Database Systems":"#fbbf24",
              "Computer Networks":"#a78bfa","General":"#f87171"}
    subjects_out = []
    for subj, ts in subjects_map.items():
        subject_logs = [l for l in logs if l.subject == subj]
        studied_ids  = {l.topic_id for l in subject_logs}
        topics_out   = [{"name": t.name, "percent": 100 if t.id in studied_ids else 0} for t in ts]
        subjects_out.append({"name": subj,"color": COLORS.get(subj,"#a78bfa"),"topics": topics_out})
    # Activity (last 16 weeks)
    activity = {}
    for l in logs:
        key = l.logged_at.strftime("%Y-%m-%d")
        activity[key] = activity.get(key, 0) + 1
    # Streak
    streak = 0
    check = datetime.utcnow().date()
    while True:
        if check.strftime("%Y-%m-%d") in activity: streak += 1
        else: break
        check -= timedelta(days=1)
    # Exams
    today = datetime.utcnow().date()
    exams_out = []
    for e in exams:
        d = datetime.strptime(e.exam_date, "%Y-%m-%d").date()
        days_left = (d - today).days
        topic_count = sum(1 for t in topics if t.subject == e.subject)
        studied_count = sum(1 for l in logs if l.subject == e.subject)
        readiness = round(min(studied_count / max(topic_count, 1) * 100, 100))
        exams_out.append({"subject": e.subject,"date": e.exam_date,"days_left": days_left,"readiness": readiness,
                          "color": COLORS.get(e.subject,"#a78bfa")})
    return {
        "overall_percent": pct,
        "streak_days": streak,
        "total_study_hours": round(total_mins / 60, 1),
        "total_exchanges": total_exchanges,
        "topics_covered": len(studied_topics),
        "subjects": subjects_out,
        "activity": [{"date": k,"sessions": v} for k,v in sorted(activity.items())],
        "exams": sorted(exams_out, key=lambda x: x["days_left"]),
    }

# ════════════════════════════════════════════
#  ENTRY POINT
# ════════════════════════════════════════════
if __name__ == "__main__":
    print("🗄️  Database ready")
    print("🚀 StudyAI running at http://localhost:8000")
    print("📖 API docs at  http://localhost:8000/docs\n")
    webbrowser.open("http://localhost:8000")
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
