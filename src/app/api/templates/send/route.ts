import { NextResponse } from 'next/server';
import { buildTemplateSendPayload } from '@kapso/whatsapp-cloud-api';
import { configurationErrorResponse, resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { whatsappClient } from '@/lib/whatsapp-client';
import type { TemplateParameterInfo } from '@/types/whatsapp';

type TemplateSendInput = Parameters<typeof buildTemplateSendPayload>[0];
type TemplateMessageInput = Parameters<(typeof whatsappClient.messages)['sendTemplate']>[0];
type TemplatePayload = TemplateMessageInput['template'];
type TemplateBodyParameter = NonNullable<TemplateSendInput['body']>[number];
type TemplateHeaderParameter = Extract<NonNullable<TemplateSendInput['header']>, { type: 'text' }>;
type TemplateButtonParameter = Extract<NonNullable<TemplateSendInput['buttons']>[number], { subType: 'url' }>;
type ButtonTextParameter = { type: 'text'; text: string; parameter_name?: string };

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      to,
      // Funcionalidad "Contactos con username (BSUID)": alternativa a `to`
      // cuando el contacto no tiene número de teléfono — ver el comentario
      // grande más abajo, junto a su uso.
      businessScopedUserId,
      templateName,
      languageCode,
      templateCategory,
      parameters,
      parameterInfo,
      phoneNumberId: requestedPhoneNumberId
    } = body;
    const phoneNumber = await resolvePhoneNumberContext(requestedPhoneNumberId);
    const phoneNumberId = phoneNumber.phone_number_id;

    if ((!to && !businessScopedUserId) || !templateName || !languageCode) {
      // Antes esto siempre decía "Missing required fields: to, templateName,
      // languageCode" sin importar cuál de los tres de verdad faltaba —
      // confuso cuando, por ejemplo, solo falta `to` (pasa con contactos que
      // solo tienen username de WhatsApp, sin número de teléfono expuesto al
      // negocio — Kapso entrega `phone_number: null` para esos casos, ver
      // src/app/api/conversations/route.ts).
      const missingFields = [
        (!to && !businessScopedUserId) && 'to (or businessScopedUserId)',
        !templateName && 'templateName',
        !languageCode && 'languageCode'
      ].filter(Boolean);

      return NextResponse.json(
        { error: `Missing required field(s): ${missingFields.join(', ')}` },
        { status: 400 }
      );
    }

    // Confirmado con soporte de Kapso: Meta no permite mandarle plantillas de
    // categoría AUTHENTICATION a un destinatario por business_scoped_user_id
    // (BSUID) — solo aplica cuando se manda por `to` (número de teléfono).
    if (businessScopedUserId && !to && templateCategory === 'AUTHENTICATION') {
      return NextResponse.json(
        { error: 'Meta no permite enviar plantillas de autenticación a contactos sin número de teléfono (solo username).' },
        { status: 400 }
      );
    }

    const templateOptions: TemplateSendInput = {
      name: templateName,
      language: languageCode
    };

    if (parameters && parameterInfo) {
      const typedParamInfo = parameterInfo as TemplateParameterInfo;

      const bodyParameters: TemplateBodyParameter[] = [];
      const buttonParameters: TemplateButtonParameter[] = [];
      let headerParameter: TemplateHeaderParameter | undefined;

      const getParameterValue = (paramName: string, index: number) => {
        if (Array.isArray(parameters)) {
          return parameters[index];
        }
        return parameters[paramName];
      };

      typedParamInfo.parameters.forEach((paramDef, index) => {
        const rawValue = getParameterValue(paramDef.name, index);
        if (rawValue === undefined || rawValue === null) {
          return;
        }

        const textValue = String(rawValue);
        if (!textValue.trim()) {
          return;
        }

        if (paramDef.component === 'HEADER') {
          if (!headerParameter) {
            headerParameter = {
              type: 'text',
              text: textValue,
              parameter_name: paramDef.name
            } as TemplateHeaderParameter;
          }
          return;
        }

        if (paramDef.component === 'BODY') {
          bodyParameters.push({
            type: 'text',
            text: textValue,
            parameter_name: paramDef.name
          } as TemplateBodyParameter);
          return;
        }

        if (paramDef.component === 'BUTTON' && typeof paramDef.buttonIndex === 'number') {
          let button = buttonParameters.find((btn) => btn.index === paramDef.buttonIndex);
          if (!button) {
            button = {
              type: 'button',
              subType: 'url',
              index: paramDef.buttonIndex,
              parameters: []
            } as TemplateButtonParameter;
            buttonParameters.push(button);
          }

          button.parameters.push({
            type: 'text',
            text: textValue,
            parameter_name: paramDef.name
          } as ButtonTextParameter);
        }
      });

      if (headerParameter) {
        templateOptions.header = headerParameter;
      }

      if (bodyParameters.length > 0) {
        templateOptions.body = bodyParameters;
      }

      if (buttonParameters.length > 0) {
        templateOptions.buttons = buttonParameters;
      }
    }

    const templatePayload = buildTemplateSendPayload(templateOptions) as TemplatePayload;

    // Send template message.
    // Funcionalidad "Contactos con username (BSUID)": el helper tipado del
    // SDK (sendTemplate) exige `to` (número de teléfono) — para un contacto
    // que solo tiene business_scoped_user_id, el payload crudo debe llevar
    // `recipient` en su lugar (confirmado con soporte de Kapso). El SDK no
    // deja pasar ese campo por su validación tipada, así que para este caso
    // se arma el payload a mano y se manda con whatsappClient.request()
    // directo — el camino con `to` (el de siempre) se deja intacto.
    const result = businessScopedUserId && !to
      ? await whatsappClient.request(
          'POST',
          `${phoneNumberId}/messages`,
          {
            body: {
              messagingProduct: 'whatsapp',
              recipientType: 'individual',
              recipient: businessScopedUserId,
              type: 'template',
              template: templatePayload
            },
            responseType: 'json'
          }
        )
      : await whatsappClient.messages.sendTemplate({
          phoneNumberId,
          to,
          template: templatePayload
        });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error sending template:', error);
    return configurationErrorResponse(error);
  }
}
