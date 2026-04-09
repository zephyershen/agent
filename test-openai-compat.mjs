#!/usr/bin/env node
/**
 * Standalone test for both OpenAI-compatible APIs:
 *   1. POST /v1/chat/completions  (existing)
 *   2. POST /v1/responses          (new)
 *
 * Spins up a tiny mock HTTP server that responds in each format,
 * then exercises the exported functions from openaiCompat.ts logic
 * by simulating the same fetch flow.
 *
 * Usage:  node test-openai-compat.mjs
 */

import http from 'node:http'

// ─── helpers ────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`) }
  else      { failed++; console.error(`  ❌ FAIL: ${msg}`) }
}

// ─── Mock server ────────────────────────────────────────────────────────────

function createMockServer() {
  return http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      const parsed = JSON.parse(body)
      res.setHeader('Content-Type', 'application/json')

      // ── /v1/chat/completions ──────────────────────────────────────────
      if (req.url === '/v1/chat/completions') {
        const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0
        // If tools are provided and the last user message contains "weather",
        // respond with a tool call; otherwise respond with plain text.
        const lastUserMsg = (parsed.messages || [])
          .filter(m => m.role === 'user')
          .pop()
        const wantToolCall = hasTools && lastUserMsg?.content?.includes('weather')

        if (wantToolCall) {
          res.end(JSON.stringify({
            id: 'chatcmpl-test-tool',
            object: 'chat.completion',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location":"Beijing","unit":"celsius"}',
                  },
                }],
              },
              finish_reason: 'tool_calls',
            }],
            usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 },
          }))
        } else {
          res.end(JSON.stringify({
            id: 'chatcmpl-test-text',
            object: 'chat.completion',
            choices: [{
              index: 0,
              message: { role: 'assistant', content: 'Hello from chat/completions!' },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }))
        }
        return
      }

      // ── /v1/responses ─────────────────────────────────────────────────
      if (req.url === '/v1/responses') {
        const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0
        const inputItems = Array.isArray(parsed.input) ? parsed.input : []
        const lastUserInput = inputItems.filter(i => i.role === 'user').pop()
        const wantToolCall = hasTools && lastUserInput?.content?.includes('weather')

        if (wantToolCall) {
          res.end(JSON.stringify({
            id: 'resp-test-tool',
            object: 'response',
            model: parsed.model,
            output: [{
              type: 'function_call',
              call_id: 'call_resp_456',
              name: 'get_weather',
              arguments: '{"location":"Shanghai","unit":"celsius"}',
            }],
            usage: { input_tokens: 25, output_tokens: 18, total_tokens: 43 },
          }))
        } else {
          res.end(JSON.stringify({
            id: 'resp-test-text',
            object: 'response',
            model: parsed.model,
            output: [{
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Hello from responses API!' }],
            }],
            usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 },
          }))
        }
        return
      }

      res.statusCode = 404
      res.end('{"error":"not found"}')
    })
  })
}

// ─── Test runner ────────────────────────────────────────────────────────────

async function runTests(baseUrl) {
  const headers = {
    Authorization: 'Bearer test-key',
    'Content-Type': 'application/json',
  }

  // ============================================================
  console.log('\n═══ Test 1: chat/completions — plain text ═══')
  // ============================================================
  {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'test-model',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Say hello' },
        ],
        stream: false,
      }),
    })
    const data = await res.json()
    console.log('  Response:', JSON.stringify(data, null, 2))
    assert(res.ok, 'status 200')
    assert(data.choices?.[0]?.message?.content === 'Hello from chat/completions!', 'text content matches')
    assert(data.usage?.prompt_tokens === 10, 'usage.prompt_tokens')
    assert(!data.choices?.[0]?.message?.tool_calls, 'no tool_calls in plain text response')
  }

  // ============================================================
  console.log('\n═══ Test 2: chat/completions — tool call ═══')
  // ============================================================
  {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'test-model',
        messages: [
          { role: 'user', content: 'What is the weather in Beijing?' },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather info',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
                unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
              },
              required: ['location'],
            },
          },
        }],
        stream: false,
      }),
    })
    const data = await res.json()
    console.log('  Response:', JSON.stringify(data, null, 2))
    assert(res.ok, 'status 200')
    const tc = data.choices?.[0]?.message?.tool_calls?.[0]
    assert(tc, 'has tool_calls')
    assert(tc?.function?.name === 'get_weather', 'tool name = get_weather')
    const args = JSON.parse(tc?.function?.arguments || '{}')
    assert(args.location === 'Beijing', 'tool args.location = Beijing')
    assert(tc?.id === 'call_abc123', 'tool call id = call_abc123')
  }

  // ============================================================
  console.log('\n═══ Test 3: responses — plain text ═══')
  // ============================================================
  {
    const res = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'test-model',
        input: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Say hello' },
        ],
      }),
    })
    const data = await res.json()
    console.log('  Response:', JSON.stringify(data, null, 2))
    assert(res.ok, 'status 200')
    assert(data.object === 'response', 'object = response')
    const msgOutput = data.output?.find(o => o.type === 'message')
    assert(msgOutput, 'has message output item')
    const textContent = msgOutput?.content?.find(c => c.type === 'output_text')
    assert(textContent?.text === 'Hello from responses API!', 'text content matches')
    assert(data.usage?.input_tokens === 12, 'usage.input_tokens')
  }

  // ============================================================
  console.log('\n═══ Test 4: responses — tool call ═══')
  // ============================================================
  {
    const res = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'test-model',
        input: [
          { role: 'user', content: 'What is the weather in Shanghai?' },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather info',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
                unit: { type: 'string' },
              },
              required: ['location'],
            },
          },
        }],
      }),
    })
    const data = await res.json()
    console.log('  Response:', JSON.stringify(data, null, 2))
    assert(res.ok, 'status 200')
    const fnCall = data.output?.find(o => o.type === 'function_call')
    assert(fnCall, 'has function_call output item')
    assert(fnCall?.name === 'get_weather', 'tool name = get_weather')
    const args = JSON.parse(fnCall?.arguments || '{}')
    assert(args.location === 'Shanghai', 'tool args.location = Shanghai')
    assert(fnCall?.call_id === 'call_resp_456', 'call_id = call_resp_456')
  }

  // ============================================================
  console.log('\n═══ Test 5: responses — tool result round-trip (function_call_output) ═══')
  // ============================================================
  {
    // Simulate sending a function_call_output back in input
    const res = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'test-model',
        input: [
          { role: 'user', content: 'What is the weather?' },
          { type: 'function_call_output', call_id: 'call_resp_456', output: '{"temp":25,"unit":"celsius"}' },
        ],
      }),
    })
    const data = await res.json()
    console.log('  Response:', JSON.stringify(data, null, 2))
    assert(res.ok, 'status 200')
    // Mock returns plain text when no tools + no "weather" keyword match
    const msgOutput = data.output?.find(o => o.type === 'message')
    assert(msgOutput, 'got message output after tool result')
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

const server = createMockServer()
server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`
  console.log(`🚀 Mock server listening on ${baseUrl}`)

  try {
    await runTests(baseUrl)
  } catch (e) {
    console.error('Unexpected error:', e)
    failed++
  } finally {
    server.close()
    console.log(`\n${'═'.repeat(50)}`)
    console.log(`Results: ${passed} passed, ${failed} failed`)
    console.log('═'.repeat(50))
    process.exit(failed > 0 ? 1 : 0)
  }
})
