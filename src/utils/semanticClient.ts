import type { KeywordInsight } from './textProcessing';

export type SemanticAnalysisResponse = {
  semanticScore: number;
  summary: string;
  alignedThemes: string[];
  missingThemes: string[];
  suggestions: string[];
};

export type SemanticKeyword = {
  label: string;
  priority: 'must-have' | 'responsibility' | 'preferred' | 'baseline';
  rationale: string;
  weightPercent: number;
  synonyms?: string[];
};

type SemanticRequestPayload = {
  jdText: string;
  resumeText: string;
  keywords: KeywordInsight[];
};

export async function requestSemanticAnalysis(
  payload: SemanticRequestPayload,
): Promise<SemanticAnalysisResponse | null> {
  if (!payload.jdText.trim() || !payload.resumeText.trim()) {
    return null;
  }

  try {
    const response = await fetch('/api/semantic-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jdText: payload.jdText,
        resumeText: payload.resumeText,
        keywords: payload.keywords.map((keyword) => ({
          label: keyword.label,
          canonical: keyword.canonical,
          importance: keyword.importance,
          section: keyword.section,
        })),
      }),
    });

    if (!response.ok) {
      console.warn('[semantic-client] Non-OK response', response.status);
      return null;
    }

    const data = (await response.json()) as SemanticAnalysisResponse;
    return data;
  } catch (error) {
    console.warn('[semantic-client] Failed to fetch semantic analysis', error);
    return null;
  }
}

export async function requestSemanticKeywords(
  jdText: string,
): Promise<SemanticKeyword[] | null> {
  if (!jdText.trim()) {
    return null;
  }

  try {
    const response = await fetch('/api/semantic-keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jdText }),
    });

    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return Array.isArray(data?.requirements) ? (data.requirements as SemanticKeyword[]) : null;
  } catch (error) {
    console.warn('[semantic-client] Failed to fetch semantic keywords', error);
    return null;
  }
}
