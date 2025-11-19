import { useEffect, useMemo, useState } from 'react';
/**
 * Primary React application shell. Handles JD/resume ingestion, invokes
 * semantic services, blends fallback heuristics, and renders the entire UI.
 */
import { analyzeResume, extractKeywords } from './utils/textProcessing';
import type {
  KeywordInsight,
  ResumeAnalysis,
  RequirementTier,
  KeywordMatch,
} from './utils/textProcessing';
import { fileToPlainText, UnsupportedFileError } from './utils/documentParsers';
import { requestSemanticAnalysis, requestSemanticKeywords } from './utils/semanticClient';
import type {
  CapabilityInsight,
  InterviewQuestion,
  SemanticAnalysisResponse,
  SemanticKeyword,
} from './utils/semanticClient';
import './App.css';

type ResumeInsightState = (ResumeAnalysis & {
  fileName: string;
  semanticScore?: number;
  semanticSummary?: string;
  semanticAligned?: string[];
  semanticGaps?: string[];
  aiSuggestions: string[];
  capabilityBreakdown: CapabilityInsight[];
}) | null;

// Map raw AI priority labels into the requirement tiers used across the UI.
const priorityMap: Record<SemanticKeyword['priority'], RequirementTier> = {
  'must-have': 'core',
  responsibility: 'responsibility',
  preferred: 'preferred',
  baseline: 'general',
};

const DELIVERY_HINTS = [
  'delivery',
  'deliver',
  'execution',
  'execute',
  'agile',
  'scrum',
  'sprint',
  'project',
  'jira',
  'deployment',
  'ci/cd',
  'system',
  'operations',
  'ops',
  'monitoring',
  'automation',
  'process',
  'documentation',
];

const COMMUNICATION_HINTS = [
  'communicat',
  'stakeholder',
  'lead',
  'mentor',
  'collaborat',
  'team',
  'presentation',
  'coaching',
  'partner',
  'relationship',
  'cross-functional',
  'facilitat',
  'manager',
];

// Titles/ids for the capability cards shown above the strong matches list.
const CAPABILITY_METADATA: Array<{ id: CapabilityInsight['id']; title: string }> = [
  { id: 'technical', title: 'Technical & Engineering Expertise' },
  { id: 'delivery', title: 'Delivery, Execution & Systems Knowledge' },
  { id: 'communication', title: 'Communication, Leadership & Collaboration' },
];

// Natural language labels used when referencing a tier inside helper copy.
const PRIORITY_DESCRIPTIONS: Record<RequirementTier, string> = {
  core: 'must-have',
  responsibility: 'role scope',
  preferred: 'preferred',
  general: 'baseline',
};

/**
 * Generates interview prompts when the semantic service cannot provide any.
 * Uses the top JD keywords to craft high-signal questions and fallback guidance.
 */
