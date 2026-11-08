---
description: Auditoría de seguridad y reglas de oro en 15 chequeos, con veredicto PASA / FALLA / PARCIAL / NO APLICA por chequeo y un veredicto global
argument-hint: [números de chequeo, p. ej. 4 6 9; vacío = los 15]
---
Chequeos a correr: $ARGUMENTS (si está vacío, los 15).

Eres un auditor: **no edites, no crees ni borres archivos, no hagas commits** y no levantes el server.
No leas `.env` ni ningún `.env*` salvo `.env.example`, y no imprimas variables de entorno: para saber si
algo está ignorado o versionado usa listados de git y `.gitignore`, nunca el contenido. Usa
Grep/Glob/Read y comandos de solo lectura (`git`, `npm audit`, `node --check`). El hook `guardia.js` de
wa-kit bloquea cualquier comando que mencione un `.env*` (salvo `.env.example`), aunque solo mire
metadatos: por eso los chequeos 1 y 2 trabajan con listados completos (`git ls-files`,
`git status --ignored`) y con la lectura de `.gitignore`, sin escribir `.env` en el comando. Si el hook
bloquea algo, no busques cómo saltártelo (tampoco armando el nombre con llaves, variables o comodines):
califica el chequeo como PARCIAL y anota qué no se pudo verificar.

Antes de empezar, lee `CLAUDE.md`: de ahí salen la estructura del proyecto (carpetas del servidor y del
cliente), su validador de entradas, su punto único de salida si lo tiene, y sus reglas de oro.

## Cómo calificar
- **PASA**: hay evidencia concreta (archivo:línea o salida de un comando) de que se cumple por completo.
- **PARCIAL**: se cumple en parte, no se pudo verificar todo, o algo que el proyecto necesita todavía no
  existe.
- **FALLA**: hay evidencia de que no se cumple.
- **NO APLICA**: el proyecto no tiene eso (p. ej. no usa un LLM o no recibe webhooks), con la evidencia
  de por qué. No cuenta para el veredicto global.
- Ante la duda, PARCIAL. Nunca PASA sin evidencia. **PARCIAL bloquea igual que FALLA.**

## Los 15 chequeos

1. **Secretos fuera del repo.** En la salida de `git ls-files` no hay ningún archivo cuyo nombre empiece
   por `.env` salvo `.env.example`; en el historial tampoco (revisa la salida de
   `git log --all --name-only --format= | sort -u`); y `git grep -nI -e '<patrón>'` (un `-e` por patrón,
   porque algunos empiezan con guiones) en los archivos versionados no encuentra claves:
   `AIza[0-9A-Za-z_-]{20,}`, `sk-ant-`, `sk-[A-Za-z0-9]{20,}`, `EAA[A-Za-z0-9]{20,}` (tokens de Meta),
   `gh[pousr]_[A-Za-z0-9]{30,}`, `AKIA[0-9A-Z]{16}`, `xox[baprs]-`,
   `mongodb(\+srv)?://[^/\s:]+:[^@\s]+@`, `postgres(ql)?://[^/\s:]+:[^@\s]+@`,
   `-----BEGIN [A-Z ]*PRIVATE KEY-----`. Un ejemplo vacío o con marcador (`tu-clave`, `xxx`) no cuenta.
   Si un archivo del propio repo cita estos patrones (documentación de auditoría), exclúyelo y dilo.
2. **`.env` en `.gitignore`.** Lee `.gitignore` (y los de las subcarpetas si existen) y decide si sus
   patrones ignoran `.env`, `.env.local`, `.env.production` y los `.env` de cada subproyecto sin ignorar
   `.env.example`. Confírmalo con los archivos que existen en la salida de
   `git status --ignored --porcelain` (deben salir con `!!`). Si solo cubre algunos → PARCIAL.
3. **`.env.example` completo y sin valores reales.** Toda variable leída en el código (`process.env.X`,
   `import.meta.env.VITE_X`, `os.environ[...]`, etc.) aparece en `.env.example`, y ninguna línea trae un
   valor que parezca real (claves, URIs con usuario y contraseña).
