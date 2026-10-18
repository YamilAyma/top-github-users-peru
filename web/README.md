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
de las tarjetas representan el ámbito de ciudad elegido; la búsqueda afecta la tabla
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

## Ciudades y datos estructurados

Se publican selecciones de las ciudades configuradas con al menos diez perfiles (actualmente Lima, Arequipa, Trujillo, Chiclayo y Cusco) en `/ciudades/<ciudad>/`, con páginas de 25 perfiles y canonical propio. Solo se
genera una selección si cuenta con al menos diez perfiles; el manifiesto retira
las páginas antiguas si deja de alcanzar ese mínimo. El contenido explica la
coincidencia de ubicación y sus límites. Las tarjetas muestran cifras de esa
selección, mientras la columna de puestos mantiene el ranking nacional.

En las páginas de ciudad, el selector queda fijado a la ubicación de la ruta.
La búsqueda, el cambio de métrica, el CSV y el scroll siguen funcionando dentro
de esa selección. Los enlaces permiten regresar al ranking nacional. No se
crean páginas para todas las combinaciones de filtros.

El JSON-LD describe WebSite, CollectionPage e ItemList, además de las rutas
BreadcrumbList visibles. La metodología usa WebPage. Las listas describen los
perfiles efectivamente incluidos en el HTML de esa página, con posiciones de
lista consecutivas; el puesto nacional de la tabla es un dato diferente.
Se utiliza Thing para los perfiles, sin deducir identidad personal ni añadir
valoraciones, premios o afiliaciones. El marcado no garantiza rich results.

Para reducir cambios de diseño, HTML y JavaScript utilizan exactamente el mismo
formato de fecha. El fondo del hero se precarga con prioridad alta y el JSON
interactivo se solicita con prioridad baja; el ranking estático ya está visible.
Las mediciones Lighthouse son de laboratorio local, con red/CPU móvil simulada
y avatares externos bloqueados de forma idéntica antes y después. No sustituyen
los datos de campo ni verifican indexación. El fondo sigue requiriendo medir su
carga en la publicación real.

Los enlaces a CSS y JavaScript llevan un parámetro de versión calculado con el
hash de su contenido. El generador lo renueva al cambiar esos archivos, para
que HTML recién publicado no se combine con recursos anteriores de la caché.
Los hashes son estables si los archivos no cambian.

## Entrega del fondo y carga inicial

El hero usa picture con AVIF y alternativa WebP. Móvil (hasta 800 px) recibe una
versión de 960 × 540; escritorio conserva 1672 × 941. Se mantiene el encuadre,
la opacidad y el collage original. El original `peru-collage.webp` queda como
fuente y para compartir enlaces; la página no lo descarga como fondo.

Las precargas AVIF tienen media queries y se declaran después de la etiqueta
viewport para no descargar ambas variantes en móvil. Las imágenes, CSS y scripts
se enlazan con hash de contenido. El ranking estático ya es utilizable; la carga
del JSON interactivo espera a que se decodifique/pinte el hero, con un límite de
un segundo para no bloquear las funciones si la imagen se demora o falla.

Los derivados están versionados en Git y no requieren procesamiento en CI ni en
el navegador. Para regenerarlos al editar el original, ejecutar
`python3 scripts/optimize-images.py` con Pillow y soporte AVIF, y después
`python3 scripts/build-site.py`. Esta herramienta de autoría es opcional; el
build habitual sigue usando solo la biblioteca estándar de Python.

El build mantiene un enlace destacado al sitio de Perú y su metodología en el
README principal, y hace que el enlace del banner apunte a esta web. El bloque
es idempotente y se repone después de la regeneración del README por la acción
externa, conservando las atribuciones. El workflow guarda también ese archivo.

## Histórico (almacenamiento)

