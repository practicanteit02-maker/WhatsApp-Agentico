'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, Tags, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchTagsCatalog } from '@/lib/inbox-data';

/**
 * Funcionalidad "Etiquetar Perfiles": pantalla de Ajustes (perfil con
 * permiso "escribir" — ver src/lib/permissions.ts) para crear y eliminar
 * las etiquetas disponibles para clasificar chats (ej. "Modelo X", "Sede
 * Bogotá"). Más simple que Respuestas Rápidas (quick-reply-manager.tsx):
 * una etiqueta no tiene nada más que su propio nombre, así que no hay
 * "editar" — solo crear y borrar.
 */
export function TagsCatalogManager() {
  const { perfil, puede } = usePermissions();
  const canEscribir = puede('escribir');

  const [tags, setTags] = useState<string[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [deletingTag, setDeletingTag] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadTags = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      setTags(await fetchTagsCatalog());
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo de etiquetas');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const canSubmit = newTag.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch('/api/tags-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etiqueta: newTag.trim() }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo crear la etiqueta');

      setNewTag('');
      setShowForm(false);
      await loadTags();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'No se pudo crear la etiqueta');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (etiqueta: string) => {
    if (!window.confirm(`¿Eliminar la etiqueta "${etiqueta}"? Los chats que ya la tengan asignada la conservan, pero no vas a poder volver a elegirla.`)) {
      return;
    }

    setDeletingTag(etiqueta);
    setDeleteError(null);

    try {
      const response = await fetch(`/api/tags-catalog?etiqueta=${encodeURIComponent(etiqueta)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo eliminar la etiqueta');

      await loadTags();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'No se pudo eliminar la etiqueta');
    } finally {
      setDeletingTag(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Etiquetas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tags.length} etiqueta{tags.length === 1 ? '' : 's'} disponible{tags.length === 1 ? '' : 's'} para clasificar chats.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={loadTags}
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
              if (showForm) {
                setShowForm(false);
              } else {
                setNewTag('');
                setSubmitError(null);
                setShowForm(true);
              }
            }}
            disabled={!canEscribir && !showForm}
            className={cn(
              'h-9 rounded-md bg-primary hover:bg-[var(--primary-hover)]',
              !canEscribir && !showForm && 'cursor-not-allowed opacity-50',
            )}
            title={canEscribir || showForm ? undefined : `Tu rol (${perfil}) no tiene permiso para gestionar etiquetas`}
          >
            {showForm ? <X className="size-4" /> : <Plus className="size-4" />}
            <span>{showForm ? 'Cerrar' : 'Nueva etiqueta'}</span>
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

      {showForm && (
        <div className="space-y-3 rounded-lg border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-4">
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">Nombre de la etiqueta</Label>
            <Input
              id="tag-name"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Modelo X"
              className="h-10 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-sm"
            />
          </div>

          {submitError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {submitError}
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
              title={canEscribir ? undefined : `Tu rol (${perfil}) no tiene permiso para gestionar etiquetas`}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : 'Crear etiqueta'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowForm(false)} disabled={submitting} className="h-10 rounded-md">
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {loadingList ? (
        <div className="flex h-24 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : tags.length === 0 ? (
        <div className="rounded-md border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] px-4 py-6 text-center text-sm text-muted-foreground">
          Todavía no hay etiquetas creadas.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {tags.map((tag) => (
            <div
              key={tag}
              className="flex items-center justify-between gap-2 rounded-md border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-3"
            >
              <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium">
                <Tags className="size-3.5 flex-shrink-0 text-[var(--chat-presence)]" />
                <span className="truncate">{tag}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 flex-shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => handleDelete(tag)}
                disabled={deletingTag === tag}
                aria-label={`Eliminar etiqueta ${tag}`}
              >
                {deletingTag === tag ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
