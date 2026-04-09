import fs from 'fs'
import path from 'path'

function parseDotenv(contents: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq === -1) continue

    const key = line.slice(0, eq).trim()
    if (!key) continue

    let value = line.slice(eq + 1).trim()
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function tryLoadDotenvFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false
    const contents = fs.readFileSync(filePath, 'utf8')
    const parsed = parseDotenv(contents)
    for (const [k, v] of Object.entries(parsed)) {
      // Never override explicit environment variables.
      if (process.env[k] === undefined) process.env[k] = v
    }
    return true
  } catch {
    return false
  }
}

/**
 * Loads `.env`-style files (no expansion) from `startDir` and a few parents.
 * Designed to be safe to call during startup before trust is established:
 * - only reads local files
 * - never executes code
 * - never overrides existing process.env values
 */
export function loadDotenvFromNearest({
  startDir,
  maxParents = 3,
  filenames = ['.env', '.env.local'],
}: {
  startDir: string
  maxParents?: number
  filenames?: string[]
}): { loaded: string[] } {
  const loaded: string[] = []
  let dir = path.resolve(startDir)
  for (let i = 0; i <= maxParents; i++) {
    for (const name of filenames) {
      const p = path.join(dir, name)
      if (tryLoadDotenvFile(p)) loaded.push(p)
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return { loaded }
}

