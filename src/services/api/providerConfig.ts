export type LLMProviderKind = 'anthropic' | 'openai_compat'
export type OpenAIApiFormat = 'chat_completions' | 'responses'

export function getLLMProviderKind(): LLMProviderKind {
  const raw =
    process.env.LLM_PROVIDER ||
    process.env.CLAUDE_CODE_LLM_PROVIDER ||
    process.env.CLAUDE_CODE_PROVIDER
  const normalized = (raw ?? '').trim().toLowerCase()

  if (
    normalized === 'openai' ||
    normalized === 'openai_compat' ||
    normalized === 'openai-compatible' ||
    normalized === 'openrouter'
  ) {
    return 'openai_compat'
  }
  return 'anthropic'
}

function normalizeBaseUrl(baseUrl: string): string {
  // Many OpenAI-compatible providers expect `/v1` (OpenRouter base is `/api/v1`).
  // Accept either form, but always return a base that ends with `/v1`.
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  try {
    const u = new URL(trimmed)
    if (u.pathname.endsWith('/v1')) return u.toString()
    u.pathname = (u.pathname.replace(/\/+$/, '') || '') + '/v1'
    return u.toString().replace(/\/+$/, '')
  } catch {
    // If URL parsing fails, keep a best-effort string append.
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
  }
}

export function getOpenAICompatConfigOrThrow(): {
  baseUrl: string
  apiKey: string
  extraHeaders: Record<string, string>
} {
  const apiKey =
    process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || process.env.API_KEY
  if (!apiKey) {
    throw new Error(
      'Missing OpenAI-compatible API key. Set OPENAI_API_KEY or LLM_API_KEY.',
    )
  }

  const rawBaseUrl =
    process.env.OPENAI_BASE_URL ||
    process.env.LLM_BASE_URL ||
    process.env.OPENAI_API_BASE_URL
  if (!rawBaseUrl) {
    throw new Error(
      'Missing OpenAI-compatible base URL. Set OPENAI_BASE_URL or LLM_BASE_URL.',
    )
  }

  const extraHeaders: Record<string, string> = {}
  // OpenRouter convention.
  if (process.env.OPENROUTER_HTTP_REFERER) {
    extraHeaders['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER
  }
  if (process.env.OPENROUTER_X_TITLE) {
    extraHeaders['X-Title'] = process.env.OPENROUTER_X_TITLE
  }

  return {
    baseUrl: normalizeBaseUrl(rawBaseUrl),
    apiKey,
    extraHeaders,
  }
}

export function getOpenAIApiFormat(): OpenAIApiFormat {
  const raw =
    process.env.OPENAI_API_FORMAT ||
    process.env.LLM_API_FORMAT
  const normalized = (raw ?? '').trim().toLowerCase()
  if (normalized === 'responses') return 'responses'
  return 'chat_completions'
}
