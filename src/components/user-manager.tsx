'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getProfileStyle, MOCK_ACCOUNT_PROFILES } from '@/lib/mock-profiles';
import { getAssignableZones } from '@/lib/mock-zones';
import type { PanelUser } from '@/lib/panel-users';

const ASSIGNABLE_ZONES = getAssignableZones();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emptyForm(): { correo: string; perfil: string; zona: string } {
  return { correo: '', perfil: MOCK_ACCOUNT_PROFILES[0], zona: '' };
}

/**
 * Funcionalidad "Usuarios": sección de Ajustes (solo Administrador, ver
 * src/app/usuarios/page.tsx) para ver, crear, editar y borrar las cuentas
 * del panel (tabla "usuarios-panel" en DynamoDB — la misma que consulta
 * src/auth.ts al iniciar sesión para saber el perfil y la zona de cada
 * correo). Mismo patrón de fetch/estados de carga/error que
 * template-manager.tsx, para mantener el mismo estilo en toda la app.
 */
export function UserManager() {
  const [users, setUsers] = useState<PanelUser[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingCorreo, setEditingCorreo] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const [deletingCorreo, setDeletingCorreo] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const response = await fetch('/api/usuarios');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo cargar la lista de usuarios');
      setUsers(data.users || []);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'No se pudo cargar la lista de usuarios');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const canSubmit = EMAIL_PATTERN.test(form.correo.trim()) && form.perfil.trim().length > 0;

  const openCreateForm = () => {
    setEditingCorreo(null);
    setForm(emptyForm());
    setSubmitError(null);
    setSubmitSuccess(null);
    setShowForm(true);
  };

  const openEditForm = (user: PanelUser) => {
    setEditingCorreo(user.correo);
    setForm({ correo: user.correo, perfil: user.perfil || MOCK_ACCOUNT_PROFILES[0], zona: user.zona || '' });
    setSubmitError(null);
    setSubmitSuccess(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingCorreo(null);
    setForm(emptyForm());
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      const response = await fetch('/api/usuarios', {
        method: editingCorreo ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correo: form.correo.trim(),
          perfil: form.perfil,
          zona: form.zona,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar el usuario');

      setSubmitSuccess(editingCorreo ? 'Usuario actualizado.' : 'Usuario creado.');
      closeForm();
      await fetchUsers();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'No se pudo guardar el usuario');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (correo: string) => {
    if (!window.confirm(`¿Eliminar al usuario ${correo}? Esta acción no se puede deshacer.`)) {
      return;
    }

    setDeletingCorreo(correo);
    setDeleteError(null);

    try {
      const response = await fetch(`/api/usuarios?correo=${encodeURIComponent(correo)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo eliminar el usuario');

      if (editingCorreo === correo) closeForm();
      await fetchUsers();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'No se pudo eliminar el usuario');
    } finally {
      setDeletingCorreo(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Usuarios</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {users.length} usuario{users.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={fetchUsers}
            disabled={loadingList}
            className="h-9 rounded-md"
          >
            {loadingList ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            <span className="hidden sm:inline">Actualizar</span>
          </Button>
          <Button
            type="button"
            onClick={() => (showForm ? closeForm() : openCreateForm())}
            className="h-9 rounded-md bg-primary hover:bg-[var(--primary-hover)]"
          >
            {showForm ? <X className="size-4" /> : <Plus className="size-4" />}
            <span>{showForm ? 'Cerrar' : 'Nuevo usuario'}</span>
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
      ) : users.length === 0 ? (
        <div className="rounded-md border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] px-4 py-6 text-center text-sm text-muted-foreground">
          Todavía no hay usuarios registrados.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-[var(--chat-border-strong)]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 border-b border-[var(--chat-border-strong)] bg-[var(--chat-hover)] px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Correo</span>
            <span>Perfil</span>
            <span>Zona</span>
            <span className="sr-only">Acciones</span>
          </div>
          {users.map((user) => (
            <div
              key={user.correo}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-b border-[var(--chat-border-strong)] bg-[var(--chat-surface)] px-3 py-2 last:border-b-0"
            >
              <span className="truncate text-sm">{user.correo}</span>
              <Badge
                variant="secondary"
                className="flex-shrink-0 text-[10px]"
                style={{ color: getProfileStyle(user.perfil).color }}
              >
                {user.perfil || 'Sin asignar'}
              </Badge>
              <span className="truncate text-xs text-muted-foreground">{user.zona || 'Sin asignar'}</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 flex-shrink-0 text-muted-foreground hover:bg-[var(--chat-hover)] hover:text-foreground"
                  onClick={() => openEditForm(user)}
                  aria-label={`Editar ${user.correo}`}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 flex-shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => handleDelete(user.correo)}
                  disabled={deletingCorreo === user.correo}
                  aria-label={`Eliminar ${user.correo}`}
                >
                  {deletingCorreo === user.correo ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="space-y-4 rounded-lg border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-4">
          <h3 className="text-sm font-semibold">{editingCorreo ? `Editar ${editingCorreo}` : 'Nuevo usuario'}</h3>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="user-correo">Correo</Label>
              <Input
                id="user-correo"
                type="email"
                value={form.correo}
                disabled={!!editingCorreo}
                onChange={(e) => setForm((current) => ({ ...current, correo: e.target.value }))}
                placeholder="persona@empresa.com"
                className="h-10 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-sm disabled:opacity-60"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-perfil">Perfil</Label>
              <select
                id="user-perfil"
                value={form.perfil}
                onChange={(e) => setForm((current) => ({ ...current, perfil: e.target.value }))}
                className="h-10 w-full rounded-md border border-[var(--chat-border-strong)] bg-[var(--chat-input)] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {MOCK_ACCOUNT_PROFILES.map((profile) => (
                  <option key={profile} value={profile}>{profile}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-zona">Zona</Label>
              <select
                id="user-zona"
                value={form.zona}
                onChange={(e) => setForm((current) => ({ ...current, zona: e.target.value }))}
                className="h-10 w-full rounded-md border border-[var(--chat-border-strong)] bg-[var(--chat-input)] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <option value="">Sin asignar</option>
                {ASSIGNABLE_ZONES.map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </select>
            </div>
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
              disabled={!canSubmit || submitting}
              className={cn('h-10 rounded-md bg-primary hover:bg-[var(--primary-hover)]')}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : (editingCorreo ? 'Guardar cambios' : 'Crear usuario')}
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
