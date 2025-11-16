import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

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

app.post('/api/semantic-score', async (req, res) => {
  if (!openAiKey) {
    return res.status(500).json({ error: 'Server is missing OPENAI_API_KEY configuration.' });
  }

  const { jdText, resumeText, keywords } = req.body ?? {};

  if (typeof jdText !== 'string' || typeof resumeText !== 'string') {
    return res.status(400).json({ error: 'jdText and resumeText are required string fields.' });
  }

  try {
    const payload = buildPromptPayload(jdText, resumeText, keywords);
    const response = await openai.responses.create(payload);
    const structured = extractStructuredResponse(response);
    res.json(structured);
  } catch (error) {
    console.error('[semantic-server] Semantic scoring failed', error);
    res.status(502).json({ error: 'Semantic scoring failed. Check server logs for details.' });
  }
});

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

type KeywordInput = {
  label?: string;
  canonical?: string;
  importance?: number;
  section?: string;
}[];

function buildPromptPayload(
  jdText: string,
  resumeText: string,
  keywords: KeywordInput,
) {
  const keywordSummary = Array.isArray(keywords)
    ? keywords
        .slice(0, 14)
        .map((keyword) => {
          const weight = keyword.importance ? `${Math.round(keyword.importance * 100)}%` : 'n/a';
          return `- ${keyword.label ?? keyword.canonical ?? 'keyword'} (weight ${weight}, section ${
            keyword.section ?? 'general'
          })`;
        })
        .join('\n')
    : 'No keyword metadata provided.';

  const prompt = `You are an HR screening assistant. Score how well the resume aligns with the job description.
Return JSON with:
- semanticScore: 0-100 integer, holistic probability of success.
- summary: 1 sentence explaining the score.
- alignedThemes: up to 4 short phrases where the resume clearly aligns with the JD.
- missingThemes: up to 4 short phrases capturing gaps.
- suggestions: up to 4 resume improvements grounded in the JD.

Be strict. Penalize finance-heavy or irrelevant experience if the JD is HR-focused (and vice versa). Only use evidence from the provided texts.`;

  return {
    model: 'gpt-4o-mini',
    text: {
      format: {
        type: 'json_schema',
        name: 'SemanticResumeAssessment',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['semanticScore', 'summary', 'alignedThemes', 'missingThemes', 'suggestions'],
          properties: {
            semanticScore: { type: 'number', minimum: 0, maximum: 100 },
            summary: { type: 'string' },
            alignedThemes: {
              type: 'array',
              maxItems: 4,
              items: { type: 'string' },
            },
            missingThemes: {
              type: 'array',
              maxItems: 4,
              items: { type: 'string' },
            },
            suggestions: {
              type: 'array',
              maxItems: 4,
              items: { type: 'string' },
            },
          },
        },
      },
    },
    input: [
      {
        role: 'system' as const,
        content: [
          { type: 'input_text' as const, text: prompt },
        ],
      },
      {
        role: 'user' as const,
        content: [
          {
            type: 'input_text' as const,
            text: [
              '--- JOB DESCRIPTION ---',
              truncateForModel(jdText),
              '',
              '--- KEYWORD SUMMARY ---',
              keywordSummary,
              '',
              '--- RESUME ---',
              truncateForModel(resumeText),
            ].join('\n'),
          },
        ],
      },
    ],
  };
}

function buildKeywordExtractionPayload(jdText: string) {
  const prompt = `You are an HR analyst. Extract the most important hiring requirements from the job description.
Return JSON with:
- requirements: array of up to 18 items, each { label, priority (must-have | responsibility | preferred | baseline), rationale, weightPercent (0-100), synonyms[] }.

Focus on concrete skills, systems, certifications, and responsibilities. Use the JD structure (Requirements vs Responsibilities) to set priority.`;

  return {
    model: 'gpt-4o-mini',
    text: {
      format: {
        type: 'json_schema',
        name: 'SemanticKeywordExtraction',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['requirements'],
          properties: {
            requirements: {
              type: 'array',
              maxItems: 18,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['label', 'priority', 'rationale', 'weightPercent', 'synonyms'],
                properties: {
                  label: { type: 'string' },
                  priority: {
                    type: 'string',
                    enum: ['must-have', 'responsibility', 'preferred', 'baseline'],
                  },
                  rationale: { type: 'string' },
                  weightPercent: { type: 'number', minimum: 0, maximum: 100 },
                  synonyms: {
                    type: 'array',
                    minItems: 0,
                    items: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    input: [
      {
        role: 'system' as const,
        content: [{ type: 'input_text' as const, text: prompt }],
      },
      {
        role: 'user' as const,
        content: [
          {
            type: 'input_text' as const,
            text: truncateForModel(jdText, 5000),
          },
        ],
      },
    ],
  };
}

function truncateForModel(text: string, maxChars = 3500): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}... [truncated]`;
}

function extractStructuredResponse(response: OpenAI.Beta.Responses.Response) {
  const content = response.output?.flatMap((output) => output.content) ?? [];
  const textChunk = content.find((chunk) => chunk.type === 'output_text');
  const raw = textChunk && 'text' in textChunk ? textChunk.text : null;

  if (!raw) {
    throw new Error('OpenAI response did not contain text output.');
  }

  return JSON.parse(raw);
}
