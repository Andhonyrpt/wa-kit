# wa-kit

Plugin de Claude Code con un equipo de desarrollo listo para usar: cuatro subagentes que trabajan con
el flujo **arquitecto → backend/frontend → revisor**, dos comandos y tres hooks de seguridad y calidad.

Las reglas de cada proyecto (convenciones, límites, reglas de oro) no van dentro del plugin: los
subagentes las leen del `CLAUDE.md` del proyecto donde se instala.

## Qué incluye

| Tipo | Nombre | Qué hace |
|------|--------|----------|
| Subagente | `wa-kit:arquitecto` | Diseña contratos de API y cambios de modelo antes de codificar. Escribe el ADR en `docs/decisiones/` y el contrato en `docs/decisiones/api.md`. No edita código. |
| Subagente | `wa-kit:backend` | Implementa en la carpeta del servidor (`server/` por defecto) siguiendo el ADR. |
| Subagente | `wa-kit:frontend` | Implementa la UI en la carpeta del cliente (`client/` por defecto) contra el contrato. |
| Subagente | `wa-kit:revisor` | Revisa el `git diff` sin editar y clasifica hallazgos BLOQUEANTE / IMPORTANTE / MENOR con `archivo:línea`. |
| Comando | `/wa-kit:feature <descripción>` | Construye una feature completa con el equipo y se detiene a pedir tu OK tras el contrato y antes del commit. |
| Comando | `/wa-kit:auditar [números]` | Auditoría de solo lectura en 15 chequeos (secretos, `.gitignore`, `.env.example`, punto único de salida, webhooks, validación, logs, errores, hooks, permisos, dependencias…). Veredicto PASA / FALLA / PARCIAL / NO APLICA por chequeo y uno global; PARCIAL bloquea igual que FALLA. |
| Hook | `guardia.js` (PreToolUse) | Bloquea leer, editar o buscar en archivos `.env*` (salvo `.env.example`), los comandos que los mencionan, `git push --force`, `rm -rf` / `Remove-Item -Recurse -Force` y los que imprimen variables de entorno. Rechaza comandos de más de 8 KB. |
| Hook | `lint.js` (PostToolUse) | Corre ESLint solo sobre el archivo `.js/.jsx/.mjs/.cjs` que Claude acaba de editar; los errores vuelven a Claude. |
| Hook | `pendientes.js` (Stop) | Si hay cambios sin commit y el archivo de pendientes no cambió, le pide a Claude (una vez) que revise si hay algo que anotar. |

`guardia.js` es una red de seguridad, no un control de acceso: la protección real son los permisos
`deny` de abajo y un `.env` local que solo tenga claves de desarrollo.

## Requisitos

- Claude Code con soporte de plugins (`/plugin`).
- Node.js 18 o superior en el `PATH` (los hooks son scripts de Node).
- Git, para `pendientes.js`, el revisor y la auditoría.
- Opcional: ESLint instalado en el proyecto (`node_modules/eslint`) para que `lint.js` haga algo. Sin
  ESLint, el hook no hace nada.

## Instalación

### Desde una carpeta local

En Claude Code, dentro de cualquier proyecto:

```
/plugin marketplace add C:\ruta\a\wa-kit
/plugin install wa-kit@wa-kit
```

La ruta puede ser relativa al proyecto (por ejemplo `../wa-kit`). Reinicia Claude Code si te lo pide.

### Desde GitHub

Sube este repo (por ejemplo a `tu-usuario/wa-kit`) y:

```
/plugin marketplace add tu-usuario/wa-kit
/plugin install wa-kit@wa-kit
```

### Para todo el equipo de un proyecto

Agrega esto al `.claude/settings.json` del proyecto (versionado). Quien abra el proyecto y confíe en la
carpeta recibirá el ofrecimiento de instalar el marketplace y el plugin:

```json
{
  "extraKnownMarketplaces": {
    "wa-kit": {
      "source": { "source": "github", "repo": "tu-usuario/wa-kit" }
    }
  },
  "enabledPlugins": {
    "wa-kit@wa-kit": true
  }
}
```

### Comprobar que quedó instalado

