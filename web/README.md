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
incluso los que todavía no se han mostrado.

La tabla muestra 25 perfiles iniciales y añade otros 25 al acercarse al final.
El botón «Cargar más perfiles» permite hacerlo manualmente; se puede desactivar
«Carga automática» para llegar al footer sin cargar el resto del ranking.
Buscar, cambiar de métrica, ciudad u orden reinicia el bloque visible. Todos
los datos se descargan una sola vez desde el JSON local del sitio; el scroll
añade filas al documento, sin consultas a GitHub.

La bandera ASCII se dibuja únicamente en el footer, en rojo y blanco. Su loop
silencioso dura cuatro segundos y se suspende fuera de pantalla o cuando la
pestaña está oculta. Tiene un botón para pausar/reanudar y empieza estática si
el sistema solicita movimiento reducido.

La acción diaria externa vuelve a crear el mapa original. Por eso el workflow
ejecuta el generador después y guarda la vista y sus datos con el mismo acceso
Git ya configurado por `actions/checkout` (`CUSTOM_TOKEN`). No hace falta un
nuevo secreto. La ejecución remota del workflow debe verificarse tras fusionar.

El collage decorativo `docs/assets/peru-collage.webp` fue generado con IA para
este proyecto; no es una colección de fotografías de stock. Se sirve localmente
y se muestra sobre una base oscura para que el texto claro tenga contraste,
sin transmitir información esencial.

Validación local: `node --check docs/javascript/ranking.js`,
`node --check docs/javascript/footer-flag.js` y
`python3 scripts/test-site.py` (requiere Python Playwright y Chromium; se puede
seleccionar otro ejecutable con `CHROMIUM_PATH`). El test inicia su propio
servidor temporal y verifica la versión servida bajo una subruta de Pages.

## Indexación y navegación estática

El generador construye HTML con los datos incluidos, sin depender de JavaScript.
La portada contiene el ranking público; `/seguidores/` y `/totales/` ofrecen
las otras métricas. Cada bloque de 25 tiene una URL real y enlaces anterior/
siguiente, con canonical propio. La primera página pública es únicamente la
portada; las siguientes están en `/publicas/pagina/2/`, etc. Las rutas abren
directamente en GitHub Pages, sin fallback SPA. JavaScript conserva el bloque
inicial de una página interna y añade los siguientes; buscar, filtrar o cambiar
métrica reinicia el feed. No se generan URLs para combinaciones de filtros.

`web/metodologia.html` documenta el alcance de los datos. Los archivos de
`docs/publicas/`, `docs/totales/`, `docs/seguidores/`, `docs/metodologia/`,
`docs/index.html`, `docs/sitemap.xml` y `docs/.generated-pages.json` se generan;
no los edites a mano. El manifiesto permite retirar solo páginas antiguas del
generador cuando disminuye el número de perfiles. `.nojekyll` mantiene la
publicación como archivos estáticos.

El sitemap contiene solo URLs de
`https://yamilayma.github.io/top-github-users-peru/`. No se genera robots.txt ni
se cambia el sitemap o la configuración del blog de la raíz del dominio.
Se omite lastmod para no sustituir una fecha real por una fecha de compilación.
Para indexación, el propietario puede verificar la propiedad de prefijo URL
anterior en Search Console y enviar `sitemap.xml` dentro de esa propiedad. La
verificación debe guardarse en la plantilla (si usa meta) o en un archivo propio
de docs (si usa archivo), sin incluir secretos. El generador conserva archivos
ajenos a su manifiesto. En Bing Webmaster Tools se puede registrar la misma
web según los métodos admitidos por ese servicio. Esto solicita descubrimiento;
no garantiza indexación ni posiciones.

Validación adicional: `python3 scripts/test-seo.py`. Revisa todas las páginas,
el sitemap, canonical, títulos, datos, enlaces y recursos; navega sin JavaScript
y comprueba el feed interactivo desde una URL interna. Las pruebas son locales;
la comprobación de producción, robots raíz y Search Console es independiente.
