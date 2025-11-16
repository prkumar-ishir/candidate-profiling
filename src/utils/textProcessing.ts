export type RequirementTier = 'core' | 'responsibility' | 'preferred' | 'general';
export type KeywordSource = 'term' | 'phrase';

export type KeywordInsight = {
  canonical: string;
  label: string;
  occurrences: number;
  importance: number;
  section: RequirementTier;
  source: KeywordSource;
  variants: string[];
  coverage: number;
};

export type SuggestionInsight = {
  canonical: string;
  label: string;
  priority: RequirementTier;
  weight: number;
  type: 'add' | 'expand';
  action: string;
  detail: string;
};

export type ResumeAnalysis = {
  score: number;
  matchedKeywords: KeywordMatch[];
  missingKeywords: KeywordMatch[];
  summary: string;
  suggestions: SuggestionInsight[];
};

export type KeywordMatch = {
  canonical: string;
  label: string;
  jdOccurrences: number;
  resumeHits: number;
  importance: number;
  section: RequirementTier;
  source: KeywordSource;
};

type SectionFragment = {
  id: number;
  content: string;
  section: RequirementTier;
};

type KeywordStats = {
  canonical: string;
  occurrences: number;
  weightedOccurrences: number;
  sectionWeights: Record<RequirementTier, number>;
  source: KeywordSource;
  variants: Set<string>;
  surfaces: Map<string, number>;
  fragmentIds: Set<number>;
};

type SynonymInfo = {
  canonical: string;
  variants: string[];
};

const STOP_WORDS = new Set([
  'and',
  'the',
  'for',
  'with',
  'that',
  'have',
  'this',
  'from',
  'your',
  'will',
  'are',
  'you',
  'our',
  'per',
  'who',
  'any',
  'all',
  'but',
  'its',
  'was',
  'were',
  'has',
  'had',
  'can',
  'may',
  'must',
  'into',
  'able',
  'make',
  'made',
  'than',
  'over',
  'each',
  'via',
  'very',
  'much',
  'also',
  'ever',
  'every',
  'then',
  'once',
  'keep',
  'kept',
  'been',
  'being',
  'through',
  'within',
  'between',
  'among',
  'upon',
  'onto',
]);

const CONNECTOR_WORDS = new Set(['and', 'or', 'to', 'of', 'in', 'on', 'for', 'with']);

const GENERIC_TERMS = new Set([
  'job',
  'jobs',
  'description',
  'descriptions',
  'sample',
  'company',
  'companies',
  'organization',
  'organizations',
  'department',
  'departments',
  'team',
  'teams',
  'employee',
  'employees',
  'employment',
  'human',
  'resource',
  'resources',
  'information',
  'detail',
  'details',
  'participation',
  'participate',
  'candidate',
  'candidates',
  'applicant',
  'applicants',
  'intern',
  'interns',
  'internship',
  'role',
  'roles',
  'position',
  'positions',
  'title',
  'titles',
  'sample job',
  'job description',
  'job title',
  'reports',
  'report',
  'gain',
]);

const SECTION_WEIGHTS: Record<RequirementTier, number> = {
  core: 1.2,
  responsibility: 1,
  preferred: 0.8,
  general: 0.7,
};

const HEADING_PATTERNS: Array<{ regex: RegExp; section: RequirementTier }> = [
  { regex: /(must[-\s]?have|requirements?|qualifications?|skills)/i, section: 'core' },
  { regex: /(responsibilit|what you will do|day[-\s]?to[-\s]?day)/i, section: 'responsibility' },
  { regex: /(preferred|nice to have|bonus|good to have)/i, section: 'preferred' },
];

const INLINE_PRIORITY_PATTERNS: Array<{ regex: RegExp; section: RequirementTier }> = [
  { regex: /\b(must|required|required experience)\b/i, section: 'core' },
  { regex: /\b(preferred|nice to have|bonus)\b/i, section: 'preferred' },
];

const SYNONYM_GROUPS: string[][] = [
  ['project management', 'program management', 'project manager', 'pm'],
  ['stakeholder management', 'stakeholder engagement'],
  ['change management', 'organizational change'],
  ['people management', 'team leadership', 'direct reports'],
  ['react', 'react.js', 'reactjs', 'react native'],
  ['node', 'node.js', 'nodejs'],
  ['customer success', 'client success', 'account management'],
  ['business development', 'sales development', 'bd'],
  ['data analysis', 'data analytics', 'data analyst'],
  ['machine learning', 'ml', 'ml ops', 'mlops'],
  ['artificial intelligence', 'ai'],
  ['product management', 'product manager', 'pm (product)'],
  ['user experience', 'ux'],
  ['user interface', 'ui'],
  ['quality assurance', 'qa', 'software testing'],
  ['search engine optimization', 'seo'],
  ['pay per click', 'ppc'],
  ['human resources', 'hr'],
  ['talent acquisition', 'technical recruiting', 'recruitment'],
];

