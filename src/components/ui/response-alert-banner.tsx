'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { playResponseAlertSound } from '@/lib/notification-sounds';

// Funcionalidad "Alerta de tiempo de respuesta" (banner + sonido): la
// condición isThreadInAlert() y la detección de la transición false→true por
// chat viven en conversation-list.tsx (mismo patrón de "snapshot anterior vs
// actual" que ya usan las notificaciones de escritorio) — este archivo solo
// se encarga de la animación y de avisarle al padre cuándo un banner terminó
// su ciclo completo, para que lo saque del arreglo.
export type ResponseAlertBannerItem = {
  /** Único por aparición (no por chat): el mismo threadKey puede volver a
   * entrar en alerta más adelante y dispara un banner nuevo con un id nuevo. */
  id: string;
  contactName: string;
  zona?: string;
};

const ENTER_DURATION_MS = 200;
const VISIBLE_DURATION_MS = 3000;
const EXIT_DURATION_MS = 200;

type ResponseAlertBannerStackProps = {
  banners: ResponseAlertBannerItem[];
  onBannerDone: (id: string) => void;
};

/**
 * Pila de banners rojos que se apila arriba de la lista de conversaciones,
 * uno por cada chat que ACABA de cruzar el umbral de 15 minutos sin
 * respuesta — no reemplaza el contador de la pestaña "En alerta" ni el borde
 * rojo de cada fila (esos siguen viviendo en conversation-list.tsx tal cual
 * estaban), es un aviso adicional y transitorio. Posicionado absoluto (ver el
 * contenedor "relative" que lo envuelve en conversation-list.tsx) para no
 * empujar las filas de chats hacia abajo mientras aparece/desaparece.
 */
export function ResponseAlertBannerStack({ banners, onBannerDone }: ResponseAlertBannerStackProps) {
  if (banners.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-2 p-2">
      {banners.map((banner) => (
        <ResponseAlertBanner key={banner.id} banner={banner} onDone={() => onBannerDone(banner.id)} />
      ))}
    </div>
  );
}

type ResponseAlertBannerProps = {
  banner: ResponseAlertBannerItem;
  onDone: () => void;
};

function ResponseAlertBanner({ banner, onDone }: ResponseAlertBannerProps) {
  // Arranca en el estado "oculto" (el mismo que el de salida) y pasa a
  // "entered" en el siguiente frame — ese cambio de clase entre ambos
  // estados es lo que dispara la transición CSS de entrada (fade +
  // deslizamiento sutil hacia abajo). El resto del ciclo (quedarse visible
  // ~3s, volver a "oculto" para la salida, avisar a onDone) lo maneja el
  // efecto de abajo con setTimeout — cada banner es una instancia fija por
  // `id` (la key del .map en ResponseAlertBannerStack), así que el efecto
  // corre una sola vez, en su montaje.
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    playResponseAlertSound();

    const enterFrame = requestAnimationFrame(() => setEntered(true));
    const exitTimer = setTimeout(() => setEntered(false), ENTER_DURATION_MS + VISIBLE_DURATION_MS);
    const doneTimer = setTimeout(onDone, ENTER_DURATION_MS + VISIBLE_DURATION_MS + EXIT_DURATION_MS);

    return () => {
      cancelAnimationFrame(enterFrame);
      clearTimeout(exitTimer);
      clearTimeout(doneTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex items-start gap-2.5 rounded-xl border border-destructive/30',
        'bg-[var(--chat-surface)] px-3 py-2.5 shadow-lg transition-all ease-out',
        entered ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0',
      )}
      style={{ transitionDuration: `${ENTER_DURATION_MS}ms` }}
    >
      <Clock className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-destructive">
          {banner.contactName} lleva más de 15 min sin respuesta
        </p>
        {banner.zona && <p className="text-xs text-muted-foreground">{banner.zona}</p>}
      </div>
    </div>
  );
}
