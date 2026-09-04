'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, Clock, Loader2, Megaphone, Send, ShieldCheck, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Template, TemplateComponent, TemplateParameterInfo } from '@/types/whatsapp';
import { formatParametersForTemplate, getTemplateParameters } from '@/lib/template-parser';

// Formato de WhatsApp (negrita *x*, cursiva _x_, tachado ~x~, monoespaciado
// ```x```) — mismo patrón que usa message-view.tsx para las burbujas reales
// de los mensajes, copiado acá (en vez de importado) para no acoplar este
// archivo a la implementación interna de message-view.tsx.
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

function formatParameterName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/Param (\d+)/, 'Parameter $1')
    .replace(/Button (\d+) Parameter (\d+)/, 'Button $1 URL Parameter $2');
}

function categoryLabel(category: string): string {
  switch (category) {
    case 'MARKETING':
      return 'Marketing';
    case 'UTILITY':
      return 'Utilidad';
    case 'AUTHENTICATION':
      return 'Autenticación';
    default:
      return category;
  }
}

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

// Mismo trío de categorías que categoryBadgeClass, pero como color sólido
// (para el ícono/franja de acento) e ícono propio — puramente estético, para
// que el selector de plantillas se distinga más de un formulario genérico.
function categoryAccentColor(category: string): string {
  switch (category) {
    case 'MARKETING':
      return '#3b82f6';
    case 'UTILITY':
      return 'var(--chat-presence)';
    case 'AUTHENTICATION':
      return '#a855f7';
    default:
      return 'var(--muted-foreground)';
  }
}

function CategoryIcon({
  category,
  className,
  style,
}: {
  category: string;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon = category === 'MARKETING' ? Megaphone : category === 'AUTHENTICATION' ? ShieldCheck : Wrench;
  return <Icon className={className} style={style} />;
}

// Orden fijo de categorías para que la lista no salte de lugar cada vez que
// cambian los templates disponibles.
const CATEGORY_ORDER = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];

function getComponent(template: Template, type: string): TemplateComponent | undefined {
  return template.components?.find((component) => component.type === type);
}

/** Reemplaza los {{1}}/{{2}}/{{nombre}} de un componente (header o body) con
 * lo que el usuario ya escribió, o con el texto de ejemplo mientras el campo
 * sigue vacío — para que la vista previa se sienta "viva" desde el principio. */
function applyParametersToText(
  text: string,
  componentType: 'HEADER' | 'BODY',
  parameterInfo: TemplateParameterInfo,
  values: Record<string, string>,
): string {
  const componentParams = parameterInfo.parameters.filter((param) => param.component === componentType);
  let result = text;

  componentParams.forEach((param, index) => {
    const placeholder = parameterInfo.format === 'NAMED' ? `{{${param.name}}}` : `{{${index + 1}}}`;
    const value = values[param.name]?.trim();
    result = result.split(placeholder).join(value || param.example || placeholder);
  });

  return result;
}

type Props = {
  phoneNumber?: string;
  /** Funcionalidad "Contactos con username (BSUID)": alternativa a
   * `phoneNumber` cuando el contacto no tiene número de teléfono (solo
   * username de WhatsApp) — ver el comentario junto a esta misma prop en
   * message-view.tsx. */
  businessScopedUserId?: string;
  phoneNumberId?: string;
  /** Texto de contexto que se muestra arriba de las plantillas (por qué no
   * se puede escribir texto libre ahorita mismo). */
  introText?: string;
  onSent?: () => void;
};

/**
 * Funcionalidad "Selector de plantillas en el chat": reemplaza el input de
 * texto normal cuando no se puede mandar un mensaje libre (contacto nuevo
 * sin ventana de conversación abierta, o pasaron más de 24h desde su último
 * mensaje) — antes esto era un aviso con un botón que abría un diálogo
 * aparte (TemplateSelectorDialog); ahora se elige y llena la plantilla acá
 * mismo, sin salir del chat, con una vista previa en vivo tipo burbuja de
 * WhatsApp.
 */
