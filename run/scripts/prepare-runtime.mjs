import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), '..');
const SRC_DIR = path.join(ROOT, 'src');
const WORK_DIR = path.resolve(process.cwd(), 'work');
const WORK_SRC = path.join(WORK_DIR, 'src');
const OVERLAY_SRC = path.resolve(process.cwd(), 'overlay', 'src');

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const FILE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function walkFiles(dirPath, out = []) {
  if (!fs.existsSync(dirPath)) return out;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath, out);
    else if (entry.isFile()) out.push(fullPath);
  }
  return out;
}

function writeFileSafe(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function parseNamedSpec(content) {
  const names = new Set();
  const cleaned = content
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return names;

  for (const chunk of cleaned.split(',')) {
    const token = chunk.trim();
    if (!token || token.startsWith('type ')) continue;
    const sourceName = token.split(/\s+as\s+/i)[0]?.trim();
    if (sourceName && sourceName !== 'default') names.add(sourceName);
  }
  return names;
}

function collectImports(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const records = [];

  const fromRegex = /(import|export)\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = fromRegex.exec(source)) !== null) {
    const kind = match[1];
    const clause = match[2]?.trim() ?? '';
    const specifier = match[3];

    const info = { default: false, named: new Set() };

    if (kind === 'import') {
      if (!clause.startsWith('type ')) {
        if (clause.includes('{')) {
          const brace = clause.match(/\{([\s\S]*?)\}/);
          if (brace) {
            for (const name of parseNamedSpec(brace[1])) info.named.add(name);
          }
          const beforeBrace = clause
            .split('{')[0]
            .trim()
            .replace(/,$/, '')
            .trim();
          if (beforeBrace && !beforeBrace.startsWith('*')) info.default = true;
        } else if (clause.startsWith('* as')) {
          // namespace import: no named/default requirement
        } else {
          info.default = true;
        }
      }
    } else {
      if (!clause.startsWith('*')) {
        const brace = clause.match(/\{([\s\S]*?)\}/);
        if (brace) {
          for (const name of parseNamedSpec(brace[1])) info.named.add(name);
        }
      }
    }

    records.push({ specifier, info });
  }

  const sideEffectImportRegex = /import\s+['"]([^'"]+)['"]/g;
  while ((match = sideEffectImportRegex.exec(source)) !== null) {
    records.push({
      specifier: match[1],
      info: { default: false, named: new Set() },
    });
  }

  const requireRegex = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(source)) !== null) {
    records.push({
      specifier: match[1],
      info: { default: true, named: new Set() },
    });
  }

  return records;
}

function findRelativeTarget(importerFile, specifier) {
  const base = path.resolve(path.dirname(importerFile), specifier);

  const candidates = [];
  if (path.extname(base)) {
    candidates.push(base);
    // TS sources often use .js specifiers for NodeNext. Bun can run the .ts
    // directly, so accept the TS file as satisfying the import.
    if (base.endsWith('.js')) {
      candidates.push(base.slice(0, -3) + '.ts');
      candidates.push(base.slice(0, -3) + '.tsx');
    }
  } else {
    for (const ext of FILE_EXTS) candidates.push(base + ext);
    for (const ext of FILE_EXTS) candidates.push(path.join(base, `index${ext}`));
  }

  const existing = candidates.find(filePath => fs.existsSync(filePath));
  if (existing) return { exists: true, filePath: existing };

  // Pick a deterministic stub target.
  if (path.extname(base)) return { exists: false, filePath: base };
  return { exists: false, filePath: `${base}.ts` };
}

function renderMissingModuleStub(namedExports, needsDefault) {
  const lines = [
    '// Auto-generated runtime stub for missing relative import.',
    'const __noop = () => undefined;',
    'const __proxy = new Proxy(__noop, {',
    '  get: () => __proxy,',
    '  apply: () => undefined,',
    '});',
    '',
  ];

  if (needsDefault) lines.push('export default __proxy;');
  for (const exportName of [...namedExports].sort()) {
    if (!/^[$A-Z_][0-9A-Z_$]*$/i.test(exportName)) continue;
    lines.push(`export const ${exportName} = __proxy;`);
  }
  if (!needsDefault && namedExports.size === 0) lines.push('export {};');
  lines.push('');
  return lines.join('\n');
}

function renderMarkdownLoader(mdBasename) {
  return [
    '// Auto-generated loader for markdown imports in Bun dev mode.',
    "import fs from 'node:fs';",
    '',
    `export default fs.readFileSync(new URL(${JSON.stringify(`./${mdBasename}`)}, import.meta.url), 'utf8');`,
    '',
  ].join('\n');
}

