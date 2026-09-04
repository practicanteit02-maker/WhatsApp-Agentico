'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import type { Template, TemplateComponent } from '@/types/whatsapp';

// Mismo patrón de formato de WhatsApp (negrita, cursiva, etc.) que usa
// template-composer.tsx para su vista previa — copiado acá en vez de
// compartido para no acoplar este archivo al de la vista de chat.
const WHATSAPP_FORMATTING_PATTERN =
  /\*(\S(?:[^*]*\S)?)\*|_(\S(?:[^_]*\S)?)_|~(\S(?:[^~]*\S)?)~|```(\S(?:[^`]*\S)?)```/g;

function formatWhatsAppText(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(WHATSAPP_FORMATTING_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));

    const [, bold, italic, strike, mono] = match;
    if (bold !== undefined) nodes.push(<strong key={key++}>{bold}</strong>);
    else if (italic !== undefined) nodes.push(<em key={key++}>{italic}</em>);
    else if (strike !== undefined) nodes.push(<s key={key++}>{strike}</s>);
    else if (mono !== undefined) nodes.push(<code key={key++} className="font-mono text-[0.9em]">{mono}</code>);

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'UTILITY', label: 'Utilidad' },
  { value: 'MARKETING', label: 'Marketing' },
  { value: 'AUTHENTICATION', label: 'Autenticación' },
];

const LANGUAGE_SUGGESTIONS = ['es', 'es_CO', 'es_MX', 'es_AR', 'es_ES', 'en_US', 'en_GB', 'pt_BR'];

function categoryBadgeClass(category: string): string {
  switch (category) {
    case 'MARKETING':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300';
    case 'UTILITY':
      return 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300';
    case 'AUTHENTICATION':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-white/10 dark:text-gray-300';
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'APPROVED':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300';
    case 'PENDING':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300';
    case 'REJECTED':
    case 'DISABLED':
      return 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-white/10 dark:text-gray-300';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'APPROVED': return 'Aprobada';
    case 'PENDING': return 'En revisión';
    case 'REJECTED': return 'Rechazada';
    case 'DISABLED': return 'Deshabilitada';
    case 'PAUSED': return 'Pausada';
    case 'IN_APPEAL': return 'En apelación';
    default: return status;
  }
}

function getComponent(template: Template, type: string): TemplateComponent | undefined {
  return template.components?.find((component) => component.type === type);
}

/** Cuenta cuántos {{...}} hay en un texto, sin importar qué haya adentro
 * (número o nombre) — la API los renumera en orden de aparición. */
function countVariables(text: string): number {
  return (text.match(/\{\{[^{}]*\}\}/g) ?? []).length;
}

// A diferencia del cuerpo, Meta no acepta saltos de línea, marcado de
// formato (*negrita*, _cursiva_, ~tachado~, `monoespaciado`) ni emojis en el
// encabezado de una plantilla — lo rechaza recién al mandar la solicitud,
// con un error en inglés ("Header Format is Incorrect: ..."). Se valida acá
// mismo para avisar antes de intentar crearla.
function getHeaderFormatError(text: string): string | null {
  if (!text) return null;
  if (/[\r\n]/.test(text)) return 'El encabezado no puede tener saltos de línea.';
  if (/[*_~`]/.test(text)) return 'El encabezado no puede tener formato (negrita, cursiva, tachado o monoespaciado).';
  if (/\p{Extended_Pictographic}/u.test(text)) return 'El encabezado no puede tener emojis.';
  return null;
}

function applyExamplesToText(text: string, examples: string[]): string {
  let index = 0;
  return text.replace(/\{\{[^{}]*\}\}/g, () => {
    const example = examples[index]?.trim();
    index += 1;
    return example || `[variable ${index}]`;
  });
}

type ButtonDraft =
  | { id: string; type: 'QUICK_REPLY'; text: string }
  | { id: string; type: 'URL'; text: string; url: string }
  | { id: string; type: 'PHONE_NUMBER'; text: string; phoneNumber: string };

