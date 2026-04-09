import { getProxyFetchOptions } from 'src/utils/proxy.js'
import { safeParseJSON } from 'src/utils/json.js'
import { createAssistantMessage } from 'src/utils/messages.js'
import type { Tool, Tools } from 'src/Tool.js'
import type { SystemPrompt } from 'src/utils/systemPromptType.js'
import { toolToAPISchema } from 'src/utils/api.js'
import type { ToolPermissionContext } from 'src/Tool.js'
import type { AgentDefinition } from 'src/tools/AgentTool/loadAgentsDir.js'
import type { AgentId } from 'src/types/ids.js'
import { getOpenAICompatConfigOrThrow, getOpenAIApiFormat } from './providerConfig.js'

type OpenAICompatChatMessage =
  | {
      role: 'system' | 'user' | 'assistant'
      content: string
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
  | { role: 'tool'; tool_call_id: string; content: string }

type OpenAICompatTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

function systemPromptToString(systemPrompt: SystemPrompt): string {
  return [...systemPrompt].join('\n\n').trim()
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

function normalizeOpenAICompatMessages({
  messages,
  systemPrompt,
}: {
  // Using `unknown` to avoid importing the missing src/types/message.js runtime module.
  // Runtime objects still follow the expected shape.
  messages: unknown[]
  systemPrompt: SystemPrompt
}): OpenAICompatChatMessage[] {
  const out: OpenAICompatChatMessage[] = []
  const sys = systemPromptToString(systemPrompt)
  if (sys) out.push({ role: 'system', content: sys })

  for (const m of messages as any[]) {
    if (!m || typeof m !== 'object') continue
    if (m.type === 'user') {
      const content = m.message?.content
      if (typeof content === 'string') {
        out.push({ role: 'user', content })
        continue
      }
      if (Array.isArray(content)) {
        // Split tool_results into tool-role messages; everything else becomes text.
        const textParts: string[] = []
        for (const block of content) {
          if (block?.type === 'tool_result') {
            out.push({
              role: 'tool',
              tool_call_id: String(block.tool_use_id ?? ''),
              content: stringifyToolResultContent(block.content),
            })
          } else if (block?.type === 'text' && typeof block.text === 'string') {
            textParts.push(block.text)
          } else if (typeof block?.type === 'string') {
            // Best-effort fallback for non-text blocks (images, etc.)
            textParts.push(`[${block.type}]`)
          }
        }
        if (textParts.length > 0) {
          out.push({ role: 'user', content: textParts.join('') })
        }
      }
      continue
    }

    if (m.type === 'assistant') {
      const blocks = m.message?.content
      if (typeof blocks === 'string') {
        out.push({ role: 'assistant', content: blocks })
        continue
      }
      if (Array.isArray(blocks)) {
        const textParts: string[] = []
        const toolCalls: OpenAICompatChatMessage['tool_calls'] = []
        for (const block of blocks) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            textParts.push(block.text)
          } else if (block?.type === 'tool_use') {
            const args = JSON.stringify(block.input ?? {})
            toolCalls.push({
              id: String(block.id ?? ''),
              type: 'function',
              function: { name: String(block.name ?? ''), arguments: args },
            })
          }
        }
        out.push({
          role: 'assistant',
          content: textParts.join(''),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        })
      }
    }
  }
  return out
}

async function toolsToOpenAICompatTools({
  tools,
  model,
  getToolPermissionContext,
  agents,
  allowedAgentTypes,
}: {
  tools: Tools
  model: string
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  agents: AgentDefinition[]
  allowedAgentTypes?: string[]
}): Promise<OpenAICompatTool[]> {
  const out: OpenAICompatTool[] = []
  for (const tool of tools) {
    const schema = await toolToAPISchema(tool as Tool, {
      tools,
      agents,
      allowedAgentTypes,
      getToolPermissionContext,
      model,
    })
    out.push({
      type: 'function',
      function: {
        name: schema.name,
        description: schema.description,
        parameters: schema.input_schema as unknown as Record<string, unknown>,
      },
    })
  }
  return out
}

function openaiUsageToAnthropicUsage(usage: any) {
  const input = Number(usage?.prompt_tokens ?? 0)
  const output = Number(usage?.completion_tokens ?? 0)
  return {
    input_tokens: Number.isFinite(input) ? input : 0,
    output_tokens: Number.isFinite(output) ? output : 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: null,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    inference_geo: null,
    iterations: null,
    speed: null,
  }
}

