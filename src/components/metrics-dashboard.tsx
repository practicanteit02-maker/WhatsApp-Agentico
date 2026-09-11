'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { getProfileStyle } from '@/lib/mock-profiles';
import type { AgregadoAuditoria } from '@/lib/auditoria';
import type { MetricasChats } from '@/lib/metrics';

type RespuestaMetricas = {
  chats: MetricasChats | null;
  auditoria: AgregadoAuditoria | null;
  desde: string;
  hasta: string;
  errores: string[];
};

const RANGOS = [7, 14, 30] as const;
type Rango = (typeof RANGOS)[number];

const ESTADO_CLASE: Record<string, string> = {
  Nuevo: 'bg-blue-500 dark:bg-blue-400',
  'En proceso': 'bg-amber-500 dark:bg-amber-400',
  Cerrado: 'bg-emerald-500 dark:bg-emerald-400',
};

function diaCorto(dia: string): string {
  const [, m, d] = dia.split('-');
  return d && m ? `${d}/${m}` : dia;
}

function diaLargo(dia: string): string {
  const [y, m, d] = dia.split('-').map(Number);
  if (!y || !m || !d) return dia;
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

/** Fila de barra horizontal: etiqueta a la izquierda, pista + relleno
 * proporcional al máximo, y el número a la derecha. */
function BarraHorizontal({
  etiqueta,
  valor,
  max,
  clase,
  extra,
}: {
  etiqueta: React.ReactNode;
  valor: number;
  max: number;
  clase?: string;
  extra?: React.ReactNode;
}) {
  const ancho = max > 0 ? Math.max((valor / max) * 100, valor > 0 ? 3 : 0) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="flex w-40 flex-shrink-0 items-center gap-1.5 truncate" title={typeof etiqueta === 'string' ? etiqueta : undefined}>
        {etiqueta}
      </div>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--chat-hover)]">
        <div className={cn('h-full rounded-full', clase ?? 'bg-primary')} style={{ width: `${ancho}%` }} />
      </div>
      <span className="w-10 flex-shrink-0 text-right font-medium tabular-nums">{valor}</span>
      {extra}
    </div>
  );
}

function Seccion({ titulo, children, aviso }: { titulo: string; children: React.ReactNode; aviso?: string }) {
  return (
    <section className="space-y-3 rounded-lg border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {aviso && <span className="text-xs text-amber-600 dark:text-amber-400">{aviso}</span>}
      </div>
      {children}
    </section>
  );
}

function Kpi({ etiqueta, valor, detalle }: { etiqueta: string; valor: string | number; detalle?: string }) {
  return (
    <div className="rounded-lg border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-4">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className="mt-1 truncate text-2xl font-semibold tabular-nums" title={String(valor)}>{valor}</p>
      {detalle && <p className="mt-0.5 truncate text-xs text-muted-foreground" title={detalle}>{detalle}</p>}
    </div>
  );
}

/**
 * Funcionalidad "Dashboard de métricas": solo Administrador llega hasta acá
 * (ver src/app/metricas/page.tsx). Todos los números vienen ya calculados de
 * /api/metrics; acá solo se dibujan, a mano con Tailwind (sin librería de
 * gráficos). Chats por estado/zona son una foto del momento; acciones por
 * persona / por día usan el rango de fecha (7/14/30 días).
 */
export function MetricsDashboard() {
  const [rango, setRango] = useState<Rango>(7);
  const [data, setData] = useState<RespuestaMetricas | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (dias: Rango) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/metrics?dias=${dias}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'No se pudieron cargar las métricas');
      setData(json as RespuestaMetricas);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las métricas');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar(rango);
  }, [rango, cargar]);

  const chats = data?.chats ?? null;
  const auditoria = data?.auditoria ?? null;

  const maxEstado = chats ? Math.max(1, ...Object.values(chats.porEstado)) : 1;
  const maxZona = chats ? Math.max(1, ...Object.values(chats.porZona)) : 1;
  const maxActor = auditoria ? Math.max(1, ...auditoria.porActor.map((a) => a.total)) : 1;
  const maxDia = auditoria ? Math.max(1, ...auditoria.porDia.map((d) => d.total)) : 1;

  const coordinadorTop = auditoria?.porActor[0];

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
      {data?.errores?.map((e) => (
        <div
          key={e}
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        >
          {e}
        </div>
      ))}

      {loading && !data ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi etiqueta="Chats totales" valor={chats?.total ?? '—'} />
            <Kpi etiqueta={`Acciones (${rango} días)`} valor={auditoria?.totalAcciones ?? '—'} />
            <Kpi
              etiqueta="Persona más activa"
              valor={coordinadorTop ? `${coordinadorTop.total}` : '—'}
              detalle={coordinadorTop?.actor}
            />
            <Kpi etiqueta="Chats sin número" valor={chats?.porZona['Sin asignar'] ?? '—'} />
          </div>

          {/* Chats por estado */}
          <Seccion
            titulo="Chats por estado"
            aviso={chats?.muestraParcial ? 'Muestra parcial (tope de páginas)' : undefined}
          >
            {chats ? (
              <div className="space-y-2">
                {Object.entries(chats.porEstado).map(([estado, valor]) => (
                  <BarraHorizontal
                    key={estado}
                    etiqueta={estado}
                    valor={valor}
                    max={maxEstado}
                    clase={ESTADO_CLASE[estado]}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No disponible.</p>
            )}
          </Seccion>

          {/* Chats por zona */}
          <Seccion
            titulo="Chats por número"
            aviso={chats?.muestraParcial ? 'Muestra parcial (tope de páginas)' : undefined}
          >
            {chats ? (
              <div className="space-y-2">
                {Object.entries(chats.porZona)
                  .sort((a, b) => b[1] - a[1])
                  .map(([zona, valor]) => (
                    <BarraHorizontal
                      key={zona}
                      etiqueta={
                        <span className={zona === 'Sin asignar' ? 'text-muted-foreground' : undefined}>{zona}</span>
                      }
                      valor={valor}
                      max={maxZona}
                    />
                  ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No disponible.</p>
            )}
          </Seccion>

          {/* Acciones por persona */}
          <Seccion titulo={`Acciones por persona (${rango} días)`}>
            {auditoria && auditoria.porActor.length > 0 ? (
              <div className="space-y-2">
                {auditoria.porActor.map((a) => (
                  <BarraHorizontal
                    key={a.actor}
                    etiqueta={
                      <span className="flex items-center gap-1.5 truncate">
                        <span
                          className="size-2 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: getProfileStyle(a.perfil).color }}
                          title={a.perfil}
                        />
                        <span className="truncate">{a.actor}</span>
                      </span>
                    }
                    valor={a.total}
                    max={maxActor}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sin acciones registradas en el rango.</p>
            )}
          </Seccion>

          {/* Actividad por día */}
          <Seccion titulo={`Actividad por día (${rango} días)`}>
            {auditoria && auditoria.porDia.length > 0 ? (
              <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ minHeight: '8rem' }}>
                {auditoria.porDia.map((d) => (
                  <div key={d.dia} className="flex min-w-[1.25rem] flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-primary"
                      style={{ height: `${Math.max((d.total / maxDia) * 6, d.total > 0 ? 0.35 : 0.1)}rem` }}
                      title={`${diaLargo(d.dia)}: ${d.total} ${d.total === 1 ? 'acción' : 'acciones'}`}
                    />
                    <span className="text-[10px] leading-none text-muted-foreground">{diaCorto(d.dia)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sin actividad en el rango.</p>
            )}
          </Seccion>
        </>
      )}
    </div>
  );
}
