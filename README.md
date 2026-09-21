StudyAI – Syllabus Tracker and Active Learning Bot

Overview
StudyAI is a college project built for a B.Tech in Computer Science (AI/ML specialization). It lets students upload their study materials, automatically extracts topics using AI, generates a personalized study roadmap, and helps them revise through an AI-powered chatbot with three interaction modes: Socratic questioning, Debate, and Quiz.

Features
- Drag-and-drop upload for study materials with AI-based topic extraction
- Personalized study roadmap with a calendar view and exam countdown
- AI revision chatbot with three modes: Socratic, Debate, and Quiz
- Progress tracker with a heatmap and streak counter
- Four-step onboarding wizard
- Fully responsive design with mobile navigation, page transitions, toast notifications, and error handling

Tech Stack
- Frontend: HTML, CSS, JavaScript
- Backend: Python, FastAPI
- Database: SQLite with SQLAlchemy
- Authentication: JWT tokens with passlib/bcrypt
- AI: Groq API (llama-3.3-70b-versatile)

Setup
1. Activate the virtual environment: source venv/bin/activate
2. Run the server: uvicorn server:app --host 0.0.0.0 --port 8000
3. Open http://localhost:8000 in your browser

Note: requires a Groq API key set in .env

Team
Two-person collaboration — frontend developed by Shysta A., backend developed by [partner's name].

Status
Built for academic submission; not deployed.
