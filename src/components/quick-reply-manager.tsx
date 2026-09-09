'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { fetchQuickReplies, type QuickReply } from '@/lib/inbox-data';

function emptyForm(): { atajo: string; mensaje: string } {
  return { atajo: '', mensaje: '' };
}

/**
 * Funcionalidad "Respuestas rápidas": pantalla de Ajustes (perfil con
 * permiso "escribir" — ver src/lib/permissions.ts) para crear, editar y
 * borrar los atajos de texto fijo que se insertan en el chat escribiendo
 * "/" (ver message-view.tsx). Mismo patrón de fetch/estados de carga/error
 * y de formulario crear-o-editar que template-manager.tsx y
 * user-manager.tsx, para mantener el mismo estilo en toda la app.
 */
export function QuickReplyManager() {
  const { perfil, puede } = usePermissions();
  const canEscribir = puede('escribir');

  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingAtajo, setEditingAtajo] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const [deletingAtajo, setDeletingAtajo] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadQuickReplies = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      setQuickReplies(await fetchQuickReplies());
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'No se pudo cargar la lista de atajos');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadQuickReplies();
  }, [loadQuickReplies]);

  const canSubmit = form.atajo.trim().length > 0 && !/\s/.test(form.atajo.trim()) && form.mensaje.trim().length > 0;

  const openCreateForm = () => {
    setEditingAtajo(null);
    setForm(emptyForm());
    setSubmitError(null);
    setSubmitSuccess(null);
    setShowForm(true);
  };

  const openEditForm = (quickReply: QuickReply) => {
    setEditingAtajo(quickReply.atajo);
    setForm({ atajo: quickReply.atajo, mensaje: quickReply.mensaje });
    setSubmitError(null);
    setSubmitSuccess(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingAtajo(null);
    setForm(emptyForm());
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      const response = await fetch('/api/respuestas-rapidas', {
        method: editingAtajo ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          atajo: form.atajo.trim(),
          mensaje: form.mensaje.trim(),
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar el atajo');

      setSubmitSuccess(editingAtajo ? 'Atajo actualizado.' : 'Atajo creado.');
      closeForm();
      await loadQuickReplies();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'No se pudo guardar el atajo');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (atajo: string) => {
    if (!window.confirm(`¿Eliminar el atajo "/${atajo}"? Esta acción no se puede deshacer.`)) {
      return;
    }

    setDeletingAtajo(atajo);
    setDeleteError(null);

    try {
      const response = await fetch(`/api/respuestas-rapidas?atajo=${encodeURIComponent(atajo)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo eliminar el atajo');

      if (editingAtajo === atajo) closeForm();
      await loadQuickReplies();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'No se pudo eliminar el atajo');
    } finally {
      setDeletingAtajo(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Respuestas rápidas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {quickReplies.length} atajo{quickReplies.length === 1 ? '' : 's'} — escribí “/” en un chat para usarlos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={loadQuickReplies}
            disabled={loadingList}
            className="h-9 rounded-md"
          >
            {loadingList ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            <span className="hidden sm:inline">Actualizar</span>
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (!canEscribir && !showForm) return;
              if (showForm) closeForm();
              else openCreateForm();
            }}
            disabled={!canEscribir && !showForm}
            className={cn(
              'h-9 rounded-md bg-primary hover:bg-[var(--primary-hover)]',
              !canEscribir && !showForm && 'cursor-not-allowed opacity-50',
            )}
            title={canEscribir || showForm ? undefined : `Tu rol (${perfil}) no tiene permiso para gestionar atajos`}
          >
            {showForm ? <X className="size-4" /> : <Plus className="size-4" />}
            <span>{showForm ? 'Cerrar' : 'Nuevo atajo'}</span>
          </Button>
        </div>
      </div>

      {listError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {listError}
        </div>
      )}
      {deleteError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {deleteError}
        </div>
      )}

      {loadingList ? (
        <div className="flex h-24 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : quickReplies.length === 0 ? (
        <div className="rounded-md border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] px-4 py-6 text-center text-sm text-muted-foreground">
          Todavía no hay atajos creados.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {quickReplies.map((quickReply) => (
            <div
              key={quickReply.atajo}
              className="rounded-md border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-3"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-primary">/{quickReply.atajo}</span>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-foreground"
                    onClick={() => openEditForm(quickReply)}
                    aria-label={`Editar /${quickReply.atajo}`}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleDelete(quickReply.atajo)}
                    disabled={deletingAtajo === quickReply.atajo}
                    aria-label={`Eliminar /${quickReply.atajo}`}
                  >
                    {deletingAtajo === quickReply.atajo ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{quickReply.mensaje}</p>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="space-y-4 rounded-lg border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-4">
          <h3 className="text-sm font-semibold">{editingAtajo ? `Editar /${editingAtajo}` : 'Nuevo atajo'}</h3>

          <div className="space-y-1.5">
            <Label htmlFor="qr-atajo">Atajo</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">/</span>
              <Input
                id="qr-atajo"
                value={form.atajo}
                disabled={!!editingAtajo}
                onChange={(e) => setForm((current) => ({ ...current, atajo: e.target.value }))}
                placeholder="saludo"
                className="h-10 border-[var(--chat-border-strong)] bg-[var(--chat-input)] pl-6 text-sm disabled:opacity-60"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {editingAtajo
                ? 'El atajo no se puede renombrar — borrá este y creá uno nuevo si necesitás otro nombre.'
                : 'Sin espacios — es lo que se escribe después de "/" en el chat.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qr-mensaje">Mensaje</Label>
            <Textarea
              id="qr-mensaje"
              value={form.mensaje}
              onChange={(e) => setForm((current) => ({ ...current, mensaje: e.target.value }))}
              placeholder="Hola, ¿en qué te puedo ayudar?"
              className="min-h-24 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-sm"
            />
          </div>

          {submitError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {submitError}
            </div>
          )}
          {submitSuccess && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
              {submitSuccess}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || submitting || !canEscribir}
              className={cn(
                'h-10 rounded-md bg-primary hover:bg-[var(--primary-hover)]',
                !canEscribir && 'cursor-not-allowed opacity-50',
              )}
              title={canEscribir ? undefined : `Tu rol (${perfil}) no tiene permiso para gestionar atajos`}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : (editingAtajo ? 'Guardar cambios' : 'Crear atajo')}
            </Button>
            <Button type="button" variant="outline" onClick={closeForm} disabled={submitting} className="h-10 rounded-md">
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
