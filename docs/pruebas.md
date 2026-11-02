# Pruebas manuales

Correr después de instalar y ante cada cambio importante.

## Configuración
- [ ] `instalar()` crea la planilla con 9 pestañas y la carpeta de capturas; los enlaces aparecen en el registro.
- [ ] `probarModelo()` registra `{"nombre":"prueba ok"}`.
- [ ] La aplicación web abre y el estado dice "Listo · modelo …".

## Captura y análisis
- [ ] Sin tablero abierto, ⌘V con una imagen crea "Tablero sin nombre" y la sube a "Páginas del tablero".
- [ ] La captura aparece en la carpeta de Drive del tablero y en la pestaña Capturas con `analizada = FALSE`.
- [ ] A los ~2 segundos arranca el análisis; al terminar, el punto queda verde y la ficha tiene gráficos.
- [ ] Captura de filtros abiertos → filas en Filtros con tipo de control y opciones.
- [ ] Captura de la lista de campos → filas en Campos y Calculados con la fórmula literal.
- [ ] Captura de "Combinar datos" → una fila por unión en Joins y las tablas en Fuentes.
- [ ] Pegar 8 capturas seguidas → se analizan en dos tandas (con `MAX_IMAGENES_POR_LLAMADA = 6`).
- [ ] "Detener" corta después de la tanda en curso.

## Fusión
- [ ] Escribir a mano una métrica, tocar "Reanalizar todo" → la métrica escrita no cambia.
- [ ] Borrar una fila y reanalizar → la fila vuelve (es esperado: la captura la sigue mostrando).

## Errores
- [ ] Poner un `MODELO` inexistente y pegar → punto rojo con el motivo; la ficha no se pierde.
- [ ] Pegar un PDF o texto → no hace nada; un archivo no imagen muestra "Solo se aceptan imágenes".

## Persistencia y exportación
- [ ] Recargar la página → todo igual que antes.
- [ ] Cambiar estado a Validado → la lista lo muestra en verde.
- [ ] Exportar → aparece `catalogo_tableros_uflo.md` en la carpeta raíz con el enlace en pantalla.

## Prueba sin modelo (para cambios en `fusionar_`)
En el editor de Apps Script, crear una función temporal:

```js
function probarFusion_() {
  const ficha = { nombre: 'Tablero sin nombre', objetivo: '', frecuencia: '', fuentes: [], joins: [], filtros: [], graficos: [], calculados: [], campos: [], preguntas: [] };
  const r = /* pegar acá el contenido de ejemplos/respuesta_modelo_ejemplo.json */ {};
  Logger.log(fusionar_(ficha, r) + ' datos nuevos');
  Logger.log(JSON.stringify(ficha, null, 2));
}
```
