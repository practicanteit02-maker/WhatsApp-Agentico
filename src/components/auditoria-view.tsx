'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { RegistroAuditoria } from '@/lib/auditoria';
import type { PanelUser } from '@/lib/panel-users';

const ZONA_HORARIA = 'America/Bogota';

/** `YYYY-MM-DD` de hoy en Bogotá — mismo criterio que el server (en-CA
 * formatea justo así), para que el rango por defecto que muestran los
 * inputs coincida con el que aplicaría el endpoint si no mandáramos fechas. */
function diaBogota(fecha: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(fecha);
}

function restarDias(dia: string, n: number): string {
  const [y, m, d] = dia.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() - n);
  return fecha.toISOString().slice(0, 10);
}

type AccionInfo = { label: string; grupo: 'Chats' | 'Plantillas' | 'Usuarios'; clase: string };

const ACCIONES: Record<string, AccionInfo> = {
  cambio_zona: { label: 'Cambio de zona', grupo: 'Chats', clase: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300' },
  cambio_estado: { label: 'Cambio de estado', grupo: 'Chats', clase: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300' },
  asignar_etiqueta: { label: 'Etiqueta asignada', grupo: 'Chats', clase: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  editar_etiqueta: { label: 'Etiqueta editada', grupo: 'Chats', clase: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  quitar_etiqueta: { label: 'Etiqueta quitada', grupo: 'Chats', clase: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  crear_plantilla: { label: 'Plantilla creada', grupo: 'Plantillas', clase: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300' },
  crear_usuario: { label: 'Usuario creado', grupo: 'Usuarios', clase: 'bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300' },
  editar_usuario: { label: 'Usuario editado', grupo: 'Usuarios', clase: 'bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300' },
  eliminar_usuario: { label: 'Usuario eliminado', grupo: 'Usuarios', clase: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
};

const GRUPOS: Array<{ nombre: 'Chats' | 'Plantillas' | 'Usuarios'; acciones: string[] }> = [
  { nombre: 'Chats', acciones: Object.keys(ACCIONES).filter((k) => ACCIONES[k].grupo === 'Chats') },
  { nombre: 'Plantillas', acciones: Object.keys(ACCIONES).filter((k) => ACCIONES[k].grupo === 'Plantillas') },
  { nombre: 'Usuarios', acciones: Object.keys(ACCIONES).filter((k) => ACCIONES[k].grupo === 'Usuarios') },
];

const OBJETO_LABEL: Record<string, string> = { chat: 'Chat', plantilla: 'Plantilla', usuario: 'Usuario' };

const ROLES_FILTRO = ['Administrador', 'Coordinadora', 'QA'];

function accionLabel(accion: string): string {
  return ACCIONES[accion]?.label ?? accion;
}

function formatearFecha(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  return fecha.toLocaleString('es-CO', {
    timeZone: ZONA_HORARIA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const SELECT_CLASS =
  'h-10 w-full rounded-md border border-[var(--chat-border-strong)] bg-[var(--chat-input)] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/**
 * Funcionalidad "Historial de auditoría": tabla filtrable de quién cambió
 * qué y cuándo. Solo Administrador llega hasta acá (ver
 * src/app/auditoria/page.tsx). Mismo estilo de fetch/estados de carga que
 * user-manager.tsx. El filtro principal es "por persona", porque el caso de
 * uso es revisar qué hizo cada Coordinador.
 */
export function AuditoriaView() {
  const hoy = useMemo(() => diaBogota(), []);

  const [actor, setActor] = useState('');
  const [perfil, setPerfil] = useState('');
  const [desde, setDesde] = useState(() => restarDias(hoy, 6));
  const [hasta, setHasta] = useState(hoy);
  const [accionesSel, setAccionesSel] = useState<string[]>([]);

  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [usuarios, setUsuarios] = useState<PanelUser[]>([]);

  useEffect(() => {
    let cancelado = false;
    fetch('/api/usuarios')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelado && data?.users) setUsuarios(data.users as PanelUser[]);
      })
      .catch(() => {
        /* la lista de personas es una comodidad del filtro, no bloquea la pantalla */
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const construirParams = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      params.set('desde', desde);
      params.set('hasta', hasta);
      if (actor) params.set('actor', actor);
      if (perfil) params.set('perfil', perfil);
      for (const accion of accionesSel) params.append('accion', accion);
      if (cursor) params.set('cursor', cursor);
      return params;
    },
    [desde, hasta, actor, perfil, accionesSel],
  );

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/auditoria?${construirParams().toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo cargar el historial');
      setRegistros(data.registros || []);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el historial');
      setRegistros([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [construirParams]);

  const cargarMas = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetch(`/api/auditoria?${construirParams(nextCursor).toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo cargar más');
      setRegistros((prev) => [...prev, ...(data.registros || [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar más');
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, construirParams]);

  // Carga inicial. Los cambios de filtro NO refetchean solos: la persona
  // ajusta todo y aprieta "Aplicar" (evita una ráfaga de queries mientras
  // tantea el rango de fechas o marca varias acciones).
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleAccion = (accion: string) => {
    setAccionesSel((prev) =>
      prev.includes(accion) ? prev.filter((a) => a !== accion) : [...prev, accion],
    );
  };

  const limpiar = () => {
    setActor('');
    setPerfil('');
    setDesde(restarDias(hoy, 6));
    setHasta(hoy);
    setAccionesSel([]);
  };

  return (
    <section className="space-y-4">
      {/* Filtros */}
      <div className="space-y-4 rounded-lg border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="aud-persona">Persona</Label>
            <select
              id="aud-persona"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Todas</option>
              {usuarios.map((u) => (
                <option key={u.correo} value={u.correo}>
                  {u.correo}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aud-rol">Rol</Label>
            <select
              id="aud-rol"
              value={perfil}
              onChange={(e) => setPerfil(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Todos</option>
              {ROLES_FILTRO.map((rol) => (
                <option key={rol} value={rol}>
                  {rol}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aud-desde">Desde</Label>
            <input
              id="aud-desde"
              type="date"
              value={desde}
              max={hasta}
              onChange={(e) => setDesde(e.target.value)}
              className={SELECT_CLASS}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aud-hasta">Hasta</Label>
            <input
              id="aud-hasta"
              type="date"
              value={hasta}
              min={desde}
              max={hoy}
              onChange={(e) => setHasta(e.target.value)}
              className={SELECT_CLASS}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Tipo de acción</Label>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {GRUPOS.map((grupo) => (
              <div key={grupo.nombre} className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{grupo.nombre}</p>
                <div className="flex flex-wrap gap-3">
                  {grupo.acciones.map((accion) => (
                    <label key={accion} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={accionesSel.includes(accion)}
                        onChange={() => toggleAccion(accion)}
                        className="size-4 rounded border-[var(--chat-border-strong)] accent-primary"
                      />
                      {ACCIONES[accion].label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Sin marcar ninguna se muestran todas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={cargar}
            disabled={loading}
            className="h-9 rounded-md bg-primary hover:bg-[var(--primary-hover)]"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            <span>Aplicar</span>
          </Button>
          <Button type="button" variant="outline" onClick={limpiar} disabled={loading} className="h-9 rounded-md">
            <RotateCcw className="size-4" />
            <span>Limpiar</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Listado */}
      {loading ? (
        <div className="flex h-24 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : registros.length === 0 ? (
        <div className="rounded-md border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] px-4 py-6 text-center text-sm text-muted-foreground">
          No hay registros para estos filtros.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-[var(--chat-border-strong)]">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--chat-border-strong)] bg-[var(--chat-hover)] text-left text-xs font-medium text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Fecha y hora</th>
                  <th className="px-3 py-2 font-medium">Persona</th>
                  <th className="px-3 py-2 font-medium">Rol</th>
                  <th className="px-3 py-2 font-medium">Acción</th>
                  <th className="px-3 py-2 font-medium">Objeto</th>
                  <th className="px-3 py-2 font-medium">Antes → Después</th>
                </tr>
              </thead>
              <tbody>
                {registros.map((r) => (
                  <tr
                    key={r.ts}
                    className="border-b border-[var(--chat-border-strong)] align-top last:border-b-0"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                      {formatearFecha(r.fecha)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="block max-w-[16rem] truncate" title={r.actor}>
                        {r.actor}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                      {r.actorPerfil}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Badge
                        variant="secondary"
                        className={cn('text-[10px]', ACCIONES[r.accion]?.clase)}
                      >
                        {accionLabel(r.accion)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {OBJETO_LABEL[r.objetoTipo] ?? r.objetoTipo}
                      </span>
                      <span
                        className="block max-w-[18rem] truncate font-mono text-xs"
                        title={r.objetoId}
                      >
                        {r.objetoId}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.detalle ? (
                        <span className="text-muted-foreground">{r.detalle}</span>
                      ) : r.valorAnterior != null || r.valorNuevo != null ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-[var(--chat-hover)] px-1.5 py-0.5 text-muted-foreground">
                            {r.valorAnterior ?? '—'}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="rounded bg-[var(--chat-hover)] px-1.5 py-0.5 font-medium">
                            {r.valorNuevo ?? '—'}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {registros.length} registro{registros.length === 1 ? '' : 's'}
              {nextCursor ? ' (hay más)' : ''}
            </p>
            {nextCursor && (
              <Button
                type="button"
                variant="outline"
                onClick={cargarMas}
                disabled={loadingMore}
                className="h-9 rounded-md"
              >
                {loadingMore ? <Loader2 className="size-4 animate-spin" /> : null}
                <span>Cargar más</span>
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