export async function queryOpenAICompatOnce({
  messages,
  systemPrompt,
  tools,
  model,
  toolChoice,
  temperature,
  maxTokens,
  signal,
  getToolPermissionContext,
  agents,
  allowedAgentTypes,
  agentId,
}: {
  messages: unknown[]
  systemPrompt: SystemPrompt
  tools: Tools
  model: string
  toolChoice?: { name?: string } | 'auto' | 'none'
  temperature?: number
  maxTokens?: number
  signal: AbortSignal
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  agents: AgentDefinition[]
  allowedAgentTypes?: string[]
  agentId?: AgentId
}) {
  const { baseUrl, apiKey, extraHeaders } = getOpenAICompatConfigOrThrow()

  const openaiMessages = normalizeOpenAICompatMessages({ messages, systemPrompt })
  const openaiTools = await toolsToOpenAICompatTools({
    tools,
    model,
    getToolPermissionContext,
    agents,
    allowedAgentTypes,
  })

  const body: Record<string, unknown> = {
    model,
    messages: openaiMessages,
    stream: false,
    ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
  }
  if (toolChoice && toolChoice !== 'auto') {
    if (toolChoice === 'none') body.tool_choice = 'none'
    else if (toolChoice.name) {
      body.tool_choice = {
        type: 'function',
        function: { name: toolChoice.name },
      }
    }
  }
  if (temperature !== undefined) body.temperature = temperature
  if (maxTokens !== undefined) body.max_tokens = maxTokens

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal,
    ...getProxyFetchOptions(),
  } as any)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `OpenAI-compatible request failed (${res.status}): ${text.slice(0, 500)}`,
    )
  }

  const data = (await res.json()) as any
  const choice = data?.choices?.[0]?.message
  const contentText = typeof choice?.content === 'string' ? choice.content : ''
  const toolCalls = Array.isArray(choice?.tool_calls) ? choice.tool_calls : []

  const blocks: any[] = []
  if (contentText) blocks.push({ type: 'text', text: contentText })

  for (const tc of toolCalls) {
    const id = String(tc?.id ?? '')
    const name = String(tc?.function?.name ?? '')
    const argsStr = String(tc?.function?.arguments ?? '')
    const parsed = safeParseJSON(argsStr, false)
    const input =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : { __unparsed_arguments: argsStr }
    blocks.push({ type: 'tool_use', id, name, input })
  }

  const assistant = createAssistantMessage({
    content: blocks.length > 0 ? (blocks as any) : '',
    usage: openaiUsageToAnthropicUsage(data?.usage),
  })

  // Help downstream tooling correlate tool calls in subagents (optional).
  if (agentId) {
    ;(assistant as any).agentId = agentId
  }

  return assistant
}

// ---------------------------------------------------------------------------
// OpenAI Responses API (/v1/responses)
// ---------------------------------------------------------------------------

type ResponsesInputItem =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | {
      role: 'assistant'
      content: string
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
  | { type: 'function_call_output'; call_id: string; output: string }

function normalizeToResponsesInput({
  messages,
  systemPrompt,
}: {
  messages: unknown[]
  systemPrompt: SystemPrompt
}): ResponsesInputItem[] {
  const out: ResponsesInputItem[] = []
  const sys = systemPromptToString(systemPrompt)
  if (sys) out.push({ role: 'system', content: sys })

  for (const m of messages as any[]) {
    if (!m || typeof m !== 'object') continue
    if (m.type === 'user') {
      const content = m.message?.content
      if (typeof content === 'string') {
        out.push({ role: 'user', content })
        continue
      }
      if (Array.isArray(content)) {
        const textParts: string[] = []
        for (const block of content) {
          if (block?.type === 'tool_result') {
            out.push({
              type: 'function_call_output',
              call_id: String(block.tool_use_id ?? ''),
              output: stringifyToolResultContent(block.content),
            })
          } else if (block?.type === 'text' && typeof block.text === 'string') {
            textParts.push(block.text)
          } else if (typeof block?.type === 'string') {
            textParts.push(`[${block.type}]`)
          }
        }
        if (textParts.length > 0) {
          out.push({ role: 'user', content: textParts.join('') })
        }
      }
      continue
    }

    if (m.type === 'assistant') {
      const blocks = m.message?.content
      if (typeof blocks === 'string') {
        out.push({ role: 'assistant', content: blocks })
        continue
      }
      if (Array.isArray(blocks)) {
        const textParts: string[] = []
        const toolCalls: Array<{
          id: string
          type: 'function'
          function: { name: string; arguments: string }
        }> = []
        for (const block of blocks) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            textParts.push(block.text)
          } else if (block?.type === 'tool_use') {
            toolCalls.push({
              id: String(block.id ?? ''),
              type: 'function',
              function: {
                name: String(block.name ?? ''),
                arguments: JSON.stringify(block.input ?? {}),
              },
            })
          }
        }
        out.push({
          role: 'assistant',
          content: textParts.join(''),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        })
      }
    }
  }
  return out
}

