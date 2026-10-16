# Revisión de diseño y funcionamiento

final result: passed

## Objetivo visual

Referencia: primera captura adjunta en la conversación (551 × 405 px), usada
**solo como referencia de estilo**, según la instrucción del usuario. Tarjetas
blancas con bordes finos, tabla compacta, identidad de filas con avatar, métricas,
filtros y paginación. La segunda captura muestra el mapa que se sustituye.
No se pretende reproducir los datos, controles de inventario ni dimensiones
exactas de la referencia. El encabezado peruano y las métricas de GitHub son
adaptaciones solicitadas, no desviaciones del diseño.

## Evidencia renderizada

- Escritorio: `/tmp/peru-dashboard-review/desktop.png`, viewport 1440 × 1100 CSS
  px, captura completa 1440 × 1778 px aproximadamente; deviceScaleFactor 1.
- Móvil: `/tmp/peru-dashboard-review/mobile.png`, viewport 390 × 844 CSS px,
  captura completa; deviceScaleFactor 1.
- Estado: ranking público, sin filtros, diez filas. Las capturas usan iniciales
  para comprobar el fallback cuando no se pueden descargar avatares externos.
- Se inspeccionaron ambas capturas completas y sus filas/controles. La fuente
  de estilo tiene otros contenidos y proporciones; no corresponde una
  comparación de píxeles ni afirmar fidelidad 1:1.

## Superficies revisadas

- Tipografía: sans serif del sistema, jerarquía entre título, resumen y tabla;
  nombres largos truncados con texto completo en title y enlaces accesibles.
- Espaciado: tres tarjetas en escritorio, tarjetas apiladas en móvil. La tabla
  conserva columnas con desplazamiento horizontal interno. Controles de
  búsqueda, filtros y paginación dentro del viewport.
- Colores: fondos claros, bordes neutros, acentos rojos para la identidad
  peruana; verde discreto en la métrica activa. Foco visible con teclado.
- Imágenes: collage local generado con IA, opacidad 12% en escritorio y 10%
  en móvil. Avatares reales de la caché y fallback probado. Icono de enlace
  de Bootstrap Icons servido localmente con su licencia MIT.
- Contenido: métricas conectadas a la caché, fecha del commit de datos en hora
  de Perú; se explican alcance del ranking, ubicaciones declaradas y total de
  seguidores no únicos. No se muestran crecimientos ni tendencias inventados.

## Iteraciones

1. [P2 corregido] La primera captura móvil mostró desbordamiento horizontal de
   toda la página debido al caption posicionado fuera del contenedor de tabla.
   Se añadió `position: relative` a `.table-scroll`. Las nuevas capturas y las
   comprobaciones de ancho a 320, 390 y 768 px confirman su corrección.
2. [P2 corregido] El glifo de enlace externo no se renderizaba en Chromium.
   Se sustituyó por el icono local de Bootstrap Icons; capturas posteriores
   confirman su visualización en encabezado, tabla y enlace de criterios.

## Comprobaciones funcionales

`python3 scripts/test-site.py`: búsqueda con tildes/mayúsculas y @usuario,
filtro por ciudad, tres métricas, orden ascendente y descendente, posiciones
nacionales y empates, paginación, tamaño de página, descarga de todos los
resultados filtrados en CSV, enlaces de perfiles, fallback de avatares,
estado vacío, fallo de carga y reintento. Texto de perfiles se inserta con
textContent; fórmulas de CSV se escapan. Sin errores JavaScript.

`node --check docs/javascript/ranking.js`: correcto.
Generación repetida: salidas idénticas. `git diff --check`: correcto.

## Límites y seguimiento

- GitHub Actions y publicación de Pages requieren validación remota después de
  subir/fusionar. No se ejecutó el actualizador externo ni se usaron sus secretos.
- El filtro usa nombres completos en texto libre; no verifica residencia ni
  nacionalidad y puede asociar un perfil a varias ciudades.
- El origen de datos puede incluir ubicaciones imprecisas; no se alteró la caché.
- Refinamiento opcional: escoger fotografías reales con licencia si se prefiere
  reemplazar el collage generado. Los avatares requieren conexión externa.

Checklist: diseño revisado, móvil corregido, interacciones verificadas,
actualización del sitio integrada al workflow y documentación añadida.