function rewriteMarkdownImports(filePath, markdownLoads) {
  if (!SOURCE_FILE_RE.test(filePath)) return;

  const source = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  const rewrite = (pattern) =>
    source.replace(pattern, (full, pre, spec, post) => {
      if (!spec.endsWith('.md')) return full;
      if (spec.startsWith('.')) {
        const mdPath = path.resolve(path.dirname(filePath), spec);
        markdownLoads.add(mdPath);
      }
      changed = true;
      return `${pre}${spec}.js${post}`;
    });

  const mdFromRe = /(from\s+['"])([^'"]+\.md)(['"])/g;
  const mdSideEffectRe = /(import\s+['"])([^'"]+\.md)(['"])/g;
  const mdRequireRe = /(require\(\s*['"])([^'"]+\.md)(['"]\s*\))/g;

  const out = rewrite(mdFromRe);
  const out2 = out.replace(mdSideEffectRe, (full, pre, spec, post) => {
    if (!spec.endsWith('.md')) return full;
    if (spec.startsWith('.')) {
      const mdPath = path.resolve(path.dirname(filePath), spec);
      markdownLoads.add(mdPath);
    }
    changed = true;
    return `${pre}${spec}.js${post}`;
  });
  const out3 = out2.replace(mdRequireRe, (full, pre, spec, post) => {
    if (!spec.endsWith('.md')) return full;
    if (spec.startsWith('.')) {
      const mdPath = path.resolve(path.dirname(filePath), spec);
      markdownLoads.add(mdPath);
    }
    changed = true;
    return `${pre}${spec}.js${post}`;
  });

  if (changed) fs.writeFileSync(filePath, out3, 'utf8');
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Source directory not found: ${SRC_DIR}`);
    process.exit(1);
  }

  rmrf(WORK_DIR);
  ensureDir(WORK_DIR);
  fs.cpSync(SRC_DIR, WORK_SRC, { recursive: true });
  if (fs.existsSync(OVERLAY_SRC)) {
    fs.cpSync(OVERLAY_SRC, WORK_SRC, { recursive: true });
  }

  // Commander (v8+) rejects multi-character short flags like "-d2e".
  // Patch the generated workspace only; keep original sources untouched.
  const mainPath = path.join(WORK_SRC, 'main.tsx');
  if (fs.existsSync(mainPath)) {
    const mainSource = fs.readFileSync(mainPath, 'utf8');
    const patched = mainSource.replace(
      "-d2e, --debug-to-stderr",
      "--debug-to-stderr",
    );
    if (patched !== mainSource) fs.writeFileSync(mainPath, patched, 'utf8');
  }

  const srcFiles = walkFiles(WORK_SRC).filter(filePath => SOURCE_FILE_RE.test(filePath));

  // 1) Make markdown imports runnable under Bun by rewriting `.md` -> `.md.js`
  //    and generating a tiny loader module that reads the adjacent `.md` file.
  const markdownLoads = new Set();
  for (const filePath of srcFiles) rewriteMarkdownImports(filePath, markdownLoads);
  for (const mdPath of markdownLoads) {
    const mdBasename = path.basename(mdPath);
    const mdJsPath = `${mdPath}.js`;
    if (!fs.existsSync(mdJsPath)) {
      if (fs.existsSync(mdPath)) writeFileSafe(mdJsPath, renderMarkdownLoader(mdBasename));
      else writeFileSafe(mdJsPath, 'export default \"\";\n');
    }
  }

  // 2) Generate stubs for missing *relative* modules (only).
  const missingRelative = new Map();
  for (const filePath of srcFiles) {
    for (const record of collectImports(filePath)) {
      const { specifier, info } = record;
      if (!specifier.startsWith('.')) continue;

      const target = findRelativeTarget(filePath, specifier);
      if (target.exists) continue;

      const current = missingRelative.get(target.filePath) ?? { default: false, named: new Set() };
      current.default ||= info.default;
      for (const name of info.named) current.named.add(name);
      missingRelative.set(target.filePath, current);
    }
  }

  for (const [filePath, info] of missingRelative) {
    if (fs.existsSync(filePath)) continue;
    writeFileSafe(filePath, renderMissingModuleStub(info.named, info.default));
  }

  console.log(
    [
      `Prepared runtime workspace: ${WORK_DIR}`,
      `Generated markdown loaders: ${markdownLoads.size}`,
      `Generated relative stubs: ${missingRelative.size}`,
    ].join('\n'),
  );
}

main();
