import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { auth } from '@/auth';
import { esAdministrador } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { SettingsView } from '@/components/settings-view';

/**
 * Página de Ajustes (números de WhatsApp rastreados) — exclusiva de
 * Administrador. Antes era enteramente un componente cliente sin ninguna
 * protección server-side (a diferencia de /usuarios); ahora el chequeo se
 * hace acá, server-side, antes de mandar nada al navegador — mismo patrón
 * que src/app/usuarios/page.tsx, usando esAdministrador() (que también
 * acepta "Administradora", ver src/lib/permissions.ts) en vez de comparar
 * el string a mano. El middleware (src/middleware.ts) ya garantiza que solo
 * se llega hasta acá con una sesión real — el `redirect('/login')` de abajo
 * es un respaldo por si alguna vez cambia esa garantía, no la primera línea
 * de defensa.
 */
export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  if (!esAdministrador(session.user.perfil)) {
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

  return <SettingsView />;
}
