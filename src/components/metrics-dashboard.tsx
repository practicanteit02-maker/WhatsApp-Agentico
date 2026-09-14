'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ExportButton } from '@/components/ui/export-button';
import { MatrizActividad } from '@/components/matriz-actividad';
import { getProfileStyle } from '@/lib/mock-profiles';
import { descargarCSV, filasACSV, unirBloquesCSV } from '@/lib/csv-export';
import type { AgregadoAuditoria } from '@/lib/auditoria';
import type { MetricasChats } from '@/lib/metrics';
import type { AgregadoRespuestas } from '@/lib/respuestas-metrics';

// Mismo orden/nombres que DIAS_LARGO en matriz-actividad.tsx (0 = Lunes) —
// ese archivo no los exporta, así que se repiten acá para el CSV.
const DIAS_SEMANA_CSV = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

type RespuestaMetricas = {
  chats: MetricasChats | null;
  auditoria: AgregadoAuditoria | null;
  respuestas: AgregadoRespuestas | null;
  desde: string;
  hasta: string;
  errores: string[];
};

/** "45s" / "3 min" / "2h 15m" — formato compacto para segundos de tiempo de
 * respuesta, igual de legible en una barra angosta que en el KPI grande. */
function formatearDuracion(segundos: number): string {
  if (segundos < 60) return `${Math.round(segundos)}s`;
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const minutosRestantes = minutos % 60;
  return minutosRestantes > 0 ? `${horas}h ${minutosRestantes}m` : `${horas}h`;
}

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
  valorTexto,
}: {
  etiqueta: React.ReactNode;
  valor: number;
  max: number;
  clase?: string;
  extra?: React.ReactNode;
  /** Texto a mostrar en vez del número crudo de `valor` (ej. "3 min" en vez
   * de "180") — `valor`/`max` siguen siendo los que deciden el ancho de la
   * barra, esto solo cambia lo que se lee. */
  valorTexto?: string;
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
      <span className="w-14 flex-shrink-0 text-right font-medium tabular-nums">{valorTexto ?? valor}</span>
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
 * persona/día y tiempo de respuesta/actividad por hora-día (de
 * "respuestas-panel", ver src/lib/respuestas-metrics.ts) usan el rango de
 * fecha (7/14/30 días).
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
  const respuestas = data?.respuestas ?? null;

  const maxEstado = chats ? Math.max(1, ...Object.values(chats.porEstado)) : 1;
  const maxZona = chats ? Math.max(1, ...Object.values(chats.porZona)) : 1;
  const maxActor = auditoria ? Math.max(1, ...auditoria.porActor.map((a) => a.total)) : 1;
  const maxDia = auditoria ? Math.max(1, ...auditoria.porDia.map((d) => d.total)) : 1;

  const coordinadorTop = auditoria?.porActor[0];

  // Solo entra acá quien tiene al menos un mensaje con el snapshot de
  // tiempo de respuesta (ver el campo opcional en src/lib/respuestas.ts) —
  // mostrar "0" para alguien sin datos se confundiría con "responde
  // instantáneo", así que directamente no aparece en esta sección.
  const actoresConTiempo = (respuestas?.porActor ?? [])
    .filter((a) => a.tiempoRespuestaPromedioSeg !== null)
    .sort((a, b) => (a.tiempoRespuestaPromedioSeg ?? 0) - (b.tiempoRespuestaPromedioSeg ?? 0));
  const maxTiempoRespuesta = Math.max(1, ...actoresConTiempo.map((a) => a.tiempoRespuestaPromedioSeg ?? 0));

  /**
   * Funcionalidad "Exportar CSV": arma un solo archivo con todas las
   * secciones del dashboard (una tabla por sección, separadas por una fila
   * en blanco — ver unirBloquesCSV) a partir de los datos que YA están en
   * memoria (`data`, ya cargado por el fetch de arriba) — sin pedir nada
   * nuevo al backend, a diferencia de auditoria-view.tsx (que sí necesita un
   * fetch aparte por la paginación). Cada bloque arranca con su propio
   * título en una línea, para que alguien sin conocimientos técnicos que
   * abra el CSV en Excel entienda de un vistazo qué está mirando.
   */
  const handleExport = () => {
    if (!data) return;

    const bloques: string[] = [
      'Resumen general\r\n' +
        filasACSV(
          [
            { etiqueta: 'Chats totales', valor: chats?.total },
            { etiqueta: `Acciones (${rango} días)`, valor: auditoria?.totalAcciones },
            { etiqueta: 'Persona más activa', valor: coordinadorTop?.actor },
            { etiqueta: 'Acciones de la persona más activa', valor: coordinadorTop?.total },
            { etiqueta: 'Chats sin número asignado', valor: chats?.porZona['Sin asignar'] },
            {
              etiqueta: 'Tiempo de respuesta promedio del equipo',
              valor:
                respuestas?.tiempoRespuestaPromedioSeg != null
                  ? formatearDuracion(respuestas.tiempoRespuestaPromedioSeg)
                  : undefined,
            },
          ],
          [
            { encabezado: 'Métrica', valor: (f) => f.etiqueta },
            { encabezado: 'Valor', valor: (f) => f.valor },
          ],
        ),
    ];

    if (chats) {
      bloques.push(
        'Chats por estado\r\n' +
          filasACSV(Object.entries(chats.porEstado), [
            { encabezado: 'Estado', valor: ([estado]) => estado },
            { encabezado: 'Chats', valor: ([, valor]) => valor },
          ]),
      );
      bloques.push(
        'Chats por número\r\n' +
          filasACSV(
            Object.entries(chats.porZona).sort((a, b) => b[1] - a[1]),
            [
              { encabezado: 'Número/Zona', valor: ([zona]) => zona },
              { encabezado: 'Chats', valor: ([, valor]) => valor },
            ],
          ),
      );
    }

    if (auditoria) {
      bloques.push(
        `Acciones por persona (${rango} días)\r\n` +
          filasACSV(auditoria.porActor, [
            { encabezado: 'Persona', valor: (a) => a.actor },
            { encabezado: 'Perfil', valor: (a) => a.perfil },
            { encabezado: 'Acciones', valor: (a) => a.total },
          ]),
      );
      bloques.push(
        `Actividad por día (${rango} días)\r\n` +
          filasACSV(auditoria.porDia, [
            { encabezado: 'Día', valor: (d) => d.dia },
            { encabezado: 'Acciones', valor: (d) => d.total },
          ]),
      );
    }

    if (actoresConTiempo.length > 0) {
      bloques.push(
        `Tiempo de respuesta por persona (${rango} días)\r\n` +
          filasACSV(actoresConTiempo, [
            { encabezado: 'Persona', valor: (a) => a.actor },
            { encabezado: 'Perfil', valor: (a) => a.perfil },
            { encabezado: 'Tiempo promedio', valor: (a) => formatearDuracion(a.tiempoRespuestaPromedioSeg ?? 0) },
            { encabezado: 'Tiempo promedio (segundos)', valor: (a) => a.tiempoRespuestaPromedioSeg ?? undefined },
          ]),
      );
    }

    if (respuestas && respuestas.matrizActividad.length > 0) {
      bloques.push(
        `Actividad por hora y día (${rango} días)\r\n` +
          filasACSV(respuestas.matrizActividad, [
            { encabezado: 'Día', valor: (c) => DIAS_SEMANA_CSV[c.diaSemana] ?? c.diaSemana },
            { encabezado: 'Hora', valor: (c) => `${String(c.hora).padStart(2, '0')}:00` },
            { encabezado: 'Mensajes', valor: (c) => c.total },
          ]),
      );
    }

    descargarCSV(unirBloquesCSV(bloques), `metricas_${data.desde}_${data.hasta}.csv`);
  };

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
        <div className="flex items-center gap-2">
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
          <ExportButton onExport={handleExport} disabled={!data} />
        </div>
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi etiqueta="Chats totales" valor={chats?.total ?? '—'} />
            <Kpi etiqueta={`Acciones (${rango} días)`} valor={auditoria?.totalAcciones ?? '—'} />
            <Kpi
              etiqueta="Persona más activa"
              valor={coordinadorTop ? `${coordinadorTop.total}` : '—'}
              detalle={coordinadorTop?.actor}
            />
            <Kpi etiqueta="Chats sin número" valor={chats?.porZona['Sin asignar'] ?? '—'} />
            <Kpi
              etiqueta="Tiempo de respuesta"
              valor={
                respuestas?.tiempoRespuestaPromedioSeg != null
                  ? formatearDuracion(respuestas.tiempoRespuestaPromedioSeg)
                  : '—'
              }
              detalle={`Promedio del equipo (${rango} días)`}
            />
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

          {/* Tiempo de respuesta por persona */}
          <Seccion titulo={`Tiempo de respuesta por persona (${rango} días)`}>
            {actoresConTiempo.length > 0 ? (
              <div className="space-y-2">
                {actoresConTiempo.map((a) => (
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
                    valor={a.tiempoRespuestaPromedioSeg ?? 0}
                    valorTexto={formatearDuracion(a.tiempoRespuestaPromedioSeg ?? 0)}
                    max={maxTiempoRespuesta}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sin datos de tiempo de respuesta en el rango.</p>
            )}
          </Seccion>

          {/* Actividad por hora y día */}
          <Seccion titulo={`Actividad por hora y día (${rango} días)`}>
            {respuestas && respuestas.totalMensajes > 0 ? (
              <MatrizActividad celdas={respuestas.matrizActividad} />
            ) : (
              <p className="text-sm text-muted-foreground">Sin mensajes registrados en el rango.</p>
            )}
          </Seccion>
        </>
      )}
    </div>
  );
}
