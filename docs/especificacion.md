# Especificación · Catálogo de tableros UFLO (fase 1)

## Objetivo

Reducir a minutos el tiempo de documentar un tablero de Looker Studio: la persona captura y pega, el modelo completa, la persona valida. Cada ficha validada es insumo del diccionario de datos y de las tablas maestras del programa de gobernanza.

## Usuarios

- **Analista de datos** (usuario principal): captura, revisa y valida.
- **Dueños de tableros** (Secretaría Académica, Admisión, Contaduría…): validan la ficha de su tablero.
- **Consumidores**: cualquiera que necesite saber qué mide un tablero y de dónde salen sus datos.

## Alcance

**Incluye:** carga de capturas por sección, análisis con Gemini, fusión sin pisar lo manual, edición de la ficha, estado borrador o validado, exportación a Markdown, almacenamiento en Sheets y Drive.

**No incluye todavía (fase 2):** BigQuery, linaje automático desde `INFORMATION_SCHEMA.JOBS`, inventario automático de informes con la API de Looker Studio, permisos por área.

## Modelo de datos (Sheets)

Todas las columnas en formato texto. `tablero_id` = `tb-` + 8 caracteres de un UUID.

| Pestaña | Columnas | Clave de fila para fusionar |
|---|---|---|
| Tableros | tablero_id, nombre, area, dueno, usuarios (separados por `; `), frecuencia, link, estado (`borrador` o `validado`), objetivo, carpeta_id, creado, actualizado, editado_por | tablero_id |
| Fuentes | tablero_id, nombre, tipo, detalle | nombre |
| Joins | tablero_id, combinacion, izquierda, tipo, derecha, claves | combinacion + izquierda + derecha |
| Filtros | tablero_id, nombre, control, campo, valores | nombre + campo |
| Graficos | tablero_id, pagina, titulo, tipo, metrica, dimension, definicion | pagina + titulo |
| Calculados | tablero_id, nombre, formula, descripcion | nombre |
| Campos | tablero_id, nombre, tipo, descripcion | nombre |
| Dudas | tablero_id, pregunta | texto exacto |
| Capturas | captura_id (id del archivo en Drive), tablero_id, seccion, nombre, analizada (`TRUE`/`FALSE`), subida, analizada_en, error | captura_id |

Las claves comparan sin mayúsculas y sin espacios al borde.

## Valores con opciones cerradas

| Campo | Opciones |
|---|---|
| graficos.tipo | Scorecard, Barras, Columnas, Líneas, Serie temporal, Tabla, Tabla dinámica, Torta / anillo, Mapa, Dispersión, Medidor, Otro |
| filtros.control | Lista desplegable, Rango de fechas, Casilla, Búsqueda, Control deslizante, Botón, Parámetro, Otro |
| fuentes.tipo | BigQuery, Google Sheets, SQL Server, CSV / archivo, Combinación, Otra |
| joins.tipo | Interno (inner), Externo izquierdo (left), Externo derecho (right), Externo completo (full), Cruzado (cross) |
| frecuencia | En tiempo real, Diaria, Semanal, Mensual, Por cuatrimestre, Anual, Manual |

Si el modelo devuelve otra cosa, `opcionCercana_` la lleva a la opción más parecida; si no encuentra ninguna, conserva el texto y la interfaz lo muestra como opción adicional.

## Pedido al modelo

- **Partes del pedido:** instrucciones (`instrucciones_` en `Gemini.gs`), y por cada captura una etiqueta `Imagen N · sección: X` seguida de la imagen.
- **Formato:** `responseMimeType: application/json` con `responseSchema` (`esquemaRespuesta_`). `temperature: 0.1`.
- **Contexto:** se le pasa lo ya cargado (títulos de gráficos, filtros, fuentes, calculados) para que no lo repita.
- **Restricciones:** describir solo lo visible; lo dudoso va a `preguntas`; no transcribir resultados numéricos, nombres de personas, DNI ni correos.

## Reglas de fusión (`fusionar_`)

1. `nombre`, `objetivo`, `frecuencia`: se completan solo si están vacíos (o si el nombre es "Tablero sin nombre").
2. Listas: si la clave de la fila ya existe, se completan solo sus celdas vacías; si no existe, se agrega la fila.
3. Preguntas: se agregan las que no estén.
4. Nunca se borra ni se reemplaza un valor existente.

## Criterios de aceptación

1. Pegar una captura con ⌘V sin tablero abierto crea un tablero y sube la captura a la bandeja activa.
2. Con "Analizar al pegar" activo, el análisis arranca solo y la ficha se completa sin recargar.
3. Una métrica escrita a mano no cambia después de reanalizar.
4. Una captura de la ventana "Combinar datos" con tres uniones produce tres filas en Joins y las tablas participantes en Fuentes.
5. Una captura de la lista de campos produce las filas de Campos y los calculados con su fórmula literal.
6. Si el modelo falla, la captura queda con punto rojo y el motivo, y el resto de la ficha no se pierde.
7. Recargar la página muestra exactamente lo guardado.
8. La exportación genera un `.md` legible con todos los tableros.

## Seguridad y privacidad

- La aplicación corre como quien la despliega y solo la abren cuentas de UFLO.
- Capturas y datos quedan en el Drive de quien despliega; conviene usar una unidad compartida del área de datos.
- Con Vertex AI, el procesamiento queda bajo el contrato de Google Cloud de la universidad.