const SYNONYM_LOOKUP = buildSynonymMap();

export function extractKeywords(text: string, limit = 28): KeywordInsight[] {
  const fragments = splitIntoFragments(text);
  const totalFragments = Math.max(fragments.length, 1);
  const statsMap = new Map<string, KeywordStats>();

  fragments.forEach((fragment) => {
    const tokens = tokenize(fragment.content);
    if (!tokens.length) {
      return;
    }

    collectTokens(tokens, fragment.section, fragment.id, statsMap);
    collectPhrases(tokens, fragment.section, fragment.id, statsMap);
  });

  const statsArray = Array.from(statsMap.values());
  if (!statsArray.length) {
    return [];
  }

  const maxWeighted = Math.max(...statsArray.map((stat) => stat.weightedOccurrences));

  const keywords = statsArray
    .map<KeywordInsight>((stat) => {
      const dominantSection = getDominantSection(stat.sectionWeights);
      const sectionBoost = SECTION_WEIGHTS[dominantSection];
      const phraseBoost = stat.source === 'phrase' ? 1.05 : 1;
      const importance = Number(
        Math.min((stat.weightedOccurrences / maxWeighted) * sectionBoost * phraseBoost, 1).toFixed(
          3,
        ),
      );

      const label = selectDisplayLabel(stat);

      const coverage = stat.fragmentIds.size / totalFragments;

      return {
        canonical: stat.canonical,
        label,
        occurrences: stat.occurrences,
        importance,
        section: dominantSection,
        source: stat.source,
        variants: Array.from(stat.variants).sort(),
        coverage,
      };
    })
    .sort((a, b) => b.importance - a.importance);

  let refined = keywords.slice();

  const coverageThreshold = 0.45;
  if (keywords.length > 10) {
    const coverageFiltered = keywords.filter(
      (keyword) => keyword.coverage <= coverageThreshold || keyword.importance >= 0.4,
    );
    if (coverageFiltered.length >= 5) {
      refined = coverageFiltered;
    }
  }

  if (refined.length > 12) {
    const importanceValues = refined.map((kw) => kw.importance).sort((a, b) => a - b);
    const percentileFloor = computePercentile(importanceValues, 0.25);
    const importanceThreshold = Math.max(percentileFloor, 0.25);
    const percentileFiltered = refined.filter((kw) => kw.importance >= importanceThreshold);
    if (percentileFiltered.length >= 5) {
      refined = percentileFiltered;
    }
  }

  if (!refined.length) {
    refined = keywords.slice();
  }

  return refined.slice(0, limit);
}

export function analyzeResume(
  resumeText: string,
  keywords: KeywordInsight[],
): ResumeAnalysis {
  const resumeTokens = tokenize(resumeText);
  const unigramCounts = buildNgramCounts(resumeTokens, 1);
  const bigramCounts = buildNgramCounts(resumeTokens, 2);
  const trigramCounts = buildNgramCounts(resumeTokens, 3);

  const keywordMatches: KeywordMatch[] = keywords.map((kw) => {
    const tokenLength = kw.canonical.split(' ').length;
    const sourceCounts =
      tokenLength === 1
        ? unigramCounts
        : tokenLength === 2
        ? bigramCounts
        : trigramCounts;

    const resumeHits = sourceCounts.get(kw.canonical) ?? 0;

    return {
      canonical: kw.canonical,
      label: kw.label,
      jdOccurrences: kw.occurrences,
      resumeHits,
      importance: kw.importance,
      section: kw.section,
      source: kw.source,
    };
  });

  const matchedKeywords = keywordMatches.filter((match) => match.resumeHits > 0);
  const missingKeywords = keywordMatches.filter((match) => match.resumeHits === 0);

  const totalImportance = keywords.reduce((sum, kw) => sum + kw.importance, 0) || 1;
  const coverageScore =
    matchedKeywords.reduce((sum, match) => sum + match.importance, 0) / totalImportance;
  const densityScore =
    matchedKeywords.reduce(
      (sum, match) =>
        sum + Math.min(match.resumeHits / Math.max(match.jdOccurrences, 1), 1),
      0,
    ) / Math.max(keywords.length, 1);
  const breadthScore = matchedKeywords.length / Math.max(keywords.length, 1);

  const finalScore = Math.round(
    (coverageScore * 0.6 + densityScore * 0.3 + breadthScore * 0.1) * 100,
  );

  return {
    score: Math.min(finalScore, 100),
    matchedKeywords,
    missingKeywords,
    summary: buildSummary(coverageScore, densityScore, breadthScore),
    suggestions: buildSuggestions(missingKeywords, matchedKeywords),
  };
}

