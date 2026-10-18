# Histórico del ranking de GitHub Perú

Almacenamiento público y compacto; esta primera etapa no añade una gráfica.
Los archivos viven directamente en `docs/history/`, bajo la subruta de Pages,
sin una segunda copia de datos en la raíz del repositorio.

## Retención

- `daily/YYYY-MM.json`: una captura por fecha dentro de una ventana de **90 días
  calendario**, incluyendo el día del mantenimiento. Los días sin datos no se
  rellenan y no amplían la ventana. Si hay un refresco posterior en el mismo
  día, reemplaza esa captura; no crea otra fila del mismo día.
- `monthly/YYYY.json`: última captura disponible de cada mes, conservada sin
  vencimiento. Es un punto de referencia, no una suma ni un promedio mensual.
- `yearly/YYYY.json`: última captura disponible de cada año, conservada sin
  vencimiento. Tampoco es una suma ni un promedio anual.
- `index.json`: versión del formato, columnas, enlaces, periodos, tamaños,
  ventana diaria y última observación disponible.

La zona horaria de fechas, meses y años es **America/Lima**. La ventana avanza
con la fecha del mantenimiento: entra un día nuevo y sale el que queda fuera
por detrás. La limpieza se ejecuta incluso si el script no acepta una captura
nueva. Un fallo que impida ejecutar el job se recupera en el siguiente
mantenimiento; `daily_window.through` indica hasta qué fecha se mantuvo.

Los cierres del mes y año actuales se actualizan con la última observación
aceptada. El índice marca `closed: false` mientras el periodo siga abierto y
`closed: true` cuando haya terminado. Un periodo cerrado significa que pasó su
límite calendario, **no** que exista una captura exactamente el último día ni
que se hayan obtenido datos todos los días. Siempre se publica la fecha real
de la última captura disponible. Los meses y años sin ninguna observación no
se inventan.

## Formato versión 1

Cada archivo tiene `version`, `columns` y `snapshots`. Las columnas, en orden:

```json
["login", "publicContributions", "privateContributions", "followers"]
```

Cada captura incluye:

- `date`: fecha del commit de origen, convertida a hora de Perú.
- `source_updated_at`: fecha y hora UTC de ese commit, no la hora de una API.
- `source_commit`: SHA completo del commit que modificó la caché.
- `cache_sha256`: checksum de los bytes del archivo de caché registrado en Git.
- `users`: filas compactas de cuatro elementos, ordenadas por login sin
  distinguir mayúsculas. No se guardan nombres, fotos, empresas ni ubicaciones.

Las contribuciones totales se reconstruyen sumando públicas y privadas
reportadas. Las posiciones se reconstruyen ordenando cada métrica de mayor a
menor y usando logins en minúsculas para desempatar el orden visual; los valores
iguales comparten posición (1, 1, 3). No se almacena una segunda copia de las
posiciones. Un usuario ausente en una fecha significa **sin datos**, no cero.

Este formato permite reconstruir el ranking nacional. No se debe utilizar la
ciudad actual de un usuario para atribuirle una ubicación histórica. Tampoco
puede resolver un renombre real de usuario sin un identificador estable; las
variaciones de mayúsculas se comparan con el mismo login normalizado.

## Origen y frescura

El workflow registra su HEAD antes del actualizador externo. La captura exige:

1. Un commit que cambie la caché después de ese checkpoint y sea descendiente
   suyo, con fecha no mayor a 24 horas antes de la ejecución.
2. Que los bytes de `cache/peru.json` coincidan con la versión registrada en Git.
3. Datos no vacíos, logins únicos y cifras enteras no negativas.

La fecha de un commit de frontend/README y el código de salida de la acción
externa no son prueba suficiente de refresco. El mecanismo funciona con el
checkout superficial del workflow; evita asumir que el commit de su límite es
la última actualización real de la caché. No requiere descargar el historial
Git completo ni nuevas credenciales.

