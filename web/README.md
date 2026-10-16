# GitHub Perú web

Sitio estático, sin dependencias ni claves para navegar. GitHub Pages continúa
sirviendo `docs/`. La plantilla es `web/index.html`; no edites directamente
`docs/index.html`, ya que es una salida generada.

Desde la raíz del repositorio:

```sh
python3 scripts/build-site.py
python3 -m http.server 8000 --directory docs
```

El generador publica una selección de campos de `cache/peru.json` en
`docs/data/peru.json`. La fecha mostrada es la del último commit de la caché,
no la fecha de apertura de la página. No se consulta la API de GitHub desde el
navegador. Las fotos de perfil se cargan desde `avatars.githubusercontent.com`;
si no están disponibles, se muestran iniciales.

La búsqueda ignora mayúsculas y tildes. Los filtros de ciudad buscan nombres
completos en la ubicación declarada (sin geocodificación); una ubicación puede
coincidir con varias ciudades. Las posiciones son nacionales por métrica y
comparten puesto en caso de empate, incluso al filtrar. Totales = públicas +
privadas reportadas; seguidores acumulados no son seguidores únicos. Las cifras
de las tarjetas representan toda la caché; búsqueda y filtros afectan la tabla
y el CSV. El CSV exporta todos los resultados filtrados en el orden visible,
no únicamente la página actual.

La acción diaria externa vuelve a crear el mapa original. Por eso el workflow
ejecuta el generador después y guarda la vista y sus datos con el mismo acceso
Git ya configurado por `actions/checkout` (`CUSTOM_TOKEN`). No hace falta un
nuevo secreto. La ejecución remota del workflow debe verificarse tras fusionar.

El collage decorativo `docs/assets/peru-collage.webp` fue generado con IA para
este proyecto; no es una colección de fotografías de stock. Se sirve localmente
y se muestra con opacidad baja, sin transmitir información esencial.

Validación local: `node --check docs/javascript/ranking.js` y
`python3 scripts/test-site.py` (requiere Python Playwright y Chromium; se puede
seleccionar otro ejecutable con `CHROMIUM_PATH`). El test inicia su propio
servidor temporal y verifica la versión servida bajo una subruta de Pages.
