import { NextResponse } from 'next/server';
import { registrarAuditoria } from '@/lib/auditoria';
import { checkZoneAccess } from '@/lib/conversation-zones';
import { deleteConversationTag, getAllConversationTags, getConversationTag, setConversationTag } from '@/lib/tags';
import { requierePermiso } from '@/lib/require-permission';

const MAX_TAG_LENGTH = 40;

/**
 * Etiqueta asignada a cada chat (ver src/lib/tags.ts) — texto libre, sin
 * catálogo predefinido, que se pone/edita/quita desde el menú de clic
 * derecho de cada tarjeta en conversation-list.tsx (no hay un pill visible
 * en la lista). GET requiere estar logueado con un rol válido (permiso
 * "leer") — ver qué etiqueta tiene YA asignada un chat puntual es lectura
 * normal, igual que zona/estado. POST ("poner/editar la etiqueta") y DELETE
 * ("quitar la etiqueta") requieren "escribir" — a pedido explícito, NO
 * "editar" (que hoy es exclusivo de Administrador y solo aplica a
 * zona/estado) — y además pasan por checkZoneAccess, el mismo control que
 * protege el resto de los endpoints de un chat puntual: un no-Administrador
 * solo puede etiquetar un chat de su propia zona.
 */
export async function GET() {
  const denegado = await requierePermiso('leer');
  if (denegado) return denegado;

  const tags = await getAllConversationTags();
  return NextResponse.json({ tags });
}

export async function POST(request: Request) {
  const denegado = await requierePermiso('escribir');
  if (denegado) return denegado;

  const body = await request.json().catch(() => null) as { threadKey?: string; etiqueta?: string } | null;
  if (!body?.threadKey || typeof body.etiqueta !== 'string') {
    return NextResponse.json({ error: 'Missing threadKey or etiqueta' }, { status: 400 });
  }

  const etiqueta = body.etiqueta.trim();
  if (!etiqueta) {
    return NextResponse.json({ error: 'La etiqueta no puede estar vacía' }, { status: 400 });
  }
  if (etiqueta.length > MAX_TAG_LENGTH) {
    return NextResponse.json({ error: `La etiqueta no puede superar los ${MAX_TAG_LENGTH} caracteres` }, { status: 400 });
  }

  const access = await checkZoneAccess(body.threadKey);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const etiquetaAnterior = await getConversationTag(body.threadKey);
  await setConversationTag(body.threadKey, etiqueta);

  await registrarAuditoria({
    accion: etiquetaAnterior ? 'editar_etiqueta' : 'asignar_etiqueta',
    objetoTipo: 'chat',
    objetoId: body.threadKey,
    valorAnterior: etiquetaAnterior ?? null,
    valorNuevo: etiqueta,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const denegado = await requierePermiso('escribir');
  if (denegado) return denegado;

  const { searchParams } = new URL(request.url);
  const threadKey = searchParams.get('threadKey');
  if (!threadKey) {
    return NextResponse.json({ error: 'Missing threadKey' }, { status: 400 });
  }

  const access = await checkZoneAccess(threadKey);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const etiquetaAnterior = await getConversationTag(threadKey);
  await deleteConversationTag(threadKey);

  await registrarAuditoria({
    accion: 'quitar_etiqueta',
    objetoTipo: 'chat',
    objetoId: threadKey,
    valorAnterior: etiquetaAnterior ?? null,
    valorNuevo: null,
  });

  return NextResponse.json({ ok: true });
}