Si no existe evidencia de cambio de caché, el script imprime `SKIPPED capture`
y solo mantiene la retención. Esto también puede omitir una consulta exitosa
que devolvió exactamente los mismos bytes: elegimos dejar un hueco antes que
atribuir una frescura que la acción externa no confirma explícitamente.

Son capturas de la **caché publicada en Git**. No se certifica que cada consulta
individual de la API del actualizador terminara correctamente. La fecha del
commit tampoco equivale necesariamente a la consulta de todos los perfiles.
Cambios de cobertura, ubicaciones y criterios de la fuente pueden modificar
posiciones. Las diferencias de contribuciones no se deben presentar como
“contribuciones hechas hoy”: la consulta puede usar una ventana móvil.

## Uso

Desde la raíz del repositorio:

```sh
# Solo al inicializar: conserva la fecha original de la caché existente.
python3 scripts/capture-history.py --seed

# El workflow registra esta variable ANTES de ejecutar su actualizador.
HISTORY_REFRESH_BASE=$(git rev-parse HEAD)
# ... ejecutar el refresco existente ...
python3 scripts/capture-history.py --refresh-base "$HISTORY_REFRESH_BASE"

# Mantener la ventana sin registrar una observación.
python3 scripts/capture-history.py --prune-only

# Pruebas locales, sin servicios ni paquetes adicionales.
python3 scripts/test-history.py
```

`--seed` solo acepta un histórico vacío o la repetición de la misma semilla.
No es un comando para reconstruir commits antiguos ni para marcar datos viejos
como actuales. La primera captura de este histórico procede del commit
`ca669ff2629fdb3f9b4025956456b7391472d0cf`, del 17 de octubre de 2026 a las
02:14:47 UTC: corresponde al **16 de octubre de 2026 en Perú**.

El workflow serializa ejecuciones del actualizador, corre las pruebas y guarda
el histórico junto con el resto de `docs/`. Los errores de esquema detienen
la captura. Los archivos se reemplazan atómicamente y el generador del sitio
conserva este directorio. No edites las capturas manualmente ni cambies sus
columnas sin migrar la versión del formato.

## Tamaño y Git

La primera captura de 964 perfiles ocupa 23.609 bytes sin comprimir; cada
contenedor añade poco más de 100 bytes de formato. Aproximadamente, al mismo
número de perfiles:

- 90 capturas diarias: 2,1 MB.
- 12 cierres mensuales adicionales: 0,28 MB por año.
- Cada cierre anual adicional: 0,024 MB por año.

Son estimaciones del tamaño de los JSON activos, no del pack de Git ni del
crecimiento futuro de la comunidad. Los datos se serializan sin nombres de
campo por usuario y con una captura por línea para favorecer diffs pequeños.

La retención elimina capturas del árbol actual, **no** sus versiones anteriores
en Git. El repositorio ya contiene un historial considerable; esta función no
lo reescribe. Los datos históricos mantienen la atribución y licencia ODbL de
la caché original: consulta la [metodología](../metodologia/) y el repositorio
original de [Gayan Kuruppu](https://github.com/gayanvoice/top-github-users).

## Ubicaciones históricas y vistas derivadas

Las nuevas capturas pueden incluir `city_membership`: un diccionario de código
de ciudad a índices (base cero) en `users`, ordenados y sin duplicados. Se
reconocen con las mismas reglas del ranking y la configuración del commit
fuente. Un arreglo vacío significa ninguna coincidencia; un campo/ciudad
ausente significa cobertura desconocida. Las observaciones anteriores se
conservan sin atribuirles la ubicación actual de los perfiles. La versión 1
sigue siendo compatible con capturas sin este campo opcional.

El build genera `docs/data/evolution-summary.json` y tres archivos
`trends-*.json` con valores registrados y posiciones nacionales separados para las métricas de la tabla. Son
productos derivados regenerables, no capturas adicionales. Conservan fechas
reales, ausencias y empates (1, 1, 3). Los resúmenes separan cambios de contadores
en perfiles presentes en ambas fechas de entradas/salidas de la selección.
Una comparación de contadores no mide actividad diaria: puede ser negativa.
