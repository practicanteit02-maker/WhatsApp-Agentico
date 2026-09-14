'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type ExportButtonProps = {
  /** Arma y dispara la descarga del CSV. Puede ser sync (ej. métricas, con
   * todo ya en memoria) o async (ej. auditoría, que primero pide TODO el
   * rango filtrado al backend antes de armar el archivo) — mientras esté en
   * vuelo, el botón se deshabilita y cambia el ícono por un spinner, para
   * que no se pueda disparar un export encima de otro ni parezca que no
   * pasó nada durante la espera. Errores propios (ej. el fetch del export
   * falló) los debe manejar el callback, este botón no los atrapa. */
  onExport: () => void | Promise<void>;
  label?: string;
  className?: string;
  disabled?: boolean;
};

/**
 * Botón de "Exportar CSV" reutilizable entre el Dashboard de métricas
 * (metrics-dashboard.tsx) y el Historial de auditoría (auditoria-view.tsx)
 * — solo la mecánica del botón (ícono, estado de carga, deshabilitado) vive
 * acá; qué filas exportar y cómo armarlas es responsabilidad de cada
 * pantalla, porque los datos son demasiado distintos entre sí (agregados en
 * un solo fetch vs. una lista paginada) como para compartir esa parte.
 */
export function ExportButton({ onExport, label = 'Exportar CSV', className, disabled }: ExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  const handleClick = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await onExport();
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={disabled || exporting}
      className={cn('h-9 rounded-md', className)}
    >
      {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
      <span>{label}</span>
    </Button>
  );
}
