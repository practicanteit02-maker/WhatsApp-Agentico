import type { CeldaActividad } from '@/lib/respuestas-metrics';

const DIAS_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_LARGO = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/**
 * Heatmap "hora del día × día de la semana": cuántos mensajes salientes se
 * mandaron en cada combinación. Componente compartido entre el Dashboard de
 * métricas (todo el equipo, ver metrics-dashboard.tsx) y "Mis estadísticas"
 * (una sola persona, ver mis-estadisticas-view.tsx) — mismo dibujo, datos
 * distintos según quién lo use.
 *
 * A mano con Tailwind, sin librería de gráficos (mismo criterio que el
 * resto del dashboard). La intensidad de cada celda usa `color-mix()` para
 * mezclar el `--primary` de la app hacia el fondo neutro `--chat-hover` —
 * así una celda en 0 mensajes no queda "vacía"/blanca, se funde con el
 * fondo de la sección en vez de destacar como un hueco.
 *
 * 24 filas (una por hora) × 7 columnas (Lun-Dom) — las etiquetas de hora
 * solo se muestran cada 3 horas para no saturar, pero las 24 filas-celda
 * están todas ahí; cada celda tiene su tooltip con el valor exacto.
 */
export function MatrizActividad({ celdas }: { celdas: CeldaActividad[] }) {
  const max = Math.max(1, ...celdas.map((c) => c.total));
  const porClave = new Map(celdas.map((c) => [`${c.diaSemana}-${c.hora}`, c.total]));

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex flex-col gap-0.5">
        <div className="flex gap-0.5">
          <span className="w-7 flex-shrink-0" aria-hidden="true" />
          {DIAS_CORTO.map((dia) => (
            <span
              key={dia}
              className="w-5 flex-shrink-0 text-center text-[9px] font-medium text-muted-foreground"
            >
              {dia}
            </span>
          ))}
        </div>
        {Array.from({ length: 24 }, (_, hora) => (
          <div key={hora} className="flex items-center gap-0.5">
            <span className="w-7 flex-shrink-0 text-right text-[9px] tabular-nums text-muted-foreground">
              {hora % 3 === 0 ? String(hora).padStart(2, '0') : ''}
            </span>
            {DIAS_CORTO.map((_, diaSemana) => {
              const total = porClave.get(`${diaSemana}-${hora}`) ?? 0;
              const intensidad = Math.round((total / max) * 100);
              return (
                <div
                  key={diaSemana}
                  className="size-5 flex-shrink-0 rounded-sm"
                  style={{
                    backgroundColor: `color-mix(in srgb, var(--primary) ${intensidad}%, var(--chat-hover))`,
                  }}
                  title={`${DIAS_LARGO[diaSemana]} ${String(hora).padStart(2, '0')}:00 — ${total} ${total === 1 ? 'mensaje' : 'mensajes'}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
