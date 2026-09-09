import { NextResponse } from 'next/server';
import { deleteQuickReply, getAllQuickReplies, getQuickReply, setQuickReply } from '@/lib/quick-replies';
import { requierePermiso } from '@/lib/require-permission';

/**
 * Respuestas rápidas (ver src/lib/quick-replies.ts). A diferencia de
 * Plantillas (donde GET es "leer" y solo crear es "escribir"), acá los
 * cuatro métodos —incluido el listado— están detrás de "escribir": quien
 * no puede responder en un chat tampoco necesita ver ni gestionar los
 * atajos que existen para responder más rápido (a pedido explícito, para
 * que QA no las vea en absoluto, igual que ya no ve el campo de texto).
 */
function normalizeAtajo(raw: string): string {
  return raw.trim().toLowerCase();
}

function validateBody(body: { atajo?: string; mensaje?: string } | null) {
  const atajo = body?.atajo ? normalizeAtajo(body.atajo) : '';
  const mensaje = body?.mensaje?.trim() ?? '';

  if (!atajo || /\s/.test(atajo)) {
    return { error: 'El atajo no puede estar vacío ni tener espacios' };
  }
  if (!mensaje) {
    return { error: 'El mensaje no puede estar vacío' };
  }

  return { atajo, mensaje };
}

export async function GET() {
  const denegado = await requierePermiso('escribir');
  if (denegado) return denegado;

  const quickReplies = await getAllQuickReplies();
  return NextResponse.json({ quickReplies });
}

export async function POST(request: Request) {
  const denegado = await requierePermiso('escribir');
  if (denegado) return denegado;

  const body = await request.json().catch(() => null) as { atajo?: string; mensaje?: string } | null;
  const validated = validateBody(body);
  if ('error' in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const existing = await getQuickReply(validated.atajo);
  if (existing) {
    return NextResponse.json({ error: 'Ya existe un atajo con ese nombre' }, { status: 409 });
  }

  await setQuickReply(validated.atajo, validated.mensaje);
  return NextResponse.json({ ok: true, quickReply: validated });
}

export async function PUT(request: Request) {
  const denegado = await requierePermiso('escribir');
  if (denegado) return denegado;

  const body = await request.json().catch(() => null) as { atajo?: string; mensaje?: string } | null;
  const validated = validateBody(body);
  if ('error' in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const existing = await getQuickReply(validated.atajo);
  if (!existing) {
    return NextResponse.json({ error: 'No existe un atajo con ese nombre' }, { status: 404 });
  }

  await setQuickReply(validated.atajo, validated.mensaje);
  return NextResponse.json({ ok: true, quickReply: validated });
}

export async function DELETE(request: Request) {
  const denegado = await requierePermiso('escribir');
  if (denegado) return denegado;

  const { searchParams } = new URL(request.url);
  const atajo = searchParams.get('atajo') ? normalizeAtajo(searchParams.get('atajo')!) : '';
  if (!atajo) {
    return NextResponse.json({ error: 'Falta el atajo' }, { status: 400 });
  }

  const existing = await getQuickReply(atajo);
  if (!existing) {
    return NextResponse.json({ error: 'No existe un atajo con ese nombre' }, { status: 404 });
  }

  await deleteQuickReply(atajo);
  return NextResponse.json({ ok: true });
}
