---
description: Construye una feature end-to-end con el equipo (arquitecto → backend/frontend → revisor)
argument-hint: [descripción de la feature]
---
Feature: $ARGUMENTS

1. Usa el subagente `wa-kit:arquitecto` para definir el contrato de API y los cambios de modelo en
   `docs/decisiones/api.md` y su ADR. Muéstramelo y ESPERA mi OK.
2. En paralelo: `wa-kit:backend` implementa la API y `wa-kit:frontend` la UI contra el contrato. Si la
   feature solo toca una capa, usa solo ese subagente.
3. Usa el subagente `wa-kit:revisor` sobre el diff. Corrige todo lo BLOQUEANTE e IMPORTANTE (o pídeme
   que lo acepte explícitamente) y vuelve a pasar el revisor sobre las correcciones.
4. Corre las pruebas y la app según `CLAUDE.md`, prueba el flujo, actualiza `docs/PENDIENTES.md` y
   `docs/SUPUESTOS.md`, y muéstrame el resumen. Haz el commit convencional solo cuando yo lo confirme;
   nunca hagas push.