function buildFallbackInterviewQuestions(keywords: KeywordInsight[]): InterviewQuestion[] {
  if (!keywords.length) {
    return [];
  }

  const templates: Array<(keyword: KeywordInsight) => InterviewQuestion> = [
    (keyword) => ({
      question: `Walk me through a project where ${keyword.label} was central to the outcome.`,
      answer: `Expect end-to-end storytelling that proves depth in ${keyword.label} — a ${
        PRIORITY_DESCRIPTIONS[keyword.section]
      } priority in the JD — including stakeholders, systems, and measurable results.`,
    }),
    (keyword) => ({
      question: `How do you ensure ${keyword.label} stays aligned with secure and scalable engineering practices?`,
      answer: `Listen for patterns, design reviews, or governance tied to ${keyword.label} that mirror JD expectations.`,
    }),
    (keyword) => ({
      question: `Describe a time you troubleshot a critical issue involving ${keyword.label}.`,
      answer: `Look for root-cause rigor, cross-team coordination, and resolution speed.`,
    }),
    (keyword) => ({
      question: `What metrics do you monitor to prove success with ${keyword.label}?`,
      answer: `Candidate should cite dashboards, SLAs, or adoption metrics anchored to JD priorities.`,
    }),
  ];

  const prioritized = keywords.slice(0, 6);
  const questions: InterviewQuestion[] = [];

  prioritized.forEach((keyword, index) => {
    const template = templates[index % templates.length];
    questions.push(template(keyword));
  });

  const generalPrompts: InterviewQuestion[] = [
    {
      question: 'How do you keep requirements, agile commitments, and stakeholders aligned during delivery?',
      answer:
        'Expect a playbook covering prioritization, sprint rituals, and escalation paths tied to the JD context.',
    },
    {
      question: 'Share an example of mentoring or elevating team capability in a distributed environment.',
      answer:
        'Look for structured coaching, documentation, or enablement moments aligned to leadership expectations.',
    },
    {
      question: 'What is your approach to documenting architecture decisions and technical debt pay-down?',
      answer:
        'Answers should mention ADRs, backlog hygiene, and quantifiable impact on release quality.',
    },
    {
      question: 'How do you evaluate third-party tools or platforms before adopting them for the team?',
      answer:
        'Candidates should outline ROI analysis, security/compliance checks, and rollout strategies.',
    },
  ];

  generalPrompts.forEach((prompt) => {
    questions.push(prompt);
  });

  while (questions.length < 10) {
    const keyword = keywords[questions.length % keywords.length];
    questions.push({
      question: `How do you keep your ${keyword.label} expertise current?`,
      answer: `Listen for continuous learning tied to ${keyword.label}, such as certifications, labs, or mentoring.`,
    });
  }

  return questions.slice(0, 10);
}

function mapPriority(value: SemanticKeyword['priority']): RequirementTier {
  return priorityMap[value] ?? 'general';
}

/**
 * Approximates which capability bucket a keyword belongs to. Used for
 * heuristic scoring and to blend AI narratives when structured data is missing.
 */
function mapMatchToCapability(match: KeywordMatch): CapabilityInsight['id'] {
  const normalized = `${match.label} ${match.canonical}`.toLowerCase();
  if (
    COMMUNICATION_HINTS.some((hint) => normalized.includes(hint)) ||
    match.section === 'general'
  ) {
    return 'communication';
  }
  if (
    DELIVERY_HINTS.some((hint) => normalized.includes(hint)) ||
    match.section === 'responsibility'
  ) {
    return 'delivery';
  }
  return 'technical';
}

function summarizeCapabilityScore(score: number, title: string): string {
  if (score >= 70) {
    return `Resume strongly supports ${title.toLowerCase()}.`;
  }
  if (score >= 40) {
    return `Partial coverage for ${title.toLowerCase()} — expand with JD specifics.`;
  }
  if (score > 0) {
    return `Only light signals for ${title.toLowerCase()} found.`;
  }
  return `No evidence of ${title.toLowerCase()} detected in the resume.`;
}

/**
 * Builds capability cards using deterministic keyword analysis. Acts as the
 * primary fallback when semantic scoring is unavailable.
 */
function buildFallbackCapabilities(analysis: ResumeAnalysis): CapabilityInsight[] {
  const tracker: Record<
    CapabilityInsight['id'],
    { total: number; matched: number; strengths: string[]; gaps: string[] }
  > = {
    technical: { total: 0, matched: 0, strengths: [], gaps: [] },
    delivery: { total: 0, matched: 0, strengths: [], gaps: [] },
    communication: { total: 0, matched: 0, strengths: [], gaps: [] },
  };

  const registerStrength = (bucket: CapabilityInsight['id'], text: string) => {
    if (tracker[bucket].strengths.length < 3 && !tracker[bucket].strengths.includes(text)) {
      tracker[bucket].strengths.push(text);
    }
  };

  const registerGap = (bucket: CapabilityInsight['id'], text: string) => {
    if (tracker[bucket].gaps.length < 3 && !tracker[bucket].gaps.includes(text)) {
      tracker[bucket].gaps.push(text);
    }
  };

  analysis.matchedKeywords.forEach((match) => {
    const bucket = mapMatchToCapability(match);
    tracker[bucket].total += match.importance;
    tracker[bucket].matched += match.importance;
    registerStrength(bucket, `${match.label} (${match.resumeHits} hits)`);
  });

  analysis.missingKeywords.forEach((match) => {
    const bucket = mapMatchToCapability(match);
    tracker[bucket].total += match.importance;
    registerGap(bucket, `${match.label}`);
  });

  return CAPABILITY_METADATA.map(({ id, title }) => {
    const data = tracker[id];
    const score = data.total ? Math.round((data.matched / data.total) * 100) : 0;
    return {
      id,
      title,
      score,
      summary: summarizeCapabilityScore(score, title),
      strengths: data.strengths,
      gaps: data.gaps,
    };
  });
}

