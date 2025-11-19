/**
 * Browser-side client for semantic endpoints. Normalizes API responses and
 * re-exports typed helpers so React components can consume structured data.
 */
import type { KeywordInsight } from './textProcessing';

export type CapabilityInsight = {
  id: 'technical' | 'delivery' | 'communication';
  title: string;
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
};

export type InterviewQuestion = {
  question: string;
  answer: string;
};

export type SemanticAnalysisResponse = {
  semanticScore: number;
  summary: string;
  alignedThemes: string[];
  missingThemes: string[];
  suggestions: string[];
  capabilityBreakdown: CapabilityInsight[];
};

export type SemanticKeyword = {
  label: string;
  priority: 'must-have' | 'responsibility' | 'preferred' | 'baseline';
  rationale: string;
  weightPercent: number;
  synonyms?: string[];
};

export type SemanticKeywordBundle = {
  requirements: SemanticKeyword[];
  questions: InterviewQuestion[];
};

type SemanticRequestPayload = {
  jdText: string;
  resumeText: string;
  keywords: KeywordInsight[];
};

/**
 * Calls /api/semantic-score with JD/resume text and keyword metadata.
 * Returns semantic scoring output or null when the server cannot respond.
 */
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

/**
 * Calls /api/semantic-keywords. Provides an aggregate of requirements for the
 * keyword chips and interview Q&A prompts for the JD section.
 */
export async function requestSemanticKeywords(
  jdText: string,
): Promise<SemanticKeywordBundle | null> {
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
    if (!Array.isArray(data?.requirements)) {
      return null;
    }
    return {
      requirements: data.requirements as SemanticKeyword[],
      questions: Array.isArray(data?.questions)
        ? (data.questions as InterviewQuestion[])
        : [],
    };
  } catch (error) {
    console.warn('[semantic-client] Failed to fetch semantic keywords', error);
    return null;
  }
}