function emptyButton(type: ButtonDraft['type']): ButtonDraft {
  const id = crypto.randomUUID();
  if (type === 'URL') return { id, type, text: '', url: '' };
  if (type === 'PHONE_NUMBER') return { id, type, text: '', phoneNumber: '' };
  return { id, type: 'QUICK_REPLY', text: '' };
}

type Props = {
  phoneNumberId?: string;
};

/**
 * Funcionalidad "Crear plantillas": sección de Ajustes para ver las
 * plantillas de WhatsApp ya existentes y crear nuevas sin salir de la app —
 * antes esto solo se podía hacer desde Meta Business Manager. Una plantilla
 * nueva queda "En revisión" hasta que Meta la aprueba (o la rechaza); acá
 * solo se manda la solicitud de creación.
 */
export function TemplateManager({ phoneNumberId }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('UTILITY');
  const [language, setLanguage] = useState('es');
  const [headerText, setHeaderText] = useState('');
  const [headerExample, setHeaderExample] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [bodyExamples, setBodyExamples] = useState<string[]>([]);
  const [footerText, setFooterText] = useState('');
  const [buttons, setButtons] = useState<ButtonDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (phoneNumberId) params.set('phoneNumberId', phoneNumberId);
      const response = await fetch(`/api/templates${params.size ? `?${params.toString()}` : ''}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load templates');
      setTemplates(data.data || []);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoadingList(false);
    }
  }, [phoneNumberId]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const headerVariableCount = useMemo(() => countVariables(headerText), [headerText]);
  const headerFormatError = useMemo(() => getHeaderFormatError(headerText), [headerText]);
  const bodyVariableCount = useMemo(() => countVariables(bodyText), [bodyText]);

  // Mantiene el arreglo de ejemplos del cuerpo del mismo tamaño que la
  // cantidad de variables detectadas en el texto, sin perder lo ya escrito.
  useEffect(() => {
    setBodyExamples((current) => {
      if (current.length === bodyVariableCount) return current;
      const next = current.slice(0, bodyVariableCount);
      while (next.length < bodyVariableCount) next.push('');
      return next;
    });
  }, [bodyVariableCount]);

  const previewHeader = headerText.trim() ? applyExamplesToText(headerText, [headerExample]) : null;
  const previewBody = bodyText.trim() ? applyExamplesToText(bodyText, bodyExamples) : '';

  const resetForm = () => {
    setName('');
    setCategory('UTILITY');
    setLanguage('es');
    setHeaderText('');
    setHeaderExample('');
    setBodyText('');
    setBodyExamples([]);
    setFooterText('');
    setButtons([]);
  };

  const canAddButton = buttons.length < 3;
  const canSubmit =
    name.trim().length > 0 &&
    bodyText.trim().length > 0 &&
    headerVariableCount <= 1 &&
    !headerFormatError &&
    (headerVariableCount === 0 || headerExample.trim().length > 0) &&
    bodyExamples.every((example) => example.trim().length > 0) &&
    buttons.every((button) => {
      if (!button.text.trim()) return false;
      if (button.type === 'URL') return button.url.trim().length > 0;
      if (button.type === 'PHONE_NUMBER') return button.phoneNumber.trim().length > 0;
      return true;
    });

  const handleAddButton = (type: ButtonDraft['type']) => {
    if (!canAddButton) return;
    setButtons((current) => [...current, emptyButton(type)]);
  };

  const handleRemoveButton = (id: string) => {
    setButtons((current) => current.filter((button) => button.id !== id));
  };

  const handleUpdateButton = (id: string, patch: Partial<ButtonDraft>) => {
    setButtons((current) =>
      current.map((button) => (button.id === id ? ({ ...button, ...patch } as ButtonDraft) : button)),
    );
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumberId,
          name,
          category,
          language,
          headerText: headerText.trim() || undefined,
          headerExample: headerExample.trim() || undefined,
          bodyText,
          bodyExamples,
          footerText: footerText.trim() || undefined,
          buttons: buttons.length > 0
            ? buttons.map((button) => {
                if (button.type === 'URL') return { type: button.type, text: button.text, url: button.url };
                if (button.type === 'PHONE_NUMBER') return { type: button.type, text: button.text, phoneNumber: button.phoneNumber };
                return { type: button.type, text: button.text };
              })
            : undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create template');

      setSubmitSuccess(`Plantilla enviada — quedó "${statusLabel(data.status || 'PENDING')}".`);
      resetForm();
      await fetchTemplates();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create template');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Plantillas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {templates.length} plantilla{templates.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={fetchTemplates}
            disabled={loadingList}
            className="h-9 rounded-md"
          >
            {loadingList ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            <span className="hidden sm:inline">Actualizar</span>
          </Button>
          <Button
            type="button"
            onClick={() => {
              setShowForm((current) => !current);
              setSubmitError(null);
              setSubmitSuccess(null);
            }}
            className="h-9 rounded-md bg-primary hover:bg-[var(--primary-hover)]"
          >
            {showForm ? <X className="size-4" /> : <Plus className="size-4" />}
            <span>{showForm ? 'Cerrar' : 'Nueva plantilla'}</span>
          </Button>
        </div>
      </div>

      {listError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {listError}
        </div>
      )}

      {loadingList ? (
        <div className="flex h-24 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-md border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] px-4 py-6 text-center text-sm text-muted-foreground">
          Todavía no tenés plantillas.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {templates.map((template) => {
            const bodyComponent = getComponent(template, 'BODY');
            return (
              <div
                key={template.id}
                className="rounded-md border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-3"
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{template.name}</span>
                  <Badge variant="secondary" className={cn('flex-shrink-0 text-[10px]', categoryBadgeClass(template.category))}>
                    {template.category}
                  </Badge>
                  <Badge variant="secondary" className={cn('flex-shrink-0 text-[10px]', statusBadgeClass(template.status))}>
                    {statusLabel(template.status)}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">{template.language}</span>
                </div>
                {bodyComponent?.text && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{bodyComponent.text}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <div className="space-y-5 rounded-lg border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Nombre</Label>
              <Input
                id="tpl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ej. confirmacion_pedido"
                className="h-10 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-sm"
              />
              <p className="text-xs text-muted-foreground">Se ajusta solo a minúsculas y guion bajo.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-category">Categoría</Label>
              <select
                id="tpl-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-10 w-full rounded-md border border-[var(--chat-border-strong)] bg-[var(--chat-input)] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-language">Idioma</Label>
              <Input
                id="tpl-language"
                list="tpl-language-options"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="es"
                className="h-10 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-sm"
              />
              <datalist id="tpl-language-options">
                {LANGUAGE_SUGGESTIONS.map((code) => <option key={code} value={code} />)}
              </datalist>
            </div>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label htmlFor="tpl-header">Encabezado (opcional)</Label>
            <Input
              id="tpl-header"
              value={headerText}
              onChange={(e) => setHeaderText(e.target.value)}
              placeholder="ej. Confirmación de tu pedido {{1}}"
              className="h-10 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-sm"
            />
            {headerFormatError && (
              <p className="text-xs text-destructive">{headerFormatError}</p>
            )}
            {headerVariableCount > 1 && (
              <p className="text-xs text-destructive">El encabezado solo puede tener una variable.</p>
            )}
            {headerVariableCount === 1 && (
              <Input
                value={headerExample}
                onChange={(e) => setHeaderExample(e.target.value)}
                placeholder="Ejemplo de la variable del encabezado"
                className="h-10 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-sm"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-body">Cuerpo</Label>
            <Textarea
              id="tpl-body"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder={'Hola {{1}}, tu pedido #{{2}} ya está en camino.'}
              className="min-h-24 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-sm"
            />
            <p className="text-xs text-muted-foreground">Usá {'{{1}}'}, {'{{2}}'}... para las variables.</p>
            {bodyVariableCount > 0 && (
              <div className="space-y-2 pt-1">
                {Array.from({ length: bodyVariableCount }).map((_, index) => (
                  <Input
                    key={index}
                    value={bodyExamples[index] ?? ''}
                    onChange={(e) =>
                      setBodyExamples((current) => {
                        const next = [...current];
                        next[index] = e.target.value;
                        return next;
                      })
                    }
                    placeholder={`Ejemplo de la variable {{${index + 1}}}`}
                    className="h-10 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-sm"
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-footer">Pie de página (opcional)</Label>
            <Input
              id="tpl-footer"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              placeholder="ej. Omg it lab"
              className="h-10 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-sm"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Botones (opcional, hasta 3)</Label>
              {canAddButton && (
                <div className="flex gap-1.5">
                  <Button type="button" variant="outline" size="sm" className="h-7 rounded-md text-xs" onClick={() => handleAddButton('QUICK_REPLY')}>
                    + Respuesta rápida
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 rounded-md text-xs" onClick={() => handleAddButton('URL')}>
                    + Enlace
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 rounded-md text-xs" onClick={() => handleAddButton('PHONE_NUMBER')}>
                    + Teléfono
                  </Button>
                </div>
              )}
            </div>

            {buttons.map((button) => (
              <div key={button.id} className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--chat-border-strong)] p-2">
                <Badge variant="outline" className="flex-shrink-0 text-[10px]">
                  {button.type === 'QUICK_REPLY' ? 'Respuesta rápida' : button.type === 'URL' ? 'Enlace' : 'Teléfono'}
                </Badge>
                <Input
                  value={button.text}
                  onChange={(e) => handleUpdateButton(button.id, { text: e.target.value })}
                  placeholder="Texto del botón"
                  className="h-9 min-w-0 flex-1 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-sm"
                />
                {button.type === 'URL' && (
                  <Input
                    value={button.url}
                    onChange={(e) => handleUpdateButton(button.id, { url: e.target.value })}
                    placeholder="https://..."
                    className="h-9 min-w-0 flex-1 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-sm"
                  />
                )}
                {button.type === 'PHONE_NUMBER' && (
                  <Input
                    value={button.phoneNumber}
                    onChange={(e) => handleUpdateButton(button.id, { phoneNumber: e.target.value })}
                    placeholder="+57..."
                    className="h-9 min-w-0 flex-1 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-sm"
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 flex-shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => handleRemoveButton(button.id)}
                  aria-label="Quitar botón"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          {(previewHeader || previewBody) && (
            <div className="space-y-1.5">
              <Label>Vista previa</Label>
              <div className="flex justify-start">
                <div className="relative max-w-[min(88%,26rem)] rounded-2xl rounded-bl-none bg-[var(--chat-bubble-incoming)] px-3 py-2 text-sm text-foreground shadow-sm">
                  {previewHeader && <p className="mb-1 font-semibold">{formatWhatsAppText(previewHeader)}</p>}
                  <p className="whitespace-pre-wrap">{formatWhatsAppText(previewBody)}</p>
                  {footerText.trim() && <p className="mt-1 text-xs text-muted-foreground">{footerText.trim()}</p>}
                  {buttons.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-[var(--chat-border-strong)] pt-2">
                      {buttons.map((button) => (
                        <p key={button.id} className="text-center text-xs font-medium text-primary">
                          {button.text || '(sin texto)'}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

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

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="h-10 w-full bg-primary hover:bg-[var(--primary-hover)] sm:w-auto"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : 'Crear plantilla'}
          </Button>
        </div>
      )}
    </section>
  );
}
