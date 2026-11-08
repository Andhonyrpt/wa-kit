// PostToolUse (Edit|Write): corre ESLint solo sobre el archivo modificado.
// Si hay errores sale con 2 y los manda por stderr, que Claude recibe como feedback.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs']);

async function main() {
  process.stdin.setEncoding('utf8');
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    process.exit(0);
  }

  const file = input?.tool_input?.file_path;
  if (typeof file !== 'string' || !EXTS.has(extname(file).toLowerCase())) process.exit(0);
  if (/[/\\](node_modules|dist)[/\\]/.test(file) || !existsSync(file)) process.exit(0);

  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const rel = relative(root, resolve(file));
  // Fuera del proyecto no aplica la configuración del repo.
  if (rel.startsWith('..')) process.exit(0);

  const eslintBin = join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
  if (!existsSync(eslintBin)) process.exit(0);

  const res = spawnSync(process.execPath, [eslintBin, '--no-warn-ignored', '--format', 'stylish', rel], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  });

  if (res.status === 0) process.exit(0);
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
  if (res.status === 1) {
    process.stderr.write(`ESLint encontró problemas en ${rel}:\n${out}\nCorrígelos antes de seguir.\n`);
    process.exit(2);
  }
  // Error de configuración o timeout: avisar sin bloquear el flujo.
  process.stderr.write(`lint.js: ESLint no pudo correr sobre ${rel} (status ${res.status}).\n${out}\n`);
  process.exit(1);
}

await main();