// Attempts to infer which capability a textual bullet belongs to.
function categorizeTextCapability(text: string): CapabilityInsight['id'] {
  const normalized = text.toLowerCase();
  if (COMMUNICATION_HINTS.some((hint) => normalized.includes(hint))) {
    return 'communication';
  }
  if (DELIVERY_HINTS.some((hint) => normalized.includes(hint))) {
    return 'delivery';
  }
  return 'technical';
}

/**
 * Combines semantic aligned/missing themes with fallback capability data to
 * ensure the UI always shows meaningful scores when AI returns partial data.
 */
function blendSemanticSignals(
  semanticResult: SemanticAnalysisResponse,
  fallbackCapabilities: CapabilityInsight[],
): CapabilityInsight[] {
  const capabilityMap = new Map(
    fallbackCapabilities.map((capability) => [capability.id, { ...capability }]),
  );

  const stats = {
    technical: { strengths: 0, gaps: 0 },
    delivery: { strengths: 0, gaps: 0 },
    communication: { strengths: 0, gaps: 0 },
  };

  const appendBullet = (
    bucket: CapabilityInsight['id'],
    type: 'strength' | 'gap',
    text: string,
  ) => {
    const entry = capabilityMap.get(bucket);
    if (!entry) {
      return;
    }
    const targetList = type === 'strength' ? entry.strengths : entry.gaps;
    if (!targetList.includes(text) && targetList.length < 4) {
      targetList.push(text);
    }
    stats[bucket][type === 'strength' ? 'strengths' : 'gaps'] += 1;
  };

  semanticResult.alignedThemes?.forEach((item) => {
    if (!item) {
      return;
    }
    appendBullet(categorizeTextCapability(item), 'strength', item);
  });

  semanticResult.missingThemes?.forEach((item) => {
    if (!item) {
      return;
    }
    appendBullet(categorizeTextCapability(item), 'gap', item);
  });

  const overallScore = semanticResult.semanticScore ?? 60;

  CAPABILITY_METADATA.forEach(({ id, title }) => {
    const entry = capabilityMap.get(id);
    if (!entry) {
      return;
    }
    const bucketStats = stats[id];
    if (bucketStats.strengths === 0 && bucketStats.gaps === 0) {
      return;
    }
    const ratio =
      bucketStats.strengths /
      Math.max(bucketStats.strengths + bucketStats.gaps, 1);
    const derived = Math.round(ratio * overallScore + (1 - ratio) * entry.score);
    if (entry.score === 0 && bucketStats.strengths > 0) {
      entry.score = Math.min(
        Math.max(Math.round(Math.max(overallScore * ratio, overallScore * 0.35)), 0),
        100,
      );
    } else {
      entry.score = Math.min(Math.max(derived, 0), 100);
    }
    entry.summary = summarizeCapabilityScore(entry.score, title);
  });

  return CAPABILITY_METADATA.map(({ id }) => capabilityMap.get(id)!);
}

