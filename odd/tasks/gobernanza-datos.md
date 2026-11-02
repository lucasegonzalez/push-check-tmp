# Gobernanza de datos — sistema completo

## Objetivo

Convertir el catálogo de tableros en un sistema de gobernanza de datos apoyado en
cuatro áreas de DAMA-DMBOK, con diccionario bajo ISO/IEC 11179 y publicación
versionada para compartir.

## Alcance

Dentro:

- Modelo de ficha v2 (roles, ciclo de vida, arquitectura de fuentes, concepto explícito).
- Dudas clasificadas por dimensión de calidad.
- Panel de gobernanza con métricas y brechas.
- Diccionario v2 con definición, dominio, sinónimos y estado.
- Maestros y referencia.
- Export MD / HTML / JSON alineados.

Fuera:

- Autenticación, multiusuario, backend compartido.
- Publicación en Google (Apps Script / Sites): queda documentada como paso siguiente.
- Análisis con IA conversacional: el JSON es la entrada, no se implementa acá.

## Modelo

| Concepto | Área DAMA | Dónde vive |
|---|---|---|
| Catálogo de tableros | Metadata | ficha |
| Diccionario de conceptos | Metadata (ISO 11179) | `datos/conceptos.json` |
| Maestros y referencia | Reference & Master Data | `datos/maestros.json` |
| Dudas por dimensión | Data Quality | `ficha.dudas` |
| Dueño / custodio / ciclo de vida | Data Governance | `ficha.dueno`, `custodio`, `estado` |

Dimensiones de calidad: completitud, exactitud, vigencia, consistencia, unicidad, validez.

Ciclo de vida: borrador → validado → obsoleto → retirado, con `reemplazado_por`.

## Tareas

- [x] T1. Fork del prototipo a `local/app.html` (el original queda como referencia).
- [x] T2. Modelo v2: EMPTY, norm y migración de datos viejos.
- [x] T3. Editor: roles, ciclo de vida, vigencia, fuentes con plataforma y objeto, campos con concepto, dudas como tabla.
- [x] T4. Panel de gobernanza con métricas y brechas de las cuatro áreas.
- [x] T5. Diccionario v2 (ISO 11179) con definición, dominio, sinónimos y estado.
- [x] T6. Maestros y referencia en `datos/maestros.json` + endpoint.
- [x] T7. Export MD, HTML y JSON alineados al modelo nuevo.
- [x] T8. Verificación end-to-end (import, edición, gobernanza, export).

## Criterios de aceptación

- Un tablero viejo (con `preguntas` string) se abre sin perder datos.
- El panel de gobernanza cuenta brechas reales, no estimadas.
- El HTML exportado incluye el resumen de gobernanza y las capturas ampliables.
- El JSON incluye ficha, diccionario, maestros y gobernanza.
- `datos/conceptos.json` valida contra el esquema `conceptos/v2`.

## Riesgos

- Divergencia con `apps-script/`: el fork local evoluciona por su cuenta.
- Definiciones del diccionario son propuestas hasta que el dueño las valide.
- Sin git en el proyecto: sin historial de commits local.
