// Stop: si hay cambios sin commit y el archivo de pendientes no está entre ellos, pide a Claude
// (una vez por turno) revisar si hay que actualizarlo.
//
// El archivo sale de WA_KIT_PENDING_FILE (ruta relativa a la raíz del proyecto; por defecto
// docs/PENDIENTES.md). Si el proyecto no tiene ese archivo, el hook no hace nada.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_PENDING_FILE = 'docs/PENDIENTES.md';

function normalize(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

async function main() {
  process.stdin.setEncoding('utf8');
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try {
    input = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    // Sin JSON válido seguimos con valores por defecto.
  }
  if (input.stop_hook_active) process.exit(0);

  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const pendingFile = normalize(process.env.WA_KIT_PENDING_FILE || DEFAULT_PENDING_FILE);
  if (!existsSync(join(root, pendingFile))) process.exit(0);

  const res = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  if (res.status !== 0) process.exit(0);

  const changed = res.stdout.split('\n').filter((l) => l.trim() !== '');
  if (changed.length === 0) process.exit(0);
  if (changed.some((l) => normalize(l.slice(3).replace(/"/g, '').trim()) === pendingFile)) process.exit(0);

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `Hay cambios sin commit (${changed.length} archivo${changed.length === 1 ? '' : 's'}) y ` +
      `${pendingFile} no cambió. Revisa si queda alguna tarea incompleta que anotar ahí ` +
      '(y supuestos nuevos en el archivo de supuestos del proyecto). Si no aplica, dilo en una línea y termina.',
  }));
  process.exit(0);
}

await main();
