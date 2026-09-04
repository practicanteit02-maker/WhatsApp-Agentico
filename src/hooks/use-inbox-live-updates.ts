import { useEffect, useRef } from 'react';
import type { ChatCollabPayload, InboxUpdatePayload } from '@/lib/event-bus';

/**
 * Se suscribe al stream de Server-Sent Events de /api/events e invoca
 * `onUpdate` en el instante en que el webhook de WhatsApp registra algo
 * nuevo (un mensaje entrante nuevo, un cambio de estado de
 * entrega/lectura, ...). Esto permite que la bandeja reaccione de inmediato
 * en vez de esperar a su siguiente sondeo.
 *
 * El sondeo se mantiene en todos lados donde se usa esto — esto es
 * puramente un aviso de "despiértate ahora", así que una conexión
 * caída/reconectándose nunca causa actualizaciones perdidas, solo un breve
 * respaldo hacia el intervalo normal.
 *
 * `onCollabUpdate` (opcional) es la funcionalidad "Candado de chat" — un
 * segundo tipo de evento sobre esta MISMA conexión (no una nueva), para
 * enterarse en vivo de cambios de "quién atiende este chat" / "quién mandó
 * este mensaje" (ver src/lib/chat-collab.ts). Solo message-view.tsx lo usa
 * hoy; conversation-list.tsx sigue llamando este hook sin el segundo
 * argumento.
 */
export function useInboxLiveUpdates(
  onUpdate: (payload: InboxUpdatePayload) => void,
  onCollabUpdate?: (payload: ChatCollabPayload) => void,
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onCollabUpdateRef = useRef(onCollabUpdate);
  onCollabUpdateRef.current = onCollabUpdate;

  useEffect(() => {
    const source = new EventSource('/api/events');

    const handleUpdate = (event: MessageEvent<string>) => {
      try {
        onUpdateRef.current(JSON.parse(event.data) as InboxUpdatePayload);
      } catch {
        // Payload mal formado; se ignora este tick, el siguiente (o el
        // intervalo de sondeo de respaldo) igual mantendrá todo sincronizado.
      }
    };
    source.addEventListener('update', handleUpdate);

    const handleCollabUpdate = (event: MessageEvent<string>) => {
      try {
        onCollabUpdateRef.current?.(JSON.parse(event.data) as ChatCollabPayload);
      } catch {
        // Igual que arriba: se ignora este tick puntual.
      }
    };
    source.addEventListener('collab', handleCollabUpdate);

    return () => {
      source.removeEventListener('update', handleUpdate);
      source.removeEventListener('collab', handleCollabUpdate);
      source.close();
    };
  }, []);
}
