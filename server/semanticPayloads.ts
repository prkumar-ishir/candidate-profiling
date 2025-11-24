/**
 * Shared semantic payload builders and helpers used by both the Express
 * development server and the Cloudflare Pages functions.
 */
export type KeywordInput = {
  label?: string;
  canonical?: string;
  importance?: number;
  section?: string;
}[];

export function buildSemanticScorePayload(
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
- capabilityBreakdown: exactly 3 objects describing (1) Technical & Engineering Expertise, (2) Delivery, Execution & Systems Knowledge, and (3) Communication, Leadership & Collaboration. For each, include id (technical|delivery|communication), title, score 0-100, summary (match quality), strengths (<=3 concrete wins), gaps (<=3 missing signals).

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
          required: [
            'semanticScore',
            'summary',
            'alignedThemes',
            'missingThemes',
            'suggestions',
            'capabilityBreakdown',
          ],
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
            capabilityBreakdown: {
              type: 'array',
              minItems: 3,
              maxItems: 3,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'title', 'score', 'summary', 'strengths', 'gaps'],
                properties: {
                  id: {
                    type: 'string',
                    enum: ['technical', 'delivery', 'communication'],
                  },
                  title: { type: 'string' },
                  score: { type: 'number', minimum: 0, maximum: 100 },
                  summary: { type: 'string' },
                  strengths: {
                    type: 'array',
                    maxItems: 3,
                    items: { type: 'string' },
                  },
                  gaps: {
                    type: 'array',
                    maxItems: 3,
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

export function buildKeywordExtractionPayload(jdText: string) {
  const prompt = `You are an HR analyst. Extract the most important hiring requirements from the job description.
Return JSON with:
- requirements: array of up to 18 items, each { label, priority (must-have | responsibility | preferred | baseline), rationale, weightPercent (0-100), synonyms[] }.
- questions: exactly 10 interview prompts tailored to the JD. For each include { question, answer } with answers grounded in the JD.

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
          required: ['requirements', 'questions'],
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
            questions: {
              type: 'array',
              minItems: 10,
              maxItems: 10,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['question', 'answer'],
                properties: {
                  question: { type: 'string' },
                  answer: { type: 'string' },
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

export function truncateForModel(text: string, maxChars = 3500): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}... [truncated]`;
}

export function extractStructuredResponse(response: {
  output?: { content?: { type: string; text?: string }[] }[];
}) {
  const content = response?.output?.flatMap((output) => output.content ?? []) ?? [];
  const textChunk = content.find((chunk) => chunk.type === 'output_text');
  const raw = textChunk && 'text' in textChunk ? textChunk.text : null;

  if (!raw) {
    throw new Error('OpenAI response did not contain text output.');
  }

  return JSON.parse(raw);
}
