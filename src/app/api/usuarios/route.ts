import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { registrarAuditoria } from '@/lib/auditoria';
import { deleteUser, getAllUsers, getUser, setUser } from '@/lib/panel-users';
import { esAdministrador, esRolValido } from '@/lib/permissions';
import { isAssignableZone } from '@/lib/mock-zones';

/**
 * Administración de cuentas del panel (tabla "usuarios-panel", ver
 * src/lib/panel-users.ts). Los cuatro métodos son exclusivos de
 * Administrador — a diferencia de /api/conversation-zones (donde el GET es
 * de lectura libre), acá ni siquiera el listado se expone a otros perfiles:
 * la lista de correos/perfiles del equipo es información de cuenta, no de un
 * chat puntual. Igual que en el resto de los endpoints protegidos por
 * perfil, la sesión se lee server-side con auth() — nunca se confía en nada
 * que mande el cliente sobre quién es.
 */
async function requireAdministrador() {
  const session = await auth();
  // esAdministrador() (en vez de comparar contra el literal 'Administrador'
  // a mano) para que "Administradora" — alias femenino, ver ALIAS_ROLES en
  // src/lib/permissions.ts — también cuente, igual que en /settings y en el
  // resto del sistema.
  if (!esAdministrador(session?.user?.perfil)) {
    return NextResponse.json({ error: 'Solo un Administrador puede gestionar usuarios' }, { status: 403 });
  }
  return null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateBody(body: { correo?: string; perfil?: string; zona?: string } | null) {
  const correo = body?.correo?.trim().toLowerCase();
  const perfil = body?.perfil?.trim();
  const zona = body?.zona?.trim() ?? '';

  if (!correo || !EMAIL_PATTERN.test(correo)) {
    return { error: 'Correo inválido' };
  }
  // esRolValido() (en vez de comparar contra la lista canónica de
  // MOCK_ACCOUNT_PROFILES/ROLES a mano) acepta también variantes como
  // "Coordinador" (ver ALIAS_ROLES en src/lib/permissions.ts) — sin esto,
  // editar la zona de un usuario que ya tuviera esa variante guardada en
  // DynamoDB fallaba acá con "Perfil inválido", aunque el sistema de
  // permisos la reconociera perfectamente bien en el resto de la app.
  if (!perfil || !esRolValido(perfil)) {
    return { error: `Perfil inválido: ${perfil}` };
  }
  if (zona && !isAssignableZone(zona)) {
    return { error: `Número inválido: ${zona}` };
  }

  return { correo, perfil, zona };
}

export async function GET() {
  const denied = await requireAdministrador();
  if (denied) return denied;

  const users = await getAllUsers();
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const denied = await requireAdministrador();
  if (denied) return denied;

  const body = await request.json().catch(() => null) as { correo?: string; perfil?: string; zona?: string } | null;
  const validated = validateBody(body);
  if ('error' in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const existing = await getUser(validated.correo);
  if (existing) {
    return NextResponse.json({ error: 'Ya existe un usuario con ese correo' }, { status: 409 });
  }

  // Funcionalidad "Números/Zonas múltiples": panel-users.ts ya guarda
  // `zonas: string[]`, pero este endpoint (y user-manager.tsx, que todavía
  // no se tocó — selector sigue siendo de una sola zona) sigue hablando
  // `zona: string` de punta a punta por ahora. Se envuelve en un array de 0
  // o 1 elementos al guardar — sin cambiar nada del comportamiento actual.
  await setUser(validated.correo, validated.perfil, validated.zona ? [validated.zona] : []);

  await registrarAuditoria({
    accion: 'crear_usuario',
    objetoTipo: 'usuario',
    objetoId: validated.correo,
    valorNuevo: `perfil: ${validated.perfil}; zona: ${validated.zona || '—'}`,
  });

  return NextResponse.json({ ok: true, user: validated });
}

export async function PUT(request: Request) {
  const denied = await requireAdministrador();
  if (denied) return denied;

  const body = await request.json().catch(() => null) as { correo?: string; perfil?: string; zona?: string } | null;
  const validated = validateBody(body);
  if ('error' in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const existing = await getUser(validated.correo);
  if (!existing) {
    return NextResponse.json({ error: 'No existe un usuario con ese correo' }, { status: 404 });
  }

  await setUser(validated.correo, validated.perfil, validated.zona ? [validated.zona] : []);

  // Mismo criterio de "un solo valor por ahora" que el comentario de POST —
  // existing.zonas[0] es la única zona posible mientras este endpoint siga
  // hablando zona: string.
  const existingZona = existing.zonas[0] ?? '';
  const cambios: string[] = [];
  if ((existing.perfil || '') !== validated.perfil) {
    cambios.push(`perfil: ${existing.perfil || '—'} → ${validated.perfil}`);
  }
  if (existingZona !== (validated.zona || '')) {
    cambios.push(`zona: ${existingZona || '—'} → ${validated.zona || '—'}`);
  }
  await registrarAuditoria({
    accion: 'editar_usuario',
    objetoTipo: 'usuario',
    objetoId: validated.correo,
    valorAnterior: `perfil: ${existing.perfil || '—'}; zona: ${existingZona || '—'}`,
    valorNuevo: `perfil: ${validated.perfil}; zona: ${validated.zona || '—'}`,
    detalle: cambios.length > 0 ? cambios.join('; ') : 'sin cambios',
  });

  return NextResponse.json({ ok: true, user: validated });
}

export async function DELETE(request: Request) {
  const denied = await requireAdministrador();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const correo = searchParams.get('correo')?.trim().toLowerCase();
  if (!correo) {
    return NextResponse.json({ error: 'Falta el correo' }, { status: 400 });
  }

  const existing = await getUser(correo);
  if (!existing) {
    return NextResponse.json({ error: 'No existe un usuario con ese correo' }, { status: 404 });
  }

  await deleteUser(correo);

  await registrarAuditoria({
    accion: 'eliminar_usuario',
    objetoTipo: 'usuario',
    objetoId: correo,
    valorAnterior: `perfil: ${existing.perfil || '—'}; zona: ${existing.zonas[0] || '—'}`,
    valorNuevo: null,
  });

  return NextResponse.json({ ok: true });
}
