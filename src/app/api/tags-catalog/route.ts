import { NextResponse } from 'next/server';
import { addTagToCatalog, deleteTagFromCatalog, getTagsCatalog, tagExistsInCatalog } from '@/lib/tags';
import { requierePermiso } from '@/lib/require-permission';

/**
 * Catálogo de etiquetas disponibles (ver src/lib/tags.ts). Los tres
 * métodos —incluido el listado— están detrás de "escribir", mismo
 * criterio que /api/respuestas-rapidas: quien no puede asignar una
 * etiqueta (QA) tampoco necesita ver ni gestionar el catálogo completo de
 * opciones — sí puede ver la etiqueta YA asignada de un chat puntual (eso
 * vive en /api/conversation-tag, gateado con "leer").
 */
function normalizeTag(raw: string): string {
  return raw.trim();
}

export async function GET() {
  const denegado = await requierePermiso('escribir');
  if (denegado) return denegado;

  const tags = await getTagsCatalog();
  return NextResponse.json({ tags });
}

export async function POST(request: Request) {
  const denegado = await requierePermiso('escribir');
  if (denegado) return denegado;

  const body = await request.json().catch(() => null) as { etiqueta?: string } | null;
  const etiqueta = body?.etiqueta ? normalizeTag(body.etiqueta) : '';
  if (!etiqueta) {
    return NextResponse.json({ error: 'La etiqueta no puede estar vacía' }, { status: 400 });
  }

  if (await tagExistsInCatalog(etiqueta)) {
    return NextResponse.json({ error: 'Ya existe una etiqueta con ese nombre' }, { status: 409 });
  }

  await addTagToCatalog(etiqueta);
  return NextResponse.json({ ok: true, etiqueta });
}

export async function DELETE(request: Request) {
  const denegado = await requierePermiso('escribir');
  if (denegado) return denegado;

  const { searchParams } = new URL(request.url);
  const etiqueta = searchParams.get('etiqueta') ? normalizeTag(searchParams.get('etiqueta')!) : '';
  if (!etiqueta) {
    return NextResponse.json({ error: 'Falta la etiqueta' }, { status: 400 });
  }

  if (!(await tagExistsInCatalog(etiqueta))) {
    return NextResponse.json({ error: 'No existe una etiqueta con ese nombre' }, { status: 404 });
  }

  await deleteTagFromCatalog(etiqueta);
  return NextResponse.json({ ok: true });
}
