/**
 * Semantic scoring microservice. Handles two endpoints:
 *  - /api/semantic-score: sends JD + resume + keywords to OpenAI for alignment scoring.
 *  - /api/semantic-keywords: sends JD to OpenAI for requirement extraction + interview prompts.
 * The front-end calls these endpoints whenever the user uploads JDs/resumes.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import {
  buildKeywordExtractionPayload,
  buildSemanticScorePayload,
  extractStructuredResponse,
  type KeywordInput,
} from './semanticPayloads';

const PORT = Number(process.env.API_PORT ?? 8787);
const openAiKey = process.env.OPENAI_API_KEY;

if (!openAiKey) {
  console.warn(
    '[semantic-server] Missing OPENAI_API_KEY. Semantic scoring endpoint will respond with 500s.',
  );
}

const openai = new OpenAI({ apiKey: openAiKey });

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/**
 * POST /api/semantic-score
 * Takes JD, resume, and keyword metadata. The payload is converted into a
 * structured prompt sent to GPT for scoring, summaries, and capability breakdowns.
 */
app.post('/api/semantic-score', async (req, res) => {
  if (!openAiKey) {
    return res.status(500).json({ error: 'Server is missing OPENAI_API_KEY configuration.' });
  }

  const { jdText, resumeText, keywords } = req.body ?? {};

  if (typeof jdText !== 'string' || typeof resumeText !== 'string') {
    return res.status(400).json({ error: 'jdText and resumeText are required string fields.' });
  }

  try {
    // Build a JSON-schema constrained request to ensure predictable output.
    const payload = buildSemanticScorePayload(jdText, resumeText, keywords as KeywordInput);
    const response = await openai.responses.create(payload);
    const structured = extractStructuredResponse(response);
    res.json(structured);
  } catch (error) {
    console.error('[semantic-server] Semantic scoring failed', error);
    res.status(502).json({ error: 'Semantic scoring failed. Check server logs for details.' });
  }
});

/**
 * POST /api/semantic-keywords
 * Accepts JD text and returns prioritized requirements + interview Q&A prompts
 * so the client can populate both keyword chips and question accordions.
 */
app.post('/api/semantic-keywords', async (req, res) => {
  if (!openAiKey) {
    return res.status(500).json({ error: 'Server is missing OPENAI_API_KEY configuration.' });
  }

  const { jdText } = req.body ?? {};
  if (typeof jdText !== 'string' || jdText.trim().length < 40) {
    return res.status(400).json({ error: 'jdText must be a non-empty string (≥ 40 chars).' });
  }

  try {
    const payload = buildKeywordExtractionPayload(jdText);
    const response = await openai.responses.create(payload);
    const structured = extractStructuredResponse(response);
    res.json(structured);
  } catch (error) {
    console.error('[semantic-server] Semantic keyword extraction failed', error);
    res.status(502).json({ error: 'Keyword extraction failed. Falling back to heuristics.' });
  }
});

app.listen(PORT, () => {
  console.log(`[semantic-server] Listening on http://localhost:${PORT}`);
});