function App() {
  const [jdKeywords, setJdKeywords] = useState<KeywordInsight[]>([]);
  const [jdFileName, setJdFileName] = useState<string>('');
  const [jdDocumentText, setJdDocumentText] = useState<string>('');
  const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[]>([]);
  const [resumeInsights, setResumeInsights] = useState<ResumeInsightState>(null);
  const [processingJD, setProcessingJD] = useState(false);
  const [processingResume, setProcessingResume] = useState(false);
  const [usingAISource, setUsingAISource] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Summarize JD priorities for the keyword breakdown card.
  const keywordSummary = useMemo(() => {
    if (!jdKeywords.length) {
      return null;
    }

    if (usingAISource) {
      const tierToBucket: Record<RequirementTier, 'high' | 'medium' | 'low'> = {
        core: 'high',
        responsibility: 'medium',
        preferred: 'medium',
        general: 'low',
      };
      return jdKeywords.reduce(
        (acc, keyword) => {
          const bucket = tierToBucket[keyword.section];
          acc[bucket] += 1;
          return acc;
        },
        { high: 0, medium: 0, low: 0 },
      );
    }

    return {
      high: jdKeywords.filter((kw) => kw.importance >= 0.8).length,
      medium: jdKeywords.filter((kw) => kw.importance >= 0.5 && kw.importance < 0.8).length,
      low: jdKeywords.filter((kw) => kw.importance < 0.5).length,
    };
  }, [jdKeywords, usingAISource]);

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

  /**
   * Handles JD upload: extracts text, calls semantic keyword service, and
   * seeds fallback data when AI keywords/questions are unavailable.
   */
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
      const aiBundle = await requestSemanticKeywords(content);
      let keywords: KeywordInsight[] = aiBundle
        ? aiBundle.requirements.map((item) => ({
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
      let questionSet: InterviewQuestion[] = aiBundle?.questions ?? [];

      if (!keywords.length) {
        keywords = extractKeywords(content);

        if (!keywords.length) {
          throw new Error('Unable to detect any meaningful keywords in this document.');
        }
        setUsingAISource(false);
        questionSet = buildFallbackInterviewQuestions(keywords);
      } else {
        setUsingAISource(true);
        if (!questionSet.length) {
          questionSet = buildFallbackInterviewQuestions(keywords);
        }
      }

      setInterviewQuestions(questionSet);
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

  /**
   * Handles resume upload: runs heuristic analysis, calls semantic scoring,
   * blends capability data, and updates UI state with the combined insights.
   */
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

      const finalScore = semanticResult
        ? Math.min(Math.max(Math.round(semanticResult.semanticScore), 0), 100)
        : analysis.score;

      const fallbackCapabilities = buildFallbackCapabilities(analysis);
      const capabilityBreakdown = semanticResult
        ? semanticResult.capabilityBreakdown?.length
          ? semanticResult.capabilityBreakdown
          : blendSemanticSignals(semanticResult, fallbackCapabilities)
        : fallbackCapabilities;

      setResumeInsights({
        ...analysis,
        score: finalScore,
        summary: analysis.summary,
        capabilityBreakdown,
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
    setInterviewQuestions([]);
    setResumeInsights(null);
    setErrorMessage(null);
    setUsingAISource(false);
  };

  const scoringSource = resumeInsights
    ? typeof resumeInsights.semanticScore === 'number'
      ? 'ai'
      : 'fallback'
    : null;

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
              <p className="helper-text">
                Load the latest JD to extract prioritized requirements used for every resume
                comparison.
              </p>
            </div>
            <button className="link-button" onClick={handleReset} disabled={!jdKeywords.length}>
              START OVER
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
                <div className="insight-title">
                  <h3>Keyword breakdown</h3>
                  <div
                    className={`source-pill ${usingAISource ? 'source-ai' : 'source-fallback'}`}
                  >
                    {usingAISource ? 'AI-derived requirements' : 'Fallback keyword search'}
                  </div>
                </div>
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

              {interviewQuestions.length > 0 && (
                <>
                  <hr className="section-divider" />
                  <div className="insight-card interview-section">
                    <div className="insight-title">
                      <h3>Interview Questions</h3>
                      <div className="source-pill source-ai">AI interview guide</div>
                    </div>
                    <p className="helper-text">
                      Probe deeper using JD-specific prompts paired with suggested answers.
                    </p>
                    <div className="qa-stack">
                      {interviewQuestions.map((item, index) => (
                        <details
                          key={`qa-${index}-${item.question}`}
                          className="qa-item"
                          open={index === 0}
                        >
                          <summary>
                            <span className="qa-question">
                              Q{index + 1}. {item.question}
                            </span>
                            <span aria-hidden className="qa-chevron">⌄</span>
                          </summary>
                          <p>{item.answer}</p>
                        </details>
                      ))}
                    </div>
                  </div>
                </>
              )}
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
              <div className="insight-title">
                <h3>Match score</h3>
                {scoringSource && (
                  <div
                    className={`source-pill ${scoringSource === 'ai' ? 'source-ai' : 'source-fallback'}`}
                  >
                    {scoringSource === 'ai' ? 'AI assessment' : 'Fallback keyword scoring'}
                  </div>
                )}
              </div>
              <div className="score-pod">
                <div className="score-main">
                  <p className="score-value">{resumeInsights.score} / 100</p>
                  {resumeInsights.semanticSummary ? (
                    <p className="helper-text helper-highlight">
                      AI view: {resumeInsights.semanticSummary}
                    </p>
                  ) : (
                    <p className="helper-text">{resumeInsights.summary}</p>
                  )}
                </div>
                <div className="score-meter">
                  <div
                    className="score-fill"
                    style={{ width: `${resumeInsights.score}%` }}
                    aria-hidden
                  />
                </div>
              </div>

              {resumeInsights.capabilityBreakdown.length > 0 && (
                <div className="capability-stack">
                  {resumeInsights.capabilityBreakdown.map((capability) => (
                    <div key={capability.id} className="capability-card analysis-block">
                      <div className="capability-header">
                        <h4>{capability.title}</h4>
                        <span className="capability-score">{capability.score} / 100</span>
                      </div>
                      <p className="helper-text">{capability.summary}</p>
                      <div className="capability-lists">
                        <div>
                          <span className="list-label">Aligned</span>
                          <ul>
                            {capability.strengths.length ? (
                              capability.strengths.map((item) => (
                                <li key={`strength-${capability.id}-${item}`}>{item}</li>
                              ))
                            ) : (
                              <li>Nothing notable surfaced.</li>
                            )}
                          </ul>
                        </div>
                        <div>
                          <span className="list-label">Gaps</span>
                          <ul>
                            {capability.gaps.length ? (
                              capability.gaps.map((item) => (
                                <li key={`gap-${capability.id}-${item}`}>{item}</li>
                              ))
                            ) : (
                              <li>No gaps detected.</li>
                            )}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="analysis-stack">
                <div className="analysis-block">
                  <h4>Strong matches</h4>
                  {scoringSource === 'ai' ? (
                    <ul>
                      {resumeInsights.semanticAligned?.length ? (
                        resumeInsights.semanticAligned.map((item) => (
                          <li key={`aligned-${item}`}>{item}</li>
                        ))
                      ) : (
                        <li>AI did not highlight specific wins.</li>
                      )}
                    </ul>
                  ) : (
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
                  )}
                </div>
                <div className="analysis-block">
                  <h4>Gaps to address</h4>
                  {scoringSource === 'ai' ? (
                    <ul>
                      {resumeInsights.semanticGaps?.length ? (
                        resumeInsights.semanticGaps.map((item) => (
                          <li key={`gap-${item}`}>{item}</li>
                        ))
                      ) : (
                        <li>No additional gaps flagged.</li>
                      )}
                    </ul>
                  ) : (
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
                  )}
                </div>
              </div>

              <div className="suggestion-block">
                <h4>{scoringSource === 'ai' ? 'AI focus areas' : 'Rule-based focus areas'}</h4>
                {scoringSource === 'ai' ? (
                  resumeInsights.aiSuggestions?.length ? (
                    <ul className="suggestions">
                      {resumeInsights.aiSuggestions.map((suggestion, index) => (
                        <li key={`ai-${suggestion}-${index}`}>{suggestion}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="helper-text">
                      AI did not surface any additional guidance beyond the gaps above.
                    </p>
                  )
                ) : resumeInsights.suggestions.length ? (
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