4. **Punto único de salida.** Si `CLAUDE.md` declara un único módulo para enviar mensajes, cobrar o
   llamar a un servicio externo, comprueba que nadie más importe los clientes o canales de ese servicio
   ni llame a su API directamente. Lista cada import con archivo:línea. Sin una regla así → NO APLICA.
5. **El punto de salida bloquea lo que debe.** Para ese módulo, cada condición de bloqueo que pida
   `CLAUDE.md` (pausas, ventanas de tiempo, contactos bloqueados, aprobaciones) está en el código. Cita
   la línea de cada una; si falta una → PARCIAL. Sin punto de salida → NO APLICA.
6. **Webhooks con firma verificada.** Cada endpoint que recibe webhooks de terceros (WhatsApp, Stripe,
   GitHub…) valida la firma con HMAC sobre el cuerpo **crudo**, con el secreto en una variable de
   entorno, compara con una función de tiempo constante (`crypto.timingSafeEqual` o equivalente) y
   rechaza (401/403) si no coincide; los handshakes de verificación validan su token. Si hay webhooks
   previstos y no implementados → PARCIAL. Sin webhooks → NO APLICA.
7. **Validación de todas las entradas externas.** Cada handler HTTP que lee body, query o params lo pasa
   por un esquema del validador del proyecto (zod, joi, pydantic…) antes de usarlo, incluidos webhooks y
   rutas de desarrollo. Lista los handlers sin validar.
8. **Salidas del LLM validadas.** Lo que devuelve el modelo pasa por un esquema antes de usarse (crear
   registros, enviar, decidir). Sin LLM → NO APLICA.
9. **Logs sin datos personales.** Ningún log imprime teléfonos, correos, documentos de identidad u
   objetos completos de usuario o mensaje; si hace falta identificar, va enmascarado.
10. **Logs sin secretos ni cuerpos completos.** Ningún log imprime `process.env`, claves, el header
    `Authorization`, el cuerpo completo de un webhook ni un prompt completo con datos de usuarios.
11. **Errores sin detalles internos.** El manejador de errores no devuelve `stack` ni mensajes internos al
    cliente (al menos en producción); los errores de validación devuelven solo ruta del campo y mensaje.
12. **Hooks de wa-kit activos.** Con `/hooks` o la configuración del plugin, `guardia.js` (PreToolUse),
    `lint.js` (PostToolUse) y `pendientes.js` (Stop) están registrados; y guardia está vivo en esta
    sesión: intenta un Read de `.env.auditoria` en la raíz (no existe, así que no hay nada que filtrar) y
    la respuesta debe ser "Bloqueado por wa-kit/hooks/guardia.js". Si responde que el archivo no existe,
    el hook no está activo → FALLA.
13. **Permisos `deny`.** `.claude/settings.json` del proyecto niega `Read`/`Edit` de `.env` y
    `.env.local` y `git push` en Bash y PowerShell (el bloque está en el README de wa-kit).
14. **Rutas y scripts de prueba fuera de producción.** Simuladores, seeds y rutas de desarrollo solo se
    montan o corren fuera de producción, y los scripts que borran datos se niegan a correr contra una base
    que no sea local. Cita la guardia de cada uno.
15. **Dependencias sin vulnerabilidades altas o críticas.** `npm audit --omit=dev --json` (o la
    herramienta del ecosistema) reporta 0 `high` y 0 `critical`. Con `moderate`/`low` → PASA, pero
    nómbralas. Si no puede correr (sin red) → PARCIAL.

## Entrega
Una tabla con una fila por chequeo corrido:

| # | Chequeo | Veredicto | Evidencia (archivo:línea o comando) | Qué falta |

Después, el **veredicto global**:
- **PASA** solo si todos los chequeos corridos dieron PASA o NO APLICA.
- **FALLA** en cualquier otro caso (un PARCIAL basta). Lista los chequeos que bloquean, con su número.
- Si se corrió un subconjunto, dilo: el global vale solo para esos chequeos.

Termina con los arreglos propuestos para cada FALLA o PARCIAL, en orden de riesgo, indicando si ya hay un
pendiente en `docs/PENDIENTES.md` (si el proyecto lo usa) o si haría falta uno nuevo. No los apliques:
espera mi OK.
