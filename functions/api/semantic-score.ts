import {
  buildSemanticScorePayload,
  extractStructuredResponse,
  type KeywordInput,
} from '../../server/semanticPayloads';

type Env = {
  OPENAI_API_KEY?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

const jsonResponse = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    ...init,
  });

async function callOpenAI(payload: unknown, apiKey: string) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

export const onRequestOptions = async () =>
  new Response(null, { headers: corsHeaders });

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  if (!env.OPENAI_API_KEY) {
    return jsonResponse({ error: 'Server is missing OPENAI_API_KEY configuration.' }, { status: 500 });
  }

  let body: { jdText?: string; resumeText?: string; keywords?: KeywordInput };
  try {
    body = await request.json();
  } catch (error) {
    console.warn('[semantic-score] Invalid JSON payload', error);
    return jsonResponse({ error: 'Body must be valid JSON.' }, { status: 400 });
  }

  const { jdText, resumeText, keywords } = body ?? {};
  if (typeof jdText !== 'string' || typeof resumeText !== 'string') {
    return jsonResponse({ error: 'jdText and resumeText are required string fields.' }, { status: 400 });
  }

  try {
    const payload = buildSemanticScorePayload(jdText, resumeText, keywords as KeywordInput);
    const aiResponse = await callOpenAI(payload, env.OPENAI_API_KEY);
    const structured = extractStructuredResponse(aiResponse);
    return jsonResponse(structured);
  } catch (error) {
    console.error('[semantic-score] Semantic scoring failed', error);
    return jsonResponse(
      { error: 'Semantic scoring failed. Check the Cloudflare function logs for details.' },
      { status: 502 },
    );
  }
};