function splitIntoFragments(text: string): SectionFragment[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const fragments: SectionFragment[] = [];
  let activeSection: RequirementTier = 'general';
  let fragmentCounter = 0;

  lines.forEach((line) => {
    const headingSection = detectHeadingSection(line);
    if (headingSection) {
      activeSection = headingSection;
      return;
    }

    const inlineSection = detectInlinePriority(line);
    fragments.push({
      id: fragmentCounter,
      content: line,
      section: inlineSection ?? activeSection,
    });
    fragmentCounter += 1;
  });

  return fragments;
}

function detectHeadingSection(line: string): RequirementTier | null {
  if (line.length > 80) {
    return null;
  }

  for (const pattern of HEADING_PATTERNS) {
    if (pattern.regex.test(line)) {
      return pattern.section;
    }
  }

  return null;
}

function detectInlinePriority(line: string): RequirementTier | null {
  for (const pattern of INLINE_PRIORITY_PATTERNS) {
    if (pattern.regex.test(line)) {
      return pattern.section;
    }
  }

  return null;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9+#][a-z0-9+#\-\/]*/g) ?? [];
}

function collectTokens(
  tokens: string[],
  section: RequirementTier,
  fragmentId: number,
  statsMap: Map<string, KeywordStats>,
) {
  const weight = SECTION_WEIGHTS[section];

  tokens.forEach((token) => {
    if (!shouldKeepToken(token)) {
      return;
    }
    recordTerm(token, 'term', section, weight, fragmentId, statsMap);
  });
}

function collectPhrases(
  tokens: string[],
  section: RequirementTier,
  fragmentId: number,
  statsMap: Map<string, KeywordStats>,
) {
  const weight = SECTION_WEIGHTS[section];

  for (let index = 0; index < tokens.length; index += 1) {
    const bigram = buildPhrase(tokens, index, 2);
    if (bigram) {
      recordTerm(bigram, 'phrase', section, weight * 1.1, fragmentId, statsMap);
    }

    const trigram = buildPhrase(tokens, index, 3);
    if (trigram) {
      recordTerm(trigram, 'phrase', section, weight * 1.15, fragmentId, statsMap);
    }
  }
}

function buildPhrase(tokens: string[], start: number, length: number): string | null {
  const slice = tokens.slice(start, start + length);
  if (slice.length < length) {
    return null;
  }

  if (isFillerWord(slice[0]) || isFillerWord(slice[slice.length - 1])) {
    return null;
  }

  const meaningfulTokens = slice.filter((token) => !isFillerWord(token));
  const requiredMeaningful = length === 2 ? 1 : Math.min(2, length);
  if (!meaningfulTokens.length || meaningfulTokens.length < requiredMeaningful) {
    return null;
  }

  if (slice.every((token) => STOP_WORDS.has(token) && !CONNECTOR_WORDS.has(token))) {
    return null;
  }

  return slice.join(' ').trim();
}

function recordTerm(
  term: string,
  source: KeywordSource,
  section: RequirementTier,
  weight: number,
  fragmentId: number,
  statsMap: Map<string, KeywordStats>,
) {
  const normalized = normalizeTerm(term);
  if (!normalized || normalized.length < 3) {
    return;
  }
  if (isGenericTerm(normalized)) {
    return;
  }

  const synonymInfo = SYNONYM_LOOKUP.get(normalized);
  const canonical = synonymInfo?.canonical ?? normalized;
  const variants = new Set<string>(synonymInfo?.variants ?? [canonical]);
  variants.add(normalized);

  const existing = statsMap.get(canonical);
  const stats: KeywordStats =
    existing ??
    ({
      canonical,
      occurrences: 0,
      weightedOccurrences: 0,
      sectionWeights: {
        core: 0,
        responsibility: 0,
        preferred: 0,
        general: 0,
      },
      source,
      variants: new Set<string>(),
      surfaces: new Map<string, number>(),
      fragmentIds: new Set<number>(),
    } as KeywordStats);

  stats.occurrences += 1;
  stats.weightedOccurrences += weight;
  stats.sectionWeights[section] += weight;
  stats.source = stats.source === 'phrase' || source === 'phrase' ? 'phrase' : 'term';
  variants.forEach((variant) => stats.variants.add(variant));
  stats.surfaces.set(term, (stats.surfaces.get(term) ?? 0) + 1);
  stats.fragmentIds.add(fragmentId);

  statsMap.set(canonical, stats);
}

function shouldKeepToken(token: string): boolean {
  if (token.length < 3) {
    return false;
  }
  if (isFillerWord(token)) {
    return false;
  }
  return true;
}

function getDominantSection(sectionWeights: Record<RequirementTier, number>): RequirementTier {
  return (Object.entries(sectionWeights).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    'general') as RequirementTier;
}

