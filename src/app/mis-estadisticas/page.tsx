import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, LineChart, ShieldAlert } from 'lucide-react';
import { auth } from '@/auth';
import { esCoordinadora } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { MisEstadisticasView } from '@/components/mis-estadisticas-view';

/**
 * Pantalla "Mis estadísticas" — a diferencia de /auditoria y /metricas (solo
 * Administrador), acá el gate es esCoordinadora(): exclusivo de Coordinadora.
 * Administrador queda afuera a propósito (ver esCoordinadora() en
 * permissions.ts) porque ya ve esos mismos números, incluidos los suyos,
 * dentro del dashboard general de Métricas — tener ambos sería redundante.
 * Mismo patrón server-side que el resto: el chequeo se hace acá, antes de
 * mandar nada al navegador. El middleware (src/middleware.ts) ya garantiza
 * que solo se llega hasta acá con una sesión real — el `redirect('/login')`
 * es un respaldo.
 */
export default async function MisEstadisticasPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  if (!esCoordinadora(session.user.perfil)) {
    return (
      <div className="flex h-dvh min-h-dvh items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-sm rounded-2xl border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-8 text-center shadow-lg">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="size-6" />
          </span>
          <h1 className="mt-5 text-lg font-semibold text-foreground">Acceso denegado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta sección es exclusiva del rol Coordinadora.
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
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
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
              <LineChart className="size-4 flex-shrink-0 text-[var(--chat-presence)]" />
              <h1 className="truncate text-base font-semibold text-foreground">Mis estadísticas</h1>
            </div>
          </div>
          <ThemeToggle className="size-10 rounded-md text-muted-foreground" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-5 pb-10">
        <MisEstadisticasView />
      </main>
    </div>
  );
}
