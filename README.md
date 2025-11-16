# Candidate Profiling (React Demo)

Client-side web app for HR/staffing teams to extract keywords from a job description and score multiple resumes against the same rubric. Everything runs in the browser—no files are stored or sent to a backend.

## Features

- 📄 Upload JD in PDF/DOCX/TXT (≤ 10 MB) and auto-extract weighted keywords (AI-derived when the semantic proxy is running, heuristic fallback otherwise).
- 🧠 Rule-based NLP that detects phrases + synonyms, understands JD sections (must-have vs. preferred), and weights requirements accordingly.
- 📊 Scoring compares resume coverage, depth, and breadth against JD priorities.
- 🔁 Upload unlimited resumes while the JD panel stays frozen; use **Start over** to reset.
- 💡 Suggested keywords/sentences to boost each candidate’s score, including AI semantic hints when enabled.
- ⚙️ Pure front-end implementation with pdfjs-dist + JSZip for document parsing, plus an optional Node proxy that calls OpenAI for semantic scoring.

## Getting Started

```bash
npm install
cp .env.example .env   # add your OPENAI_API_KEY inside
npm run dev:server     # terminal 1 – semantic proxy
npm run dev            # terminal 2 – Vite client (or npm run dev:full to run both)
```

Open the printed URL (default `http://localhost:5173`) and drop in a JD. Once keywords appear, begin uploading candidate resumes. If the server has a valid `OPENAI_API_KEY`, the app blends the AI semantic score with the rule-based score (40/60 weighting). If no key/server is running, it gracefully falls back to rule-based scoring only.

## How it Works

1. **Document parsing** (`src/utils/documentParsers.ts`):  
   - PDFs: pdf.js extracts text per page.  
   - DOCX: JSZip opens `word/document.xml` and pulls `<w:t>` nodes.  
   - TXT: FileReader fallback.
2. **Keyword extraction**:  
   - Default: `src/utils/textProcessing.ts` splits the JD into sections, pulls unigrams/bigrams/trigrams, normalizes synonyms, and weights requirements with section-aware heuristics.  
   - AI path: `POST /api/semantic-keywords` (see `server/index.ts`) asks GPT-4o mini for the top requirements, priorities, and rationales. The client prefers this output and falls back to the heuristic list if the call fails.  
3. **Resume scoring**:  
   - Matches JD keywords inside the resume, measuring coverage (importance hit), depth (relative frequency), and breadth (distinct matches) to return a 0–100 score, highlights gaps, and suggests additions.
4. **Semantic overlay (optional)**:  
   - The proxy (`server/index.ts`) sends the JD, resume, and keyword metadata to OpenAI (`gpt-4o-mini`) for a structured semantic score, strengths, gaps, and tailored suggestions. The UI merges those insights with the rule-based output.

## Optional AI/ML Upgrade

If you decide to move beyond rule-based scoring:

1. Replace `analyzeResume` with a call to OpenAI, Vertex AI, or another LLM/embedding service.  
2. Provide both JD keywords and resume text as prompt/context and return the structured response expected by the UI.  
3. The UI already separates parsing → extraction → scoring, so you only need to swap the scoring function while keeping uploads entirely in-memory.

Let me know if you want a server/API scaffold or hosted vector search later on.