export function TemplateComposer({ phoneNumber, businessScopedUserId, phoneNumberId, introText, onSent }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams();
      if (phoneNumberId) params.set('phoneNumberId', phoneNumberId);

      const response = await fetch(`/api/templates${params.size ? `?${params.toString()}` : ''}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load templates');

      const approved = ((data.data || []) as Template[]).filter((template) => template.status === 'APPROVED');
      setTemplates(approved);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, [phoneNumberId]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Un contacto solo con username (BSUID, sin número) no puede recibir
  // plantillas de categoría AUTHENTICATION — Meta las bloquea para ese caso
  // (ver la validación en /api/templates/send). Se ocultan acá para no
  // ofrecer una opción que siempre va a fallar.
  const visibleTemplates = useMemo(() => {
    if (phoneNumber || !businessScopedUserId) return templates;
    return templates.filter((template) => template.category !== 'AUTHENTICATION');
  }, [templates, phoneNumber, businessScopedUserId]);

  const groupedTemplates = useMemo(() => {
    const groups = new Map<string, Template[]>();
    visibleTemplates.forEach((template) => {
      const list = groups.get(template.category) ?? [];
      list.push(template);
      groups.set(template.category, list);
    });

    const orderedCategories = [
      ...CATEGORY_ORDER.filter((category) => groups.has(category)),
      ...Array.from(groups.keys()).filter((category) => !CATEGORY_ORDER.includes(category)),
    ];

    return orderedCategories.map((category) => ({ category, templates: groups.get(category)! }));
  }, [visibleTemplates]);

  const parameterInfo: TemplateParameterInfo = useMemo(
    () => (selectedTemplate ? getTemplateParameters(selectedTemplate) : { format: 'POSITIONAL', parameters: [] }),
    [selectedTemplate],
  );

  const allParametersFilled = parameterInfo.parameters.every((param) => parameterValues[param.name]?.trim());

  const handleSelectTemplate = (template: Template) => {
    setSelectedTemplate(template);
    setParameterValues({});
    setSendError(null);
  };

  const handleBack = () => {
    setSelectedTemplate(null);
    setParameterValues({});
    setSendError(null);
  };

  const handleParameterChange = (paramName: string, value: string) => {
    setParameterValues((current) => ({ ...current, [paramName]: value }));
  };

  const handleSend = async () => {
    if (!selectedTemplate || !allParametersFilled) return;

    setSending(true);
    setSendError(null);

    try {
      const formattedParameters = formatParametersForTemplate(parameterInfo, parameterValues);

      const response = await fetch('/api/templates/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(phoneNumber ? { to: phoneNumber } : { businessScopedUserId }),
          phoneNumberId,
          templateName: selectedTemplate.name,
          languageCode: selectedTemplate.language,
          templateCategory: selectedTemplate.category,
          parameters: formattedParameters,
          parameterInfo,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to send template');
      }

      setSelectedTemplate(null);
      setParameterValues({});
      onSent?.();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send template');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-[900px] items-center justify-center p-6 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="mx-auto w-full max-w-[900px] p-3">
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {fetchError}
        </div>
      </div>
    );
  }

  if (visibleTemplates.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[900px] p-3">
        <div className="rounded-lg border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-4 text-sm text-muted-foreground">
          No hay plantillas aprobadas para este número.
        </div>
      </div>
    );
  }

  // Vista 1: elegir plantilla — carrusel horizontal agrupado por categoría.
  if (!selectedTemplate) {
    return (
      <div className="mx-auto w-full max-w-[900px] space-y-5 p-3">
        {introText && (
          <div className="flex items-start gap-2.5 rounded-xl border border-[var(--chat-warning-border)] bg-[var(--chat-warning-background)] px-3.5 py-3">
            <Clock className="mt-0.5 size-4 flex-shrink-0 text-[var(--chat-warning-foreground)]" />
            <p className="text-sm leading-relaxed text-[var(--chat-warning-foreground)]">{introText}</p>
          </div>
        )}
        {groupedTemplates.map(({ category, templates: categoryTemplates }) => (
          <div key={category} className="space-y-2.5">
            <div className="flex items-center gap-1.5">
              <CategoryIcon category={category} className="size-3.5" style={{ color: categoryAccentColor(category) }} />
              <h3
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: categoryAccentColor(category) }}
              >
                {categoryLabel(category)}
              </h3>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {categoryTemplates.map((template) => {
                const bodyComponent = getComponent(template, 'BODY');
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => handleSelectTemplate(template)}
                    className="group relative flex w-64 flex-shrink-0 flex-col gap-2.5 overflow-hidden rounded-2xl border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                  >
                    <span
                      className="absolute inset-x-0 top-0 h-1"
                      style={{ backgroundColor: categoryAccentColor(template.category) }}
                      aria-hidden="true"
                    />
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <span className="truncate text-sm font-semibold text-foreground">{template.name}</span>
                      <Badge variant="secondary" className={cn('flex-shrink-0 text-[10px]', categoryBadgeClass(template.category))}>
                        {template.language}
                      </Badge>
                    </div>
                    <div className="relative rounded-2xl rounded-bl-none bg-[var(--chat-bubble-incoming)] px-3 py-2 text-xs text-foreground shadow-sm">
                      <p className="line-clamp-4 whitespace-pre-wrap">
                        {bodyComponent?.text ? formatWhatsAppText(bodyComponent.text) : template.name}
                      </p>
                    </div>
                    <span className="flex items-center gap-1 text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                      <Send className="size-3" />
                      Usar esta plantilla
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Vista 2: llenar variables (si tiene) y enviar, con la misma burbuja
  // actualizándose en vivo a medida que se escribe.
  const headerComponent = getComponent(selectedTemplate, 'HEADER');
  const bodyComponent = getComponent(selectedTemplate, 'BODY');
  const footerComponent = getComponent(selectedTemplate, 'FOOTER');

  const previewHeaderText = headerComponent?.format === 'TEXT' && headerComponent.text
    ? applyParametersToText(headerComponent.text, 'HEADER', parameterInfo, parameterValues)
    : null;
  const previewBodyText = bodyComponent?.text
    ? applyParametersToText(bodyComponent.text, 'BODY', parameterInfo, parameterValues)
    : '';

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-4 p-3">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="h-8 gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-[var(--chat-hover)]"
        >
          <ArrowLeft className="size-3.5" />
          Volver a plantillas
        </Button>
        <Badge variant="secondary" className={cn('gap-1 text-[10px]', categoryBadgeClass(selectedTemplate.category))}>
          <CategoryIcon category={selectedTemplate.category} className="size-3" />
          {categoryLabel(selectedTemplate.category)}
        </Badge>
      </div>

      {/* Vista previa en vivo, tipo burbuja de WhatsApp — sobre el mismo
          fondo con textura que el resto del chat, para que se sienta como
          una vista previa real y no un recuadro de formulario suelto. */}
      <div className="chat-canvas-doodle flex justify-start rounded-2xl border border-[var(--chat-border-strong)] p-4">
        <div className="relative max-w-[min(88%,26rem)] rounded-2xl rounded-bl-none bg-[var(--chat-bubble-incoming)] px-3 py-2 text-sm text-foreground shadow-sm">
          {previewHeaderText && <p className="mb-1 font-semibold">{formatWhatsAppText(previewHeaderText)}</p>}
          <p className="whitespace-pre-wrap">{formatWhatsAppText(previewBodyText)}</p>
          {footerComponent?.text && (
            <p className="mt-1 text-xs text-muted-foreground">{footerComponent.text}</p>
          )}
        </div>
      </div>

      {parameterInfo.parameters.length > 0 && (
        <div className="space-y-3 rounded-xl border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-3.5">
          {parameterInfo.parameters.map((param) => (
            <div key={param.name} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor={`template-param-${param.name}`} className="text-foreground">
                  {formatParameterName(param.name)}
                </Label>
                <Badge variant="secondary" className="text-xs bg-[var(--chat-hover)] text-muted-foreground">
                  {param.component}
                </Badge>
              </div>
              <Input
                id={`template-param-${param.name}`}
                value={parameterValues[param.name] || ''}
                onChange={(e) => handleParameterChange(param.name, e.target.value)}
                placeholder={param.example || formatParameterName(param.name)}
                className="h-11 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-base focus-visible:ring-primary md:h-10 md:text-sm"
              />
            </div>
          ))}
        </div>
      )}

      {sendError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {sendError}
        </div>
      )}

      <Button
        onClick={handleSend}
        disabled={!allParametersFilled || sending}
        className="h-11 w-full rounded-full bg-primary shadow-sm hover:bg-[var(--primary-hover)] md:h-10 md:w-auto md:px-6"
      >
        {sending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Send className="h-4 w-4 mr-1" />
            Enviar
          </>
        )}
      </Button>
    </div>
  );
}
