'use client';

import { MessageCircle } from 'lucide-react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';

/**
 * Página de login: reemplaza la pantalla por defecto de NextAuth
 * (/api/auth/signin) para que el primer contacto con la app ya se vea como
 * el resto del panel — mismos tokens de color (--chat-surface,
 * --chat-border-strong, --primary, etc. de globals.css), mismos
 * redondeados/sombras que usan las tarjetas y popovers de la bandeja. El
 * único proveedor configurado es Cognito (ver src/auth.ts).
 */
export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-8 text-center shadow-lg">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-[var(--chat-avatar)] text-[var(--chat-avatar-foreground)]">
          <MessageCircle className="size-6" />
        </span>

        <h1 className="mt-5 text-xl font-semibold text-foreground">WhatsApp Agéntico</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Iniciá sesión con tu cuenta del equipo para entrar a la bandeja.
        </p>

        <Button
          type="button"
          size="lg"
          className="mt-6 w-full"
          onClick={() => signIn('cognito', { callbackUrl: '/' })}
        >
          Iniciar sesión
        </Button>
      </div>
    </div>
  );
}
