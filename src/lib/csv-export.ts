'use client';

// Funcionalidad "Exportar CSV" (dashboard de métricas e historial de
// auditoría): utilidades genéricas para armar un CSV válido a partir de
// datos que ya están en memoria del navegador y disparar su descarga — sin
// ninguna librería nueva, un CSV es texto plano simple y no hace falta una
// dependencia para generarlo. Reglas de escape de RFC 4180: cualquier celda
// con coma, comilla o salto de línea va entre comillas dobles, y las
// comillas internas se duplican.

// BOM UTF-8: sin esto, Excel (sobre todo en Windows) abre el CSV asumiendo
// la codificación por defecto del sistema en vez de UTF-8, y cualquier
// tilde/ñ sale mal (ej. "atención" se ve como "atenci?n").
const BOM_UTF8 = String.fromCharCode(0xfeff);

export type ColumnaCSV<T> = {
  encabezado: string;
  valor: (fila: T) => string | number | null | undefined;
};

function escaparCeldaCSV(valor: string): string {
  if (/[",\r\n]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

function filaACSV(valores: Array<string | number | null | undefined>): string {
  return valores.map((v) => escaparCeldaCSV(String(v ?? ''))).join(',');
}

/**
 * Arma el cuerpo de una tabla CSV (fila de encabezados + una fila por cada
 * elemento de `filas`) SIN el BOM — pensado para poder combinar varias de
 * estas (una por sección) en un solo archivo con unirBloquesCSV, que agrega
 * el BOM una sola vez para todo el archivo. Si lo que hace falta es un CSV
 * de una sola tabla (ej. auditoría, que es una lista plana), usar generarCSV
 * en su lugar — ya incluye el BOM.
 */
export function filasACSV<T>(filas: T[], columnas: ColumnaCSV<T>[]): string {
  const encabezado = filaACSV(columnas.map((c) => c.encabezado));
  const lineas = filas.map((fila) => filaACSV(columnas.map((c) => c.valor(fila))));
  return [encabezado, ...lineas].join('\r\n');
}

/**
 * CSV de una sola tabla, listo para descargar — incluye el BOM UTF-8 al
 * inicio (ver BOM_UTF8 más arriba). Es el caso simple: un array de objetos +
 * sus columnas.
 */
export function generarCSV<T>(filas: T[], columnas: ColumnaCSV<T>[]): string {
  return BOM_UTF8 + filasACSV(filas, columnas);
}

/**
 * Une varios bloques de tabla (ver filasACSV) en un solo archivo CSV,
 * separados por una fila en blanco entre sección y sección, con el BOM UTF-8
 * al inicio (una sola vez para todo el archivo, no una por bloque) — para
 * reportes con varias tablas distintas en un mismo CSV (ver su uso en
 * metrics-dashboard.tsx: resumen general, chats por estado, acciones por
 * persona, etc., todo en un único archivo). Cada bloque puede empezar con su
 * propio título como primera línea — eso lo arma el llamador antes de pasarlo
 * acá, esta función solo los une.
 */
export function unirBloquesCSV(bloques: string[]): string {
  return BOM_UTF8 + bloques.filter(Boolean).join('\r\n\r\n');
}

/**
 * Dispara la descarga de un CSV ya armado (ver generarCSV/unirBloquesCSV) en
 * el navegador: un Blob + un <a download> temporal — no depende de ningún
 * endpoint nuevo, el archivo entero ya está armado en memoria del cliente
 * antes de llamar acá.
 */
export function descargarCSV(contenido: string, nombreArchivo: string): void {
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nombreArchivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
