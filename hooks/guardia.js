// PreToolUse: bloquea acceso a archivos .env* (salvo .env.example) y comandos
// peligrosos o que imprimen variables de entorno. Exit 2 = bloquear; stderr va a Claude.
import { basename } from 'node:path';

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const ALLOWED_ENV_FILE = '.env.example';

function isSecretEnvFile(p) {
  if (typeof p !== 'string' || p === '') return false;
  const name = basename(p.replace(/\\/g, '/')).toLowerCase();
  return name.startsWith('.env') && name !== ALLOWED_ENV_FILE;
}

// Un glob de Grep apunta a .env si alguna de sus piezas menciona ".env" y no es .env.example.
function globTouchesEnv(glob) {
  return glob.split(/[{},/\\]/).some((piece) => /\.env/i.test(piece) && piece.toLowerCase() !== ALLOWED_ENV_FILE);
}

// En `git commit` el mensaje puede describir lo que bloquea este hook; se quita antes de
// evaluar para no dar falsos positivos. Solo se quita texto que el shell NO expande ni lee:
//   -m '…' / --message='…', -m "…" sin $ ni `, here-string @'…'@ y heredoc con el
//   delimitador entre comillas (<<'EOF').
// Nunca -F (recibe un archivo: `-F .env` lo leería), "…" con $( ) / $env: / `, @"…"@ ni
// heredoc sin comillas: esos se revisan completos.
// `git commit` debe ser el inicio de un comando (no cuenta `echo git commit …`), y los
// argumentos se acotan a 300 caracteres para que la regex no se vuelva lenta.
// El prefijo no cruza comillas: así un ` -m` escrito dentro de otro argumento entre comillas
// no puede descuadrarlas (`git commit -t 'x -m' -F .env 'y'`).
const COMMIT = String.raw`(?:^\s*|[;&|({]\s*|\n\s*)git\s+commit\b[^;&|\n'"]{0,300}?`;
const COMMIT_MESSAGE_PATTERNS = [
  // git commit -F - <<'EOF' … EOF
  // Solo se quita el cuerpo: la línea del << queda a la vista (`<<'EOF' && cat .env` se revisa).
  new RegExp(String.raw`(${COMMIT}<<-?\s*(['"])(\w+)(?!\w)\2[^\n]*\n)[\s\S]*?^\s*\3\s*$`, 'gim'),
  // git commit -m @' … '@ (PowerShell, literal)
  new RegExp(String.raw`(${COMMIT})@'[^\n]*\n[\s\S]*?^'@`, 'gim'),
  // -m / -am / --message, en '…' o en "…" sin $ ni `. Sin escapes con \ (en PowerShell \ es
  // un carácter normal); ante la duda queda más texto a la vista, no menos.
  new RegExp(String.raw`(${COMMIT}\s(?:-[a-z]*m|--message)(?:=|\s*))(?:'[^']+'|"[^"$\x60]+")`, 'gi'),
];

function stripCommitMessage(cmd) {
  let text = cmd;
  for (const re of COMMIT_MESSAGE_PATTERNS) {
    // Repetir hasta que no cambie, para varios -m en el mismo commit.
    for (let prev = null; prev !== text;) {
      prev = text;
      // Marcador sin comillas, para que el prefijo pueda seguir hasta el siguiente -m.
      text = text.replace(re, '$1 _');
    }
  }
  return text;
}

// Prefijos válidos de parámetros de PowerShell (-r, -rec, -Recurse; -fo, -Force).
const PS_RECURSE = String.raw`-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?\b`;
const PS_FORCE = String.raw`-fo(?:r(?:c(?:e)?)?)?\b`;
const SEP = String.raw`(?:^|[;&|(\x60{]\s*|\s[-/][ck]\s+['"]?)`; // inicio de comando
const END = String.raw`\s*(?:$|[;&|)>'"}])`; // fin de comando sin argumentos

