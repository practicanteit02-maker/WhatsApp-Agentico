import { NextResponse } from 'next/server';
import { checkZoneAccess } from '@/lib/conversation-zones';
import { getAllConversationTags, setConversationTag, tagExistsInCatalog } from '@/lib/tags';
import { requierePermiso } from '@/lib/require-permission';

/**
 * Etiqueta asignada a cada chat (ver src/lib/tags.ts). GET requiere estar
 * logueado con un rol válido (permiso "leer") — a diferencia del catálogo
 * completo (/api/tags-catalog, detrás de "escribir"), ver qué etiqueta
 * tiene YA asignada un chat puntual es lectura normal, igual que zona/
 * estado. POST ("asignar") requiere "escribir" — a pedido explícito, NO
 * "editar" (que hoy es exclusivo de Administrador y solo aplica a
 * zona/estado) — y además pasa por checkZoneAccess, el mismo control que
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
  if (!body?.threadKey || !body.etiqueta) {
    return NextResponse.json({ error: 'Missing threadKey or etiqueta' }, { status: 400 });
  }

  if (!(await tagExistsInCatalog(body.etiqueta))) {
    return NextResponse.json({ error: `Etiqueta inválida: ${body.etiqueta}` }, { status: 400 });
  }

  const access = await checkZoneAccess(body.threadKey);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  await setConversationTag(body.threadKey, body.etiqueta);
  return NextResponse.json({ ok: true });
}
