---
name: flujo-pr-verificado
description: Flujo de trabajo de Git para Yamil con commits atómicos, autoría propia y commits "Verified" en GitHub mediante ramas, subramas y PRs con squash. Úsalo siempre que haya que hacer commits, abrir ramas o PRs, fusionar cambios, o cuando GitHub muestre "Unverified".
---

# Flujo de PRs con commits verificados

## Por qué existe

Los commits que hace el agente se firman con la clave SSH de la plataforma, que GitHub asocia al usuario `claude`.
Si el autor es el usuario real, GitHub no encuentra esa clave en su cuenta y marca **Unverified**.
Un **Squash and merge** hecho desde GitHub crea un commit firmado por GitHub, con la autoría del PR, y sale **Verified**.
Por eso los cambios entran siempre por PR y nunca por push directo a `main`.

## Esquema: rama mayor y subramas

```
main
 └── claude/<tema>                 rama mayor (la fusiona el usuario)
      ├── claude/<tema>--<cambio1>      PR con squash → 1 commit Verified
      └── claude/<tema>--<cambio2>      PR con squash → 1 commit Verified
```

1. Crear la rama mayor desde `main`: `claude/<tema>`.
2. Por cada cambio pequeño, crear una subrama desde la rama mayor: `claude/<tema>--<cambio>`.
   Git no permite `a` y `a/b` a la vez, por eso el separador es `--` y no `/`.
3. Dentro de la subrama, hacer commits atómicos con la autoría del usuario.
4. Abrir un PR de la subrama hacia la rama mayor y fusionarlo con **Squash and merge**.
5. Cuando la rama mayor está lista, abrir un PR hacia `main`. **Lo fusiona el usuario** con **Create a merge commit**.
   Nunca con squash (aplasta los commits ya verificados) ni con rebase (los reescribe sin firma).

## Reglas

- **Una subrama a la vez.** Fusionar la anterior antes de empezar la siguiente, para evitar conflictos
  (sobre todo en archivos generados que cambian en cada cambio).
- **Autoría del usuario.** Configurar `user.name` y `user.email` del repositorio con los datos que el usuario indicó.
  No añadir firmas ni líneas de coautoría de Claude si el usuario pidió evitarlas.
- **Commits atómicos.** Un cambio lógico por commit, con mensaje claro en imperativo.
- **Fusionar subramas solo con el visto bueno del usuario** (puede darlo una vez para todo el tema).
  La fusión final a `main` la hace siempre el usuario.
- **Nunca force-push a `main`** ni reescribir su historia sin confirmación explícita.
- **No dejar archivos temporales en el repo** (`__pycache__`, capturas, scripts de prueba).
  Los scripts y capturas de apoyo van al directorio temporal de la sesión.
- Buscar una plantilla de PR (`.github/pull_request_template.md`) y seguir sus secciones antes de abrir el PR.
- Preguntar antes de fusionar si hay dudas sobre el método; el valor por defecto de las subramas es squash.

## Validación visual

Antes de abrir el PR de un cambio de interfaz, revisarlo en un navegador real:
Playwright (Node) con Chromium ya instalado, servidor local sobre la carpeta publicada, capturas en escritorio
y en móvil, y comprobar que no hay errores de JavaScript ni desplazamiento horizontal.

## Específico de top-github-users-peru

- Los estilos y scripts viven en `docs/css` y `docs/javascript`; las plantillas, en `web/`.
- `scripts/build-site.py` regenera las páginas y los hashes `?v=` de CSS y JS en todos los HTML.
  Ejecutarlo antes de commitear y **meter el resultado en el mismo commit del cambio**, sin commits aparte de hashes.
- Eliminar `scripts/__pycache__` después de ejecutar el build.
- `scripts/test-evolution-browser.py` usa Playwright de Python, que puede no estar instalado; en ese caso validar con Node.
- Preferencias de estilo: respuestas breves y precisas, en español.