// Código en línea de node/python: solo el argumento de -e/-c (comillas, here-string o una
// palabra) o el heredoc de `node -`/`python -`, no las líneas de otros comandos que sigan.
// Se recorre con indexOf y no con una sola regex para que no haya backtracking costoso.
const MAX_INLINE = 4000;

function readInlineArg(rest) {
  const pairs = [["@'", "'@"], ['@"', '"@'], ['"', '"'], ["'", "'"]];
  for (const [open, close] of pairs) {
    if (rest.startsWith(open)) {
      const end = rest.indexOf(close, open.length);
      return rest.slice(open.length, end === -1 ? MAX_INLINE : Math.min(end, MAX_INLINE));
    }
  }
  return rest.slice(0, MAX_INLINE).split(/[\s;&|]/, 1)[0];
}

function readHeredoc(rest, delimiter) {
  const lines = rest.slice(0, MAX_INLINE).split('\n');
  const end = lines.findIndex((l) => l.trim() === delimiter);
  return (end === -1 ? lines : lines.slice(0, end)).join('\n');
}

function inlineCode(program, evalFlags, needle) {
  const evalRe = new RegExp(String.raw`\b${program}\b[^;&|\n]{0,200}?\s(?:${evalFlags})(?:=|\s+)`, 'gi');
  const stdinRe = new RegExp(String.raw`\b${program}\b[^;&|\n]{0,200}?\s-\s*<<-?\s*['"]?(\w+)(?!\w)['"]?[^\n]*\n`, 'gi');
  return (text) => {
    for (const m of text.matchAll(evalRe)) {
      if (needle.test(readInlineArg(text.slice(m.index + m[0].length)))) return true;
    }
    for (const m of text.matchAll(stdinRe)) {
      if (needle.test(readHeredoc(text.slice(m.index + m[0].length), m[1]))) return true;
    }
    return false;
  };
}

