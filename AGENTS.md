# AGENTS.md — Catálogo de tableros UFLO

Instrucciones para cualquier asistente de IA (Gemini, Claude, Copilot, Codex…) que trabaje en este proyecto. Leé este archivo completo antes de tocar código.

## Qué es

Una aplicación web interna de la Universidad de Flores (UFLO) para documentar los tableros de Looker Studio **a partir de capturas de pantalla**. El usuario pega capturas (⌘V) en cuatro bandejas y Gemini completa la ficha del tablero; la persona solo revisa y valida.

Es parte de la propuesta de gobernanza de datos de UFLO. El catálogo alimenta después el diccionario de datos.

## Por qué capturas

La API de Looker Studio solo permite buscar informes y gestionar permisos. No expone gráficos, filtros, campos calculados ni combinaciones. Por eso la información sale de capturas analizadas por un modelo con visión.

## Stack (fase 1, la actual)

| Pieza | Tecnología |
|---|---|
| Interfaz | Apps Script HtmlService (`Index.html`), publicada como aplicación web del dominio UFLO |
| Lógica de servidor | Apps Script V8 (`Code.gs`, `Store.gs`, `Gemini.gs`, `Config.gs`) |
| Almacenamiento | Google Sheets: una pestaña por entidad (ver `Store.gs` → `TABS`) |
| Capturas | Google Drive: una carpeta por tablero dentro de la carpeta raíz |
| Modelo | Gemini en Vertex AI (por defecto) o Gemini API, vía `UrlFetchApp` |

**Fase 2, todavía no:** pasar el almacenamiento a BigQuery (dataset `gobierno_datos`) y sumar linaje automático con `INFORMATION_SCHEMA.JOBS` (etiquetas `looker_studio_report_id` y `looker_studio_datasource_id`). No implementes nada de BigQuery salvo que te lo pidan explícitamente.

## Mapa de archivos

```
AGENTS.md                 este archivo
README.md                 instalación y uso, para personas
docs/especificacion.md    requisitos, modelo de datos, reglas de fusión, criterios de aceptación
docs/pruebas.md           lista de pruebas manuales
local/                    sistema vigente: servidor Node + OCR local (lo que se usa)
  app.html                interfaz completa (modelo v2, gobernanza)
  shim.js                 puente al servidor, importar fuente, exportar
  extract.mjs             OCR -> ficha, absorción de campos desde capturas
  sources.mjs             CSV/XLSX -> campos + concepto
  server.mjs, ocr.mjs     servidor y Tesseract
datos/                    conceptos.json (diccionario ISO 11179) y maestros.json
prototipo/v2-2026-10-20/  copia congelada del sistema vigente (versión de referencia)
prototipo/archivo-v1/     versión anterior: artifact de Claude + apps-script (no se despliega)
ejemplos/                 respuesta de ejemplo del modelo, para pruebas sin gastar llamadas
```

## Flujo principal

1. El usuario elige bandeja (`paginas`, `filtros`, `fuente`, `joins`) y pega una imagen.
2. `Index.html` la lee como base64 y llama `subirCaptura(id, seccion, base64, mime)`: se guarda en Drive y se registra en la pestaña `Capturas` con `analizada = FALSE`.
3. Con "Analizar al pegar" activo, a los 1,8 s la interfaz llama `analizarCapturas(id, ids)` en tandas de `MAX_IMAGENES_POR_LLAMADA`.
4. El servidor arma un pedido con las instrucciones y, por cada imagen, una etiqueta de sección seguida de la imagen. Pide JSON con `responseSchema`.
5. `fusionar_` mezcla la respuesta en la ficha y se guarda todo.
6. La persona corrige, marca usuarios, dueño y estado, y valida.

## Reglas que no se negocian

- **Nunca pisar lo que escribió una persona.** La fusión solo completa campos vacíos y agrega filas nuevas. Una fila se identifica por su clave (`LISTAS_DEF[...].clave`).
- **Sin datos personales en el modelo.** Las instrucciones prohíben transcribir valores numéricos de resultados, nombres de personas, DNI y correos. No relajes esa regla. Ley 25.326 de Protección de Datos Personales.
- **Solo cuentas e infraestructura institucionales.** Nada de servicios externos fuera de Google Workspace / Google Cloud de UFLO. La clave de Gemini API, si se usa, va en Propiedades del script, nunca en el código.
- **Interfaz en español rioplatense neutro**, frases cortas, botones que dicen lo que hacen.
- **Todo valor en Sheets se escribe como texto** (formato `@`), para que nada se interprete como fórmula.
- Las funciones internas terminan en `_`. Las demás quedan expuestas a `google.script.run`: no agregues funciones públicas que borren o expongan datos sin necesidad.

## Límites conocidos de la plataforma

- Apps Script corta cada ejecución a los 6 minutos: por eso el análisis va en tandas y la interfaz encadena llamadas.
- `LockService` protege lectura-fusión-escritura. La llamada al modelo va fuera del lock.
- Sheets reescribe la pestaña completa en cada guardado (`escribirTodo_`). Alcanza para cientos de tableros; si crece mucho, es momento de la fase 2 (BigQuery).
- El modelo por defecto es `gemini-2.5-flash`. Verificá su vigencia en Vertex AI y cambiá `MODELO` en Propiedades del script si hay uno más nuevo.

## Cómo verificar un cambio

1. `probarModelo()` desde el editor: debe registrar `{"nombre":"prueba ok"}`.
2. Seguir `docs/pruebas.md`.
3. Si cambiás `fusionar_`, probalo con `ejemplos/respuesta_modelo_ejemplo.json` (ver la sección de pruebas sin modelo).

## Pendientes priorizados

1. Probar con capturas reales de los tableros de Encuestas docentes y ajustar las instrucciones del modelo.
2. Reintento automático cuando el modelo devuelve 429 o 503.
3. Reducir el tamaño de las capturas en el navegador antes de subirlas (por ejemplo, máximo 2400 px de ancho).
4. Fase 2: BigQuery y linaje automático.