function responsesUsageToAnthropicUsage(usage: any) {
  const input = Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0)
  const output = Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0)
  return {
    input_tokens: Number.isFinite(input) ? input : 0,
    output_tokens: Number.isFinite(output) ? output : 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: null,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    inference_geo: null,
    iterations: null,
    speed: null,
  }
}

export async function queryOpenAIResponsesOnce({
  messages,
  systemPrompt,
  tools,
  model,
  toolChoice,
  temperature,
  maxTokens,
  signal,
  getToolPermissionContext,
  agents,
  allowedAgentTypes,
  agentId,
}: {
  messages: unknown[]
  systemPrompt: SystemPrompt
  tools: Tools
  model: string
  toolChoice?: { name?: string } | 'auto' | 'none'
  temperature?: number
  maxTokens?: number
  signal: AbortSignal
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  agents: AgentDefinition[]
  allowedAgentTypes?: string[]
  agentId?: AgentId
}) {
  const { baseUrl, apiKey, extraHeaders } = getOpenAICompatConfigOrThrow()

  const input = normalizeToResponsesInput({ messages, systemPrompt })
  const openaiTools = await toolsToOpenAICompatTools({
    tools,
    model,
    getToolPermissionContext,
    agents,
    allowedAgentTypes,
  })

  const body: Record<string, unknown> = {
    model,
    input,
    ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
  }
  if (toolChoice && toolChoice !== 'auto') {
    if (toolChoice === 'none') body.tool_choice = 'none'
    else if (typeof toolChoice === 'object' && toolChoice.name) {
      body.tool_choice = {
        type: 'function',
        function: { name: toolChoice.name },
      }
    }
  }
  if (temperature !== undefined) body.temperature = temperature
  if (maxTokens !== undefined) body.max_output_tokens = maxTokens

  const url = `${baseUrl.replace(/\/+$/, '')}/responses`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal,
    ...getProxyFetchOptions(),
  } as any)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `OpenAI Responses API request failed (${res.status}): ${text.slice(0, 500)}`,
    )
  }

  const data = (await res.json()) as any

  // Parse output items from the Responses API format.
  // output is an array of items: { type: "message", ... } or { type: "function_call", ... }
  const outputItems: any[] = Array.isArray(data?.output) ? data.output : []
  const blocks: any[] = []

  for (const item of outputItems) {
    if (item?.type === 'message') {
      // message items have content array with { type: "output_text", text } blocks
      const contentArr = Array.isArray(item.content) ? item.content : []
      for (const c of contentArr) {
        if (c?.type === 'output_text' && typeof c.text === 'string') {
          blocks.push({ type: 'text', text: c.text })
        } else if (c?.type === 'text' && typeof c.text === 'string') {
          blocks.push({ type: 'text', text: c.text })
        }
      }
    } else if (item?.type === 'function_call') {
      const id = String(item.call_id ?? item.id ?? '')
      const name = String(item.name ?? '')
      const argsStr = String(item.arguments ?? '')
      const parsed = safeParseJSON(argsStr, false)
      const inputObj =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed
          : { __unparsed_arguments: argsStr }
      blocks.push({ type: 'tool_use', id, name, input: inputObj })
    }
  }

  // Fallback: if output is empty but there is a top-level output_text (non-standard)
  if (blocks.length === 0 && typeof data?.output_text === 'string' && data.output_text) {
    blocks.push({ type: 'text', text: data.output_text })
  }

  const assistant = createAssistantMessage({
    content: blocks.length > 0 ? (blocks as any) : '',
    usage: responsesUsageToAnthropicUsage(data?.usage),
  })

  if (agentId) {
    ;(assistant as any).agentId = agentId
  }

  return assistant
}