// Cada regla: [descripción para el mensaje, expresión regular].
const COMMAND_RULES = [
  ['git push forzado (--force / -f / --force-with-lease / +rama)',
    /\bgit\b[^;&|\n]{0,200}?\bpush\b[^;&|\n]{0,300}?(--force\b|--force-with-lease\b|\s-[a-z]*f[a-z]*\b|\s\+\S)/i],
  ['borrado recursivo forzado (rm -rf)',
    /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*|-[a-z]*r[a-z]*\s+-[a-z]*f[a-z]*|-[a-z]*f[a-z]*\s+-[a-z]*r[a-z]*|--recursive\s+--force|--force\s+--recursive)\b/i],
  ['borrado recursivo forzado (Remove-Item -Recurse -Force)',
    new RegExp(String.raw`\b(remove-item|rm|ri|del|erase|rmdir|rd)\b(?=[^;&|\n]{0,300}?\s${PS_RECURSE})(?=[^;&|\n]{0,300}?\s${PS_FORCE})`, 'i')],
  ['impresión de variables de entorno (printenv)', /\bprintenv\b/i],
  ['impresión de variables de entorno (env)', new RegExp(`${SEP}env${END}`, 'im')],
  ['impresión de variables de entorno (export / export -p / declare -x)',
    new RegExp(String.raw`${SEP}export${END}|\bexport\s+-p\b|\bdeclare\s+-[a-z]*[xp]`, 'im')],
  ['impresión de variables de entorno (set)', new RegExp(`${SEP}set${END}`, 'im')],
  ['lectura de /proc/*/environ', /\/proc\/[^\s/]+\/environ/i],
  ['listado de variables de entorno (env: de PowerShell)',
    /\b(get-childitem|gci|ls|dir|get-item|gi|get-content|gc|cat|type)\s+(-path\s+|-literalpath\s+)?['"]?env:/i],
  ['lectura de variables de entorno ([Environment]::GetEnvironmentVariable)',
    /\[(system\.)?environment\]::getenvironmentvariables?\b/i],
  // $env:NOMBRE solo se permite como asignación ($env:CLAUDE_BIN = '...').
  ['lectura de una variable de entorno ($env:NOMBRE)',
    /\$(?:\{env:[a-z_]\w*\}|env:[a-z_]\w*\b)(?!\s*=(?!=))/i],
  // En cmd solo cuenta %NOMBRE% junto a echo (así `git log --format=%H%n` dentro de cmd pasa).
  ['impresión de una variable de entorno de cmd (echo %NOMBRE%)',
    /\bcmd(\.exe)?\b[^\n]{0,300}?\becho\b[^&|\n]{0,300}?%[a-z_]\w*%/i],
  // Solo bash (echo/printf con $MAYÚSCULAS, sin bandera i a propósito). En PowerShell las
  // variables de entorno se leen con $env:, que ya cubre la regla de arriba.
  ['impresión de una variable de entorno (echo/printf con $NOMBRE)',
    /\b(echo|printf)\b[^;&|\n]{0,300}?\$\{?[A-Z_][A-Z0-9_]*\b/],
  ['impresión de process.env desde node -e/-p o node -',
    // -e, -p y juntas (-pe); --eval/--print con espacio o con =.
    inlineCode('node', '-[a-z]*[ep]|--eval|--print', /process\.env/i)],
  ['impresión de os.environ desde python -c o python -',
    inlineCode('py(?:thon)?3?', '-[a-z]*c', /\bos\.(?:environ|getenv)\b/i)],
];

// Cualquier mención de un archivo .env* (salvo .env.example), con el verbo que sea:
// cat, diff, cp, node -p "readFileSync('.env')", [IO.File]::ReadAllText(".env"), --env-file=.env…
const ENV_TOKEN = /(?:^|[\s'"`/\\=(,:;<>])(\.env[\w.-]*)/gi;

// Más largo que esto no se revisa: se rechaza (falla cerrado) para que ningún comando
// armado pueda tardar más que el timeout del hook.
const MAX_COMMAND = 8192;

function checkCommand(cmd) {
  if (cmd.length > MAX_COMMAND) {
    return `un comando de ${cmd.length} caracteres (máximo ${MAX_COMMAND} para poder revisarlo); ` +
      'pártelo o pon el contenido largo en un archivo';
  }
  const text = stripCommitMessage(cmd);
  // Primero lo barato: menciones de .env y luego las reglas, en orden (node/python al final).
  for (const m of text.matchAll(ENV_TOKEN)) {
    if (m[1].toLowerCase() !== ALLOWED_ENV_FILE) return `acceso a ${m[1]} desde la terminal`;
  }
  for (const [label, rule] of COMMAND_RULES) {
    if (typeof rule === 'function' ? rule(text) : rule.test(text)) return label;
  }
  return null;
}

function block(msg) {
  process.stderr.write(`Bloqueado por wa-kit/hooks/guardia.js: ${msg}\n`);
  process.exit(2);
}

async function main() {
  process.stdin.setEncoding('utf8');
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    // PowerShell 5.1 antepone un BOM al pasar texto por stdin.
    input = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    process.exit(0);
  }
  const tool = input?.tool_name;
  const ti = input?.tool_input ?? {};

  if (FILE_TOOLS.has(tool)) {
    const target = ti.file_path ?? ti.notebook_path ?? ti.path;
    if (isSecretEnvFile(target)) {
      block(`${tool} sobre "${target}". Los archivos .env tienen secretos y no se leen ni se editan; ` +
        'documenta las variables en .env.example.');
    }
    if (tool === 'Grep' && typeof ti.glob === 'string' && globTouchesEnv(ti.glob)) {
      block(`Grep con glob "${ti.glob}" sobre archivos .env. Los .env tienen secretos.`);
    }
  }

  if (SHELL_TOOLS.has(tool) && typeof ti.command === 'string') {
    const hit = checkCommand(ti.command);
    if (hit) {
      block(`${tool} con ${hit}. Comando rechazado: ${ti.command.slice(0, 200)}\n` +
        'Si de verdad hace falta, pídele al usuario que lo corra él.');
    }
  }
  process.exit(0);
}

await main();