- `/plugin` muestra `wa-kit` como habilitado.
- `/agents` lista `wa-kit:arquitecto`, `wa-kit:backend`, `wa-kit:frontend` y `wa-kit:revisor`.
- `/hooks` muestra los tres hooks.
- Pídele a Claude que lea `.env.prueba` (no tiene que existir): debe responder
  "Bloqueado por wa-kit/hooks/guardia.js".

## Configuración del proyecto

### 1. Permisos `deny` (recomendado)

Un plugin no puede instalar permisos. Copia esto al `.claude/settings.json` del proyecto; el chequeo 13
de `/wa-kit:auditar` lo verifica:

```json
{
  "permissions": {
    "deny": [
      "Read(**/.env)",
      "Read(**/.env.local)",
      "Edit(**/.env)",
      "Edit(**/.env.local)",
      "Bash(git push)",
      "Bash(git push *)",
      "PowerShell(git push)",
      "PowerShell(git push *)"
    ]
  }
}
```

### 2. `CLAUDE.md`

Los subagentes leen `CLAUDE.md` al empezar. Para sacarles provecho, que diga al menos:

- **Estructura:** dónde vive el servidor y dónde el cliente (si no es `server/` y `client/`).
- **Comandos:** cómo se instala, se prueba, se corre el lint y se levanta la app.
- **Convenciones:** lenguaje, estilo, validador de entradas, idioma de textos e identificadores.
- **Reglas de oro y límites:** lo que nunca se puede romper (por ejemplo, "ningún mensaje sale fuera de
  `src/outbox/gate.js`"). El revisor las trata como BLOQUEANTE y `/wa-kit:auditar` las verifica en los
  chequeos 4 y 5.

### 3. Documentos del flujo

El equipo usa estas rutas; el arquitecto crea las que falten:

- `docs/decisiones/ADR-NNN-<slug>.md`: una decisión por archivo.
- `docs/decisiones/api.md`: contrato vivo de API, modelos y contratos internos.
- `docs/SUPUESTOS.md`: todo supuesto que se tomó sin confirmar.
- `docs/PENDIENTES.md`: toda tarea incompleta.

`pendientes.js` solo actúa si existe el archivo de pendientes. Para usar otra ruta, define
`WA_KIT_PENDING_FILE` (relativa a la raíz) en el `settings.json` del proyecto:

```json
{
  "env": { "WA_KIT_PENDING_FILE": "TODO.md" }
}
```

## Uso

```
/wa-kit:feature Agregar exportación de contactos a CSV
/wa-kit:auditar
/wa-kit:auditar 1 2 3
```

También puedes pedir un subagente directamente: "usa wa-kit:revisor sobre el diff".

## Si el proyecto ya tiene estos hooks

Si copiaste antes `guardia.js`, `lint.js` o `pendientes.js` a `.claude/hooks/` y los registraste en
`.claude/settings.json`, quita esos registros al instalar el plugin; si no, cada hook corre dos veces.

## Qué no incluye

Se quedaron fuera las piezas que dependen del código de un proyecto concreto y no funcionarían en otro:
el subagente de QA de conversaciones, el comando `/probar-agente` y la skill para crear agentes
especialistas de WhatsApp (necesitan su orquestador, su registro de agentes y su runner de pruebas). Por
eso esta versión no trae skills.

## Estructura del repo

```
.claude-plugin/
  plugin.json        manifiesto del plugin
  marketplace.json   marketplace de un solo plugin (source: "./")
  icon.png           ícono de 512 × 512 px
agents/              arquitecto, backend, frontend, revisor
commands/            feature, auditar
hooks/
  hooks.json         registro de los hooks (usa ${CLAUDE_PLUGIN_ROOT})
  guardia.js, lint.js, pendientes.js
package.json         solo "type": "module" para los hooks
LICENSE              MIT
```

## Versiones

Sube `version` en `.claude-plugin/plugin.json` y en `.claude-plugin/marketplace.json` en cada cambio;
quienes lo tengan instalado lo actualizan con `/plugin marketplace update wa-kit`.

## Licencia

[MIT](LICENSE).
