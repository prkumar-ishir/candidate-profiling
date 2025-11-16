import { useEffect, useMemo, useState } from 'react';
import { analyzeResume, extractKeywords } from './utils/textProcessing';
import type {
  KeywordInsight,
  ResumeAnalysis,
  RequirementTier,
} from './utils/textProcessing';
import { fileToPlainText, UnsupportedFileError } from './utils/documentParsers';
import {
  requestSemanticAnalysis,
  requestSemanticKeywords,
} from './utils/semanticClient';
import type { SemanticAnalysisResponse, SemanticKeyword } from './utils/semanticClient';
import './App.css';

type ResumeInsightState = (ResumeAnalysis & {
  fileName: string;
  semanticScore?: number;
  semanticSummary?: string;
  semanticAligned?: string[];
  semanticGaps?: string[];
  aiSuggestions: string[];
}) | null;

const priorityMap: Record<SemanticKeyword['priority'], RequirementTier> = {
  'must-have': 'core',
  responsibility: 'responsibility',
  preferred: 'preferred',
  baseline: 'general',
};

function mapPriority(value: SemanticKeyword['priority']): RequirementTier {
  return priorityMap[value] ?? 'general';
}

function App() {
  const [jdKeywords, setJdKeywords] = useState<KeywordInsight[]>([]);
  const [jdFileName, setJdFileName] = useState<string>('');
  const [jdDocumentText, setJdDocumentText] = useState<string>('');
  const [resumeInsights, setResumeInsights] = useState<ResumeInsightState>(null);
  const [processingJD, setProcessingJD] = useState(false);
  const [processingResume, setProcessingResume] = useState(false);
  const [usingAISource, setUsingAISource] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const keywordSummary = useMemo(() => {
    if (!jdKeywords.length) {
      return null;
    }

    const buckets = {
      high: jdKeywords.filter((kw) => kw.importance >= 0.8).length,
      medium: jdKeywords.filter((kw) => kw.importance >= 0.5 && kw.importance < 0.8).length,
      low: jdKeywords.filter((kw) => kw.importance < 0.5).length,
    };

    return buckets;
  }, [jdKeywords]);

  const sectionLabels: Record<RequirementTier, string> = {
    core: 'Must-have',
    responsibility: 'Role scope',
    preferred: 'Preferred',
    general: 'General',
  };

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 240);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleJobDescriptionUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setErrorMessage(null);
    setProcessingJD(true);

    try {
      const content = await fileToPlainText(file);
      const aiKeywords = await requestSemanticKeywords(content);
      let keywords: KeywordInsight[] = aiKeywords
        ? aiKeywords.map((item) => ({
            canonical: item.label.toLowerCase(),
            label: item.label,
            occurrences: 1,
            importance: Math.max(item.weightPercent / 100, 0.4),
            section: mapPriority(item.priority),
            source: 'phrase',
            variants: item.synonyms ?? [],
            coverage: 0.1,
          }))
        : [];

      if (!keywords.length) {
        keywords = extractKeywords(content);

        if (!keywords.length) {
          throw new Error('Unable to detect any meaningful keywords in this document.');
        }
        setUsingAISource(false);
      } else {
        setUsingAISource(true);
      }

      setJdKeywords(keywords);
      setJdFileName(file.name);
      setJdDocumentText(content);
      setResumeInsights(null);
    } catch (error) {
      if (error instanceof UnsupportedFileError) {
        setErrorMessage(error.message);
        return;
      }
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to process the job description.',
      );
    } finally {
      setProcessingJD(false);
    }
  };

  const handleResumeUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !jdKeywords.length) {
      return;
    }

    setErrorMessage(null);
    setProcessingResume(true);

    try {
      const content = await fileToPlainText(file);
      const analysis = analyzeResume(content, jdKeywords);
      let semanticResult: SemanticAnalysisResponse | null = null;

      if (jdDocumentText) {
        semanticResult = await requestSemanticAnalysis({
          jdText: jdDocumentText,
          resumeText: content,
          keywords: jdKeywords,
        });
      }

      const blendedScore = semanticResult
        ? Math.round(analysis.score * 0.4 + semanticResult.semanticScore * 0.6)
        : analysis.score;

      setResumeInsights({
        ...analysis,
        score: blendedScore,
        fileName: file.name,
        semanticScore: semanticResult?.semanticScore,
        semanticSummary: semanticResult?.summary,
        semanticAligned: semanticResult?.alignedThemes ?? [],
        semanticGaps: semanticResult?.missingThemes ?? [],
        aiSuggestions: semanticResult?.suggestions ?? [],
      });
    } catch (error) {
      if (error instanceof UnsupportedFileError) {
        setErrorMessage(error.message);
        return;
      }
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to process the resume.',
      );
    } finally {
      setProcessingResume(false);
    }
  };

  const handleReset = () => {
    setJdKeywords([]);
    setJdFileName('');
    setJdDocumentText('');
    setResumeInsights(null);
    setErrorMessage(null);
    setUsingAISource(false);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <img
            src="/ishir-logo.png"
            className="brand-logo"
            alt="Ishir staffing logo"
            width="140"
            height="140"
          />
          <div className="brand-copy">
            <p className="eyebrow">Candidate Profiling</p>
            <h1>Screen faster with keyword intelligence</h1>
            <p className="subtitle">
              Upload a job description, extract in-demand skills, and evaluate multiple resumes
              against the same criteria — all directly in the browser.
            </p>
          </div>
        </div>
      </header>

      {errorMessage && <div className="alert alert-error">{errorMessage}</div>}

      <main className="workspace">
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Step 1</p>
              <h2>Job Description</h2>
              {jdKeywords.length ? (
                <div
                  className={`source-pill ${usingAISource ? 'source-ai' : 'source-fallback'}`}
                >
                  {usingAISource ? 'AI-derived requirements' : 'Heuristic fallback keywords'}
                </div>
              ) : null}
            </div>
            <button className="link-button" onClick={handleReset} disabled={!jdKeywords.length}>
              Start over
            </button>
          </div>

          <div className="upload-card">
            <input
              id="jd-upload"
              type="file"
              accept=".pdf,.docx,.txt,.text"
              onChange={handleJobDescriptionUpload}
              hidden
            />
            <label className="upload-area" htmlFor="jd-upload">
              {processingJD ? (
                <span>Reading document…</span>
              ) : (
                <>
                  <strong>{jdFileName || 'Upload job description'}</strong>
                  <span>PDF · DOCX · TXT</span>
                </>
              )}
            </label>
          </div>

          {jdKeywords.length > 0 && (
            <>
              <div className="insight-card">
                <h3>Keyword breakdown</h3>
                {keywordSummary && (
                  <div className="keyword-summary">
                    <div>
                      <span className="summary-value">{keywordSummary.high}</span>
                      <span>High priority</span>
                    </div>
                    <div>
                      <span className="summary-value">{keywordSummary.medium}</span>
                      <span>Medium</span>
                    </div>
                    <div>
                      <span className="summary-value">{keywordSummary.low}</span>
                      <span>Baseline</span>
                    </div>
                  </div>
                )}
                <p className="helper-text">
                  {usingAISource
                    ? 'These AI-derived requirements drive the resume score with the priorities above.'
                    : 'These keywords drive the resume score. The weighting is based on term frequency within the JD.'}
                </p>
              </div>

              <div className="keywords-grid">
                {jdKeywords.map((keyword) => (
                  <div key={keyword.canonical} className="keyword-chip">
                    <strong>{keyword.label}</strong>
                    <span className="chip-meta">
                      {(keyword.importance * 100).toFixed(0)}% ·{' '}
                      {keyword.source === 'phrase' ? 'phrase' : 'keyword'}
                    </span>
                    <span className={`chip-section chip-${keyword.section}`}>
                      {sectionLabels[keyword.section]}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Step 2</p>
              <h2>Resume Scoring</h2>
              <p className="helper-text">
                Upload as many resumes as you like. The JD panel stays frozen until you start over.
              </p>
            </div>
          </div>

          <div className="upload-card">
            <input
              id="resume-upload"
              type="file"
              accept=".pdf,.docx,.txt,.text"
              onChange={handleResumeUpload}
              disabled={!jdKeywords.length}
              hidden
            />
            <label
              className={`upload-area ${!jdKeywords.length ? 'disabled' : ''}`}
              htmlFor="resume-upload"
            >
              {processingResume ? (
                <span>Evaluating resume…</span>
              ) : (
                <>
                  <strong>
                    {jdKeywords.length
                      ? 'Upload a candidate resume'
                      : 'Load a JD to enable resume uploads'}
                  </strong>
                  <span>PDF · DOCX · TXT</span>
                </>
              )}
            </label>
          </div>

          {resumeInsights && (
            <div className="insight-card">
              <div className="score-pod">
                <div>
                  <span className="eyebrow">Match score</span>
                  <h3>{resumeInsights.score} / 100</h3>
                  <p className="helper-text">{resumeInsights.summary}</p>
                  {resumeInsights.semanticSummary && (
                    <p className="helper-text helper-highlight">
                      AI view: {resumeInsights.semanticSummary}
                    </p>
                  )}
                </div>
                <div className="score-meter">
                  <div
                    className="score-fill"
                    style={{ width: `${resumeInsights.score}%` }}
                    aria-hidden
                  />
                </div>
                {typeof resumeInsights.semanticScore === 'number' && (
                  <div className="ai-score-pill" title="Score from the AI semantic comparison between JD and resume">
                    AI semantic score: {resumeInsights.semanticScore} / 100
                  </div>
                )}
              </div>

              <div className="analysis-stack">
                <div className="analysis-block">
                  <h4>Strong matches</h4>
                  <ul>
                    {resumeInsights.matchedKeywords.slice(0, 6).map((match) => (
                      <li key={match.canonical}>
                        <strong>{match.label}</strong> · hits {match.resumeHits} ({sectionLabels[match.section]})
                      </li>
                    ))}
                    {!resumeInsights.matchedKeywords.length && (
                      <li>No aligned keywords detected.</li>
                    )}
                  </ul>
                </div>
                <div className="analysis-block">
                  <h4>Gaps to address</h4>
                  <ul>
                    {resumeInsights.missingKeywords.slice(0, 6).map((match) => (
                      <li key={match.canonical}>
                        <strong>{match.label}</strong> · {sectionLabels[match.section]} ·{' '}
                        {(match.importance * 100).toFixed(0)}%
                      </li>
                    ))}
                    {!resumeInsights.missingKeywords.length && (
                      <li>Coverage looks complete.</li>
                    )}
                  </ul>
                </div>
              </div>

              {(resumeInsights.semanticAligned?.length || resumeInsights.semanticGaps?.length) && (
                <div className="analysis-stack">
                  <div className="analysis-block">
                    <h4>AI-noted strengths</h4>
                    <ul>
                      {resumeInsights.semanticAligned?.length ? (
                        resumeInsights.semanticAligned.map((item) => (
                          <li key={`aligned-${item}`}>{item}</li>
                        ))
                      ) : (
                        <li>No strong semantic signals detected.</li>
                      )}
                    </ul>
                  </div>
                  <div className="analysis-block">
                    <h4>AI-noted gaps</h4>
                    <ul>
                      {resumeInsights.semanticGaps?.length ? (
                        resumeInsights.semanticGaps.map((item) => (
                          <li key={`gap-${item}`}>{item}</li>
                        ))
                      ) : (
                        <li>No additional gaps flagged.</li>
                      )}
                    </ul>
                  </div>
                </div>
              )}

              <div className="suggestion-block">
                <h4>Rule-based focus areas</h4>
                {resumeInsights.suggestions.length ? (
                  <div className="suggestion-grid">
                    {resumeInsights.suggestions.map((suggestion) => (
                      <div
                        key={`rule-${suggestion.canonical}-${suggestion.type}`}
                        className="suggestion-card"
                      >
                        <div className="suggestion-card-header">
                          <span
                            className={`suggestion-type suggestion-${suggestion.type}`}
                          >
                            {suggestion.type === 'add' ? 'Add coverage' : 'Enrich story'}
                          </span>
                          <span className={`chip-section chip-${suggestion.priority}`}>
                            {sectionLabels[suggestion.priority]}
                          </span>
                          <span className="weight-pill">{suggestion.weight}% weight</span>
                        </div>
                        <strong>{suggestion.label}</strong>
                        <p className="suggestion-detail">{suggestion.action}</p>
                        <p className="suggestion-subtext">{suggestion.detail}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="helper-text">
                    Coverage looks strong. Keep emphasizing quantifiable business outcomes.
                  </p>
                )}
              </div>

              {resumeInsights.aiSuggestions?.length ? (
                <div className="suggestion-block">
                  <h4>AI additions</h4>
                  <ul className="suggestions">
                    {resumeInsights.aiSuggestions.map((suggestion, index) => (
                      <li key={`ai-${suggestion}-${index}`}>{suggestion}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="file-footnote">Last analyzed: {resumeInsights.fileName}</div>
            </div>
          )}
        </section>
      </main>

      <footer className="app-footer">Copyright © 1999-2025 ISHIR</footer>
      {showScrollTop && (
        <button
          className="scroll-top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Scroll back to top"
        >
          ↑ Back to top
        </button>
      )}
    </div>
  );
}

export default App;
