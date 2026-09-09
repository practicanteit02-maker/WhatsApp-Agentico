import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, ShieldAlert, Users } from 'lucide-react';
import { auth } from '@/auth';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserManager } from '@/components/user-manager';

/**
 * Página de Ajustes > Usuarios (solo Administrador). A diferencia de
 * /plantillas y /settings (componentes de cliente que no verifican el
 * perfil), acá el chequeo se hace server-side, antes de mandar nada al
 * navegador: la lista completa de correos del equipo es información de
 * cuenta, así que ni siquiera se intenta cargar la UI si la persona no es
 * Administrador. El middleware (src/middleware.ts) ya garantiza que solo se
 * llega hasta acá con una sesión real — el `redirect('/login')` de abajo es
 * un respaldo por si alguna vez cambia esa garantía, no la primera línea de
 * defensa.
 */
export default async function UsuariosPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  if (session.user.perfil !== 'Administrador') {
    return (
      <div className="flex h-dvh min-h-dvh items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-sm rounded-2xl border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-8 text-center shadow-lg">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="size-6" />
          </span>
          <h1 className="mt-5 text-lg font-semibold text-foreground">Acceso denegado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta sección es solo para el perfil Administrador.
          </p>
          <Button asChild className="mt-6 w-full">
            <Link href="/">Volver al inbox</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh min-h-dvh overflow-y-auto bg-background text-foreground">
      <header className="chat-header-on-brand sticky top-0 z-20 border-b border-[var(--chat-border-strong)] bg-[var(--chat-header)] px-4 py-3 safe-area-top">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="size-10 flex-shrink-0 rounded-md text-muted-foreground hover:bg-[var(--chat-hover)]"
              aria-label="Volver al inbox"
              title="Volver al inbox"
            >
              <Link href="/">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              <Users className="size-4 flex-shrink-0 text-[var(--chat-presence)]" />
              <h1 className="truncate text-base font-semibold text-foreground">Usuarios</h1>
            </div>
          </div>
          <ThemeToggle className="size-10 rounded-md text-muted-foreground" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-5 pb-10">
        <UserManager />
      </main>
    </div>
  );
}
