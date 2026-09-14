'use client';

import { useEffect, useRef, useState } from 'react';
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
  /** threadKey del chat — un banner por CONVERSACIÓN en alerta, no por
   * aparición: mientras el chat siga en alerta, es el mismo banner (fijo, no
   * se re-anima ni vuelve a sonar); si vuelve a alertar más adelante (ya
   * respondido y sin respuesta de nuevo por otros 15min), ahí sí es una
   * instancia nueva. */
  threadKey: string;
  contactName: string;
  zona?: string;
  /** true mientras isThreadInAlert() siga dando true para este threadKey
   * (ver el efecto en conversation-list.tsx que arma este arreglo) — en
   * cuanto pasa a false (alguien del equipo le respondió al cliente), este
   * banner dispara su animación de salida y avisa a onDone() para que lo
   * saquen del arreglo. Mientras siga en true, el banner se queda fijo en
   * pantalla, sin ningún timer de auto-ocultado. */
  active: boolean;
};

const ENTER_DURATION_MS = 200;
const EXIT_DURATION_MS = 200;

type ResponseAlertBannerStackProps = {
  banners: ResponseAlertBannerItem[];
  onBannerDone: (threadKey: string) => void;
};

/**
 * Pila de banners rojos que se apila arriba de la lista de conversaciones,
 * uno por cada chat que está en alerta (más de 15 minutos sin respuesta) —
 * no reemplaza el contador de la pestaña "En alerta" ni el borde rojo de
 * cada fila (esos siguen viviendo en conversation-list.tsx tal cual estaban),
 * es un aviso adicional. Cada banner es independiente: se queda fijo
 * mientras SU conversación siga en alerta, y desaparece solo cuando ESA
 * conversación puntual se responde (no cuando se responde cualquier otra).
 * Posicionado absoluto (ver el contenedor "relative" que lo envuelve en
 * conversation-list.tsx) para no empujar las filas de chats hacia abajo
 * mientras aparece/desaparece.
 */
export function ResponseAlertBannerStack({ banners, onBannerDone }: ResponseAlertBannerStackProps) {
  if (banners.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-2 p-2">
      {banners.map((banner) => (
        <ResponseAlertBanner key={banner.threadKey} banner={banner} onDone={() => onBannerDone(banner.threadKey)} />
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
  // deslizamiento sutil hacia abajo).
  const [entered, setEntered] = useState(false);
  // Evita que un re-render del padre (poll/tick, cada 10-30s) con
  // banner.active todavía en true vuelva a sonar — el sonido es por
  // instancia de banner (una sola vez, al entrar en alerta), no por render.
  const hasPlayedSoundRef = useRef(false);

  // Entrada: siempre se monta con active=true (conversation-list.tsx solo
  // agrega un banner nuevo al arreglo cuando el chat ENTRA en alerta) — este
  // efecto corre una sola vez, en el montaje: suena el ding-dong y dispara la
  // animación de entrada.
  useEffect(() => {
    if (!hasPlayedSoundRef.current) {
      playResponseAlertSound();
      hasPlayedSoundRef.current = true;
    }

    const enterFrame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(enterFrame);
  }, []);

  // Salida: en cuanto ESTE threadKey deja de estar en alerta (banner.active
  // pasa a false — alguien le respondió a ese cliente puntual), se dispara
  // la animación de salida y, ya terminada, se avisa a onDone() para que
  // conversation-list.tsx lo saque del arreglo. Mientras active se mantenga
  // true, el efecto no hace nada — ya no hay ningún timer de auto-ocultado,
  // el banner se queda fijo el tiempo que haga falta.
  //
  // Depende solo de banner.active (no de onDone) a propósito: onDone es una
  // función nueva en cada render del padre (arrow function inline en
  // ResponseAlertBannerStack), pero siempre hace lo mismo — si se agregara
  // a las dependencias, cada re-render del padre mientras active sigue en
  // false reiniciaría el timer de salida en vez de dejarlo correr.
  useEffect(() => {
    if (banner.active) return;

    setEntered(false);
    const doneTimer = setTimeout(onDone, EXIT_DURATION_MS);
    return () => clearTimeout(doneTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banner.active]);

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
