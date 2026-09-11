'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MatrizActividad } from '@/components/matriz-actividad';
import type { AgregadoRespuestas } from '@/lib/respuestas-metrics';

const RANGOS = [7, 14, 30] as const;
type Rango = (typeof RANGOS)[number];

/** "45s" / "3 min" / "2h 15m" — mismo formato que metrics-dashboard.tsx
 * (duplicado a propósito: son pantallas separadas, mismo criterio que el
 * resto del proyecto de no compartir helpers chicos entre dashboards). */
function formatearDuracion(segundos: number): string {
  if (segundos < 60) return `${Math.round(segundos)}s`;
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const minutosRestantes = minutos % 60;
  return minutosRestantes > 0 ? `${horas}h ${minutosRestantes}m` : `${horas}h`;
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-4">
      <h2 className="text-sm font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

function Kpi({ etiqueta, valor, detalle }: { etiqueta: string; valor: string | number; detalle?: string }) {
  return (
    <div className="rounded-lg border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-4">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className="mt-1 truncate text-2xl font-semibold tabular-nums" title={String(valor)}>{valor}</p>
      {detalle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{detalle}</p>}
    </div>
  );
}

/**
 * Funcionalidad "Mis estadísticas": panel personal — cada persona ve
 * exclusivamente lo suyo (ver src/app/api/mis-estadisticas/route.ts, que
 * fuerza el filtro al correo de la sesión, nunca a lo que mande esta
 * pantalla). Disponible para quien puede responder chats (ver
 * src/app/mis-estadisticas/page.tsx). Mismo estilo visual que el Dashboard
 * de métricas (src/components/metrics-dashboard.tsx) pero sin desglose por
 * persona — acá solo hay una persona: quien está mirando.
 */
export function MisEstadisticasView() {
  const [rango, setRango] = useState<Rango>(7);
  const [datos, setDatos] = useState<AgregadoRespuestas | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (dias: Rango) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/mis-estadisticas?dias=${dias}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'No se pudieron cargar tus estadísticas');
      setDatos(json as AgregadoRespuestas);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar tus estadísticas');
      setDatos(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar(rango);
  }, [rango, cargar]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex overflow-hidden rounded-md border border-[var(--chat-border-strong)]">
          {RANGOS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRango(r)}
              className={cn(
                'px-3 py-1.5 text-sm',
                r === rango
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-[var(--chat-surface)] text-muted-foreground hover:bg-[var(--chat-hover)]',
              )}
            >
              {r} días
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => cargar(rango)}
          disabled={loading}
          className="h-9 rounded-md"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          <span>Actualizar</span>
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && !datos ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi etiqueta="Chats atendidos" valor={datos?.chatsAtendidos ?? '—'} detalle={`Últimos ${rango} días`} />
            <Kpi etiqueta="Mensajes enviados" valor={datos?.totalMensajes ?? '—'} />
            <Kpi
              etiqueta="Tiempo de respuesta promedio"
              valor={datos?.tiempoRespuestaPromedioSeg != null ? formatearDuracion(datos.tiempoRespuestaPromedioSeg) : '—'}
              detalle={
                datos && datos.mensajesConTiempo < datos.totalMensajes
                  ? `Calculado sobre ${datos.mensajesConTiempo} de ${datos.totalMensajes} mensajes`
                  : undefined
              }
            />
          </div>

          <Seccion titulo={`Tu actividad por hora y día (${rango} días)`}>
            {datos && datos.totalMensajes > 0 ? (
              <MatrizActividad celdas={datos.matrizActividad} />
            ) : (
              <p className="text-sm text-muted-foreground">Todavía no tenés mensajes registrados en este rango.</p>
            )}
          </Seccion>
        </>
      )}
    </div>
  );
}
