// Dev entrypoint to make the extracted sources runnable without the bundler.
// In the real build, these values are injected/inlined at bundle time.
(globalThis as any).MACRO ??= {
  // Use a non-prerelease SemVer by default so any "min version" gates pass.
  // Override via CLAUDE_CODE_VERSION if you need a specific value.
  VERSION: process.env.CLAUDE_CODE_VERSION ?? '0.0.0',
  BUILD_TIME: process.env.CLAUDE_CODE_BUILD_TIME ?? new Date().toISOString(),
  PACKAGE_URL: process.env.CLAUDE_CODE_PACKAGE_URL ?? '@anthropic-ai/claude-code',
  NATIVE_PACKAGE_URL:
    process.env.CLAUDE_CODE_NATIVE_PACKAGE_URL ??
    '@anthropic-ai/claude-code-native',
  FEEDBACK_CHANNEL:
    process.env.CLAUDE_CODE_FEEDBACK_CHANNEL ??
    'https://github.com/anthropics/claude-code',
  ISSUES_EXPLAINER:
    process.env.CLAUDE_CODE_ISSUES_EXPLAINER ??
    'use /bug or file an issue in the feedback channel',
  VERSION_CHANGELOG: '',
};

// Default to --bare-equivalent behavior for local dev. This avoids OAuth
// preflight connectivity checks (which can hard-exit in restricted networks)
// and keeps startup deterministic. Override by setting CLAUDE_CODE_SIMPLE=0.
process.env.CLAUDE_CODE_SIMPLE ??= '1';

await import('./entrypoints/cli.tsx');
