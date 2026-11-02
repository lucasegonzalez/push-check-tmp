# Catálogo de tableros UFLO

> [!IMPORTANT]
> **Versión vigente: `prototipo/v2-2026-10-20/`** — corre local con Node y OCR propio, sin Gemini ni Apps Script.
> Para levantarla: `cd prototipo/v2-2026-10-20 && npm install && npm start` → `http://127.0.0.1:4173`.
> La instalación con Google Workspace que describe el resto de este README corresponde a la **versión anterior**, archivada en `prototipo/archivo-v1/`.

Aplicación web interna para documentar los tableros de Looker Studio a partir de capturas de pantalla. Pegás una captura, Gemini completa la ficha y vos la validás.

Funciona solo con Google Workspace y Google Cloud de la universidad.

## Qué completa automáticamente

| Bandeja | Qué capturar | Qué se completa |
|---|---|---|
| Páginas del tablero | Cada página o pestaña | Nombre, objetivo, gráficos con tipo, métrica, dimensión y regla |
| Filtros | Los controles, mejor abiertos | Cada filtro con tipo de control, campo y opciones |
| Fuente de datos | *Recurso → Administrar fuentes → Editar* | Fuente, campos con tipo, campos calculados con su fórmula |
| Combinación (joins) | La ventana *Combinar datos* | Cada unión: tablas, tipo de unión y claves |

Queda a mano solo lo que una captura no muestra: área, dueño, usuarios y estado de validación.

## Instalación (una vez, unos 20 minutos)

### 1. Crear el proyecto de Apps Script
1. Entrá a [script.google.com](https://script.google.com) con la cuenta de UFLO → **Nuevo proyecto**. Nombre: `Catálogo de tableros UFLO`.
2. En **Configuración del proyecto**, activá *Mostrar el archivo de manifiesto "appsscript.json" en el editor*.
3. Copiá cada archivo de `prototipo/archivo-v1/apps-script/` al editor con el mismo nombre: `appsscript.json`, `Config.gs`, `Store.gs`, `Gemini.gs`, `Code.gs` e `Index.html` (este último se crea con **+ → HTML**, nombre `Index`).

Alternativa con [clasp](https://github.com/google/clasp): `clasp create --type webapp --title "Catálogo de tableros UFLO" --rootDir prototipo/archivo-v1/apps-script` y después `clasp push`.

### 2. Conectar el modelo (elegir una opción)

**Opción A · Vertex AI (recomendada).** Los datos quedan bajo el contrato de Google Cloud de la universidad.
1. Pedirle a TI un proyecto de Google Cloud con facturación y la API **Vertex AI** habilitada.
2. En Apps Script, **Configuración del proyecto → Proyecto de Google Cloud → Cambiar proyecto** y pegar el número de ese proyecto.
   Si lo pide, configurar antes la pantalla de consentimiento OAuth del proyecto como **Interna**.
3. Quien vaya a desplegar necesita el rol **Usuario de Vertex AI** (`roles/aiplatform.user`) en ese proyecto.
4. En **Propiedades del script**: `PROVEEDOR = vertex`, `PROYECTO_GCP = <id del proyecto>`, `UBICACION = us-central1`.

**Opción B · Gemini API (para probar rápido).**
1. Crear una clave en [Google AI Studio](https://aistudio.google.com/apikey) con la cuenta de UFLO.
2. En **Propiedades del script**: `PROVEEDOR = gemini_api`, `GEMINI_API_KEY = <clave>`.
3. Revisar con TI las condiciones de uso de datos de esa opción antes de usarla con tableros reales.

En ambos casos, `MODELO` es `gemini-2.5-flash` por defecto. Si Vertex AI ya ofrece una versión más nueva de Flash, cambiala ahí.

### 3. Instalar y probar
1. En el editor, elegí la función `instalar` y tocá **Ejecutar**. Acepta los permisos. Crea la planilla de datos y la carpeta de capturas en tu Drive; los enlaces quedan en el registro.
2. Ejecutá `probarModelo`. Tiene que aparecer `{"nombre":"prueba ok"}` en el registro.

### 4. Publicar
**Implementar → Nueva implementación → Aplicación web**
- Ejecutar como: **Yo**
- Quién tiene acceso: **Cualquier usuario de UFLO**

Copiá la URL de la aplicación web: esa es la herramienta.

## Uso

1. Abrí la URL. Pegá una captura con **⌘V** (Windows: Ctrl+V). Si no hay tablero abierto, se crea uno.
2. Tocá la bandeja que corresponde antes de pegar: páginas, filtros, fuente o joins.
3. El análisis arranca solo a los dos segundos y completa la ficha. Cada captura muestra un punto: amarillo sin analizar, verde analizada, rojo con error (al pasar el mouse se ve el motivo).
4. Revisá, marcá usuarios, área y dueño, y pasá el estado a **Validado**.
5. **Exportar catálogo (.md)** genera un documento con todos los tableros en la carpeta de Drive.

Atajos de captura en Mac: **⌘ + Control + Shift + 4** copia un área; **⌘ + Control + Shift + 3**, la pantalla entera.

## Dónde quedan los datos

- **Planilla** `Catálogo de tableros UFLO · datos`: pestañas Tableros, Fuentes, Joins, Filtros, Graficos, Calculados, Campos, Dudas y Capturas. Se puede consultar o conectar a Looker Studio.
- **Carpeta** `Catálogo de tableros UFLO · capturas`: una subcarpeta por tablero con sus imágenes.

## Para seguir desarrollando

Ver `AGENTS.md` (contexto para asistentes de IA) y `docs/especificacion.md`.