function selectDisplayLabel(stats: KeywordStats): string {
  const sorted = Array.from(stats.surfaces.entries()).sort((a, b) => b[1] - a[1]);
  const label = sorted[0]?.[0] ?? stats.canonical;
  return label.replace(/\s+/g, ' ');
}

function buildNgramCounts(tokens: string[], size: number): Map<string, number> {
  const counts = new Map<string, number>();

  for (let index = 0; index <= tokens.length - size; index += 1) {
    const slice = tokens.slice(index, index + size);
    if (size === 1 && !shouldKeepToken(slice[0])) {
      continue;
    }

    if (size > 1) {
      const phrase = buildPhrase(tokens, index, size);
      if (!phrase) {
        continue;
      }
      const canonical = getCanonicalKey(phrase);
      counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
      continue;
    }

    const canonical = getCanonicalKey(slice[0]);
    counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
  }

  return counts;
}

function getCanonicalKey(term: string): string {
  const normalized = normalizeTerm(term);
  if (!normalized) {
    return '';
  }
  return SYNONYM_LOOKUP.get(normalized)?.canonical ?? normalized;
}

function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9+#\/\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericTerm(term: string): boolean {
  const tokens = term.split(' ').filter(Boolean);
  if (!tokens.length) {
    return true;
  }

  const joined = tokens.join(' ');
  if (SYNONYM_LOOKUP.has(joined)) {
    return false;
  }
  if (GENERIC_TERMS.has(joined)) {
    return true;
  }

  const fillerCount = tokens.filter((token) => isFillerWord(token)).length;
  if (fillerCount === tokens.length) {
    return true;
  }
  if (tokens.length > 1 && fillerCount / tokens.length >= 0.6) {
    return true;
  }

  return false;
}

function isFillerWord(token: string): boolean {
  if (SYNONYM_LOOKUP.has(token)) {
    return false;
  }
  return STOP_WORDS.has(token) || GENERIC_TERMS.has(token) || CONNECTOR_WORDS.has(token);
}

function computePercentile(values: number[], percentile: number): number {
  if (!values.length) {
    return 0;
  }
  const index = (values.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return values[lower]!;
  }
  const weight = index - lower;
  return values[lower]! * (1 - weight) + values[upper]! * weight;
}

function buildSummary(
  coverageScore: number,
  densityScore: number,
  breadthScore: number,
): string {
  const coveragePct = Math.round(coverageScore * 100);
  const densityPct = Math.round(densityScore * 100);
  const breadthPct = Math.round(breadthScore * 100);

  return `Coverage ${coveragePct}%, depth ${densityPct}%, breadth ${breadthPct}% vs JD priorities.`;
}

function buildSuggestions(
  missingKeywords: KeywordMatch[],
  matchedKeywords: KeywordMatch[],
): SuggestionInsight[] {
  const suggestions: SuggestionInsight[] = [];

  const prioritizedMissing = missingKeywords
    .slice()
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5);

  prioritizedMissing.forEach((match) => {
    const weight = Math.round(match.importance * 100);
    suggestions.push({
      canonical: match.canonical,
      label: match.label,
      priority: match.section,
      weight,
      type: 'add',
      action: `Add proof points for ${match.label} covering scope, systems/tools, stakeholders, and measurable HR impact.`,
      detail: `${describePriority(match.section)} priority · JD weight ${weight}%`,
    });
  });

  const enrichmentTargets = matchedKeywords
    .filter((match) => match.resumeHits > 0 && match.resumeHits < match.jdOccurrences)
    .slice(0, 2);

  enrichmentTargets.forEach((match) => {
    const weight = Math.round(match.importance * 100);
    suggestions.push({
      canonical: match.canonical,
      label: match.label,
      priority: match.section,
      weight,
      type: 'expand',
      action: `Deepen the story for ${match.label} to mirror JD emphasis—mention scope, HR tech stack, and outcomes.`,
      detail: `${describePriority(match.section)} priority · JD weight ${weight}%`,
    });
  });

  return suggestions;
}

function describePriority(section: RequirementTier): string {
  switch (section) {
    case 'core':
      return 'Must-have';
    case 'responsibility':
      return 'Role scope';
    case 'preferred':
      return 'Preferred';
    default:
      return 'General';
  }
}

function buildSynonymMap(): Map<string, SynonymInfo> {
  const lookup = new Map<string, SynonymInfo>();

  SYNONYM_GROUPS.forEach((group) => {
    if (!group.length) {
      return;
    }

    const normalizedGroup = group.map((term) => normalizeTerm(term)).filter(Boolean);
    if (!normalizedGroup.length) {
      return;
    }

    const canonical = normalizedGroup[0]!;
    const uniqueVariants = Array.from(new Set(normalizedGroup));

    const info: SynonymInfo = {
      canonical,
      variants: uniqueVariants,
    };

    uniqueVariants.forEach((variant) => {
      lookup.set(variant, info);
    });
  });

  return lookup;
}