El histórico compacto vive en `docs/history/`, listo para consumo posterior
por la web: detalle diario móvil de 90 días y últimas capturas mensuales/anuales.
El workflow verifica un cambio de caché registrado en Git después de su checkpoint
antes de crear una observación; una ejecución sin cambio confirmado solo aplica
retención. No requiere nuevas dependencias ni secretos. Consulta el formato,
las fechas y sus límites en [docs/history/README.md](../docs/history/README.md).
El build deriva resúmenes, valores y posiciones compactas para la interfaz. Las tablas
muestran minigráficas SVG del valor de la métrica seleccionada,
con una petición diferida y compartida por métrica, solo al acercarse a la tabla.
Se dibujan únicamente las filas visibles del feed; no se descarga el archivo
histórico completo para mostrar estas minigráficas. No hay dependencias de charts.

## Explorador de evolución

`/evolucion/` ofrece selección de ciudad y fechas reales, detalle diario de 7/30/90
días y archivos mensuales/anuales. Compara hasta tres usuarios con una escala
compartida; permite alternar métricas (vista inicial con líneas) y movimientos nacionales (tarjetas sin líneas), consultar el ranking
en una fecha, compartir el estado por URL y descargar una tarjeta SVG del primer
perfil. Los archivos de capturas se solicitan por mes/año según la vista y se
reutilizan en memoria; nunca se consulta GitHub desde el navegador.

La principal y las ciudades enlazan un resumen con gráficas y pulso semanal.
Este último compara la captura más reciente con una real entre 7 y 14 días antes,
indicando ambas fechas y separando perfiles comparables, entradas y salidas.
Las vistas locales no asignan ubicaciones actuales a capturas anteriores.
Sin cobertura local se indica desconocido; no se representa como cero.

Los favoritos persisten solo en `localStorage` bajo `github-peru:favorites:v1`.
No requieren cuenta ni envían información a otro servidor. La tabla conserva
su puesto nacional y añade el local en páginas de ciudad. Las minigráficas abren
el explorador con el perfil y métrica seleccionados.

Pruebas de datos: `python3 scripts/test-history.py` y
`python3 scripts/test-evolution.py` (stdlib, incluidas en CI).
Prueba del explorador: `python3 scripts/test-evolution-browser.py` (Playwright +
Chromium, igual que las pruebas existentes de navegación). Incluye escenarios
sintéticos aislados de 90 días que nunca se escriben en los datos publicados.

## Selector general y lectura de gráficas

El selector al inicio de la página reúne las 34 ciudades configuradas y el
número de perfiles de cada una, incluso cuando es cero. En la vista nacional
actualiza las tres tarjetas, el resumen histórico y la tabla; la selección
se conserva en `?city=...`. En una ruta estática de ciudad queda fijado a esa
ciudad. Sin JavaScript se conservan enlaces a las ciudades con páginas propias.

Las minigráficas distribuyen las capturas disponibles a lo largo de su ancho
y muestran las fechas y el número de observaciones; 90 días es la retención
máxima, no una afirmación de cobertura. Una amplitud mínima del 10 % del valor inicial (como mínimo una unidad) evita exagerar variaciones pequeñas.
No se unen días ausentes. El color gris indica ausencia de cambio entre extremos.

El resumen destaca contribuciones públicas y seguidores. Su línea representa
la variación del contador respecto a la primera captura disponible, con valores
en el eje, fechas de inicio/fin, diferencia y porcentaje; no actividad diaria.
La cantidad de perfiles permanece como indicador de cobertura y declara cuando
no cambia. La página de evolución mantiene además la gráfica de perfiles,
con la misma indicación explícita de estabilidad.

Las líneas de la tabla y la vista inicial del explorador representan valores
reales de públicas, totales (públicas + privadas) o seguidores. La columna
«Puestos» es independiente: fichas antes/ahora con flecha de ascenso/descenso,
igualdad o primera captura. Su enlace abre `view=rank`, que muestra tarjetas
y una lista desplegable de cambios fechados. `view=value` abre las líneas.
La tarjeta SVG descargable respeta la vista elegida. Los archivos derivados
`trends-*.json` usan versión 2 e incluyen `values` y `ranks`; no se cambia el
formato ni el contenido de las capturas originales.
