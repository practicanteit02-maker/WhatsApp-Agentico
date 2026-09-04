import { NextResponse } from 'next/server';
import { configurationErrorResponse, resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { whatsappClient } from '@/lib/whatsapp-client';

const TEMPLATE_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
type TemplateCategoryInput = (typeof TEMPLATE_CATEGORIES)[number];

type TemplateButtonInput =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string }
  | { type: 'PHONE_NUMBER'; text: string; phoneNumber: string };

// Meta exige nombres de plantilla en snake_case (solo minúsculas, números y
// guion bajo) — en vez de rechazar cualquier otra cosa, se normaliza para
// que la persona pueda escribir el nombre como le salga natural.
function normalizeTemplateName(rawName: string): string {
  return rawName
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita tildes
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Las variables de una plantilla van numeradas en orden ({{1}}, {{2}}, ...)
// sin saltos — en vez de exigirle a la persona que las numere bien a mano,
// se detecta cualquier "{{algo}}" y se renumera en el orden en que aparece.
function normalizeTemplateVariables(text: string): { text: string; variableCount: number } {
  let count = 0;
  const normalized = text.replace(/\{\{[^{}]*\}\}/g, () => `{{${++count}}}`);
  return { text: normalized, variableCount: count };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      phoneNumberId: requestedPhoneNumberId,
      name,
      category,
      language,
      headerText,
      headerExample,
      bodyText,
      bodyExamples,
      footerText,
      buttons,
    } = body as {
      phoneNumberId?: string;
      name?: string;
      category?: string;
      language?: string;
      headerText?: string;
      headerExample?: string;
      bodyText?: string;
      bodyExamples?: string[];
      footerText?: string;
      buttons?: TemplateButtonInput[];
    };

    const normalizedName = normalizeTemplateName(name || '');
    const missingFields = [
      !normalizedName && 'name',
      (!category || !TEMPLATE_CATEGORIES.includes(category as TemplateCategoryInput)) && 'category',
      !language?.trim() && 'language',
      !bodyText?.trim() && 'bodyText',
    ].filter(Boolean);

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing or invalid required field(s): ${missingFields.join(', ')}` },
        { status: 400 }
      );
    }

    const components: Array<{ type: string; [key: string]: unknown }> = [];

    if (headerText?.trim()) {
      const { text: normalizedHeader, variableCount } = normalizeTemplateVariables(headerText.trim());
      if (variableCount > 1) {
        return NextResponse.json(
          { error: 'El encabezado solo puede tener una variable.' },
          { status: 400 }
        );
      }
      if (variableCount === 1 && !headerExample?.trim()) {
        return NextResponse.json(
          { error: 'Falta el ejemplo de la variable del encabezado.' },
          { status: 400 }
        );
      }
      components.push({
        type: 'HEADER',
        format: 'TEXT',
        text: normalizedHeader,
        ...(variableCount === 1 && { example: { headerText: [headerExample!.trim()] } }),
      });
    }

    const { text: normalizedBody, variableCount: bodyVariableCount } = normalizeTemplateVariables(bodyText!.trim());
    const trimmedBodyExamples = (bodyExamples ?? []).map((example) => example?.trim() || '');

    if (
      bodyVariableCount > 0 &&
      (trimmedBodyExamples.length !== bodyVariableCount || trimmedBodyExamples.some((example) => !example))
    ) {
      return NextResponse.json(
        { error: 'Falta completar el ejemplo de alguna variable del cuerpo.' },
        { status: 400 }
      );
    }

    components.push({
      type: 'BODY',
      text: normalizedBody,
      ...(bodyVariableCount > 0 && { example: { bodyText: [trimmedBodyExamples] } }),
    });

    if (footerText?.trim()) {
      if (footerText.includes('{{')) {
        return NextResponse.json(
          { error: 'El pie de página no puede tener variables.' },
          { status: 400 }
        );
      }
      components.push({ type: 'FOOTER', text: footerText.trim() });
    }

    if (buttons && buttons.length > 0) {
      if (buttons.length > 3) {
        return NextResponse.json(
          { error: 'Máximo 3 botones por plantilla.' },
          { status: 400 }
        );
      }

      const urlButtonCount = buttons.filter((button) => button.type === 'URL').length;
      const phoneButtonCount = buttons.filter((button) => button.type === 'PHONE_NUMBER').length;
      if (urlButtonCount > 1 || phoneButtonCount > 1) {
        return NextResponse.json(
          { error: 'Como máximo un botón de enlace y uno de teléfono por plantilla.' },
          { status: 400 }
        );
      }

      for (const button of buttons) {
        if (!button.text?.trim()) {
          return NextResponse.json(
            { error: 'Todos los botones necesitan un texto.' },
            { status: 400 }
          );
        }
        if (button.type === 'URL' && !button.url?.trim()) {
          return NextResponse.json(
            { error: 'Falta la URL de uno de los botones.' },
            { status: 400 }
          );
        }
        if (button.type === 'PHONE_NUMBER' && !button.phoneNumber?.trim()) {
          return NextResponse.json(
            { error: 'Falta el número de teléfono de uno de los botones.' },
            { status: 400 }
          );
        }
      }

      components.push({
        type: 'BUTTONS',
        buttons: buttons.map((button) => {
          if (button.type === 'URL') {
            return { type: 'URL', text: button.text.trim(), url: button.url.trim() };
          }
          if (button.type === 'PHONE_NUMBER') {
            return { type: 'PHONE_NUMBER', text: button.text.trim(), phoneNumber: button.phoneNumber.trim() };
          }
          return { type: 'QUICK_REPLY', text: button.text.trim() };
        }),
      });
    }

    const phoneNumber = await resolvePhoneNumberContext(requestedPhoneNumberId);
    const wabaId = phoneNumber.business_account_id || process.env.WABA_ID;

    if (!wabaId) {
      return NextResponse.json(
        { error: 'WABA_ID not configured' },
        { status: 500 }
      );
    }

    const result = await whatsappClient.templates.create({
      businessAccountId: wabaId,
      name: normalizedName,
      category: category as TemplateCategoryInput,
      language: language!.trim(),
      components,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error creating template:', error);
    return configurationErrorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const phoneNumber = await resolvePhoneNumberContext(searchParams.get('phoneNumberId') ?? undefined);
    const wabaId = phoneNumber.business_account_id || process.env.WABA_ID;

    if (!wabaId) {
      return NextResponse.json(
        { error: 'WABA_ID not configured' },
        { status: 500 }
      );
    }

    const response = await whatsappClient.templates.list({
      businessAccountId: wabaId,
      limit: 100
    });

    return NextResponse.json({
      data: response.data,
      paging: response.paging
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    return configurationErrorResponse(error);
  }
}
