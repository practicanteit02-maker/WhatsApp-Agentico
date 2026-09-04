'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { InboxSettingsResponse, KapsoPhoneNumber } from '@/types/settings';

// Misma queryKey que usa src/app/settings/page.tsx para esto — así se
// comparte la caché en vez de volver a pedirle los números a Kapso.
const SETTINGS_QUERY_KEY = ['inbox-settings'] as const;

async function fetchInboxSettings(): Promise<InboxSettingsResponse> {
  const response = await fetch('/api/settings');
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to load settings');
  }

  return data;
}

function displayNameForPhoneNumber(phoneNumber: KapsoPhoneNumber): string {
  return (
    phoneNumber.display_name ||
    phoneNumber.verified_name ||
    phoneNumber.name ||
    phoneNumber.display_phone_number ||
    phoneNumber.phone_number_id
  );
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se dispara al validar el número — abre la vista de chat con ese número
   * como destinatario (ver pendingNewChatRecipient en src/app/page.tsx). El
   * primer mensaje de verdad se manda desde ahí (compositor de plantillas
   * embebido, ver template-composer.tsx), no desde este diálogo. */
  onOpenChat?: (phoneNumber: string, phoneNumberId: string) => void;
};

/**
 * Funcionalidad "Nuevo chat": arrancar una conversación con un número que
 * todavía no aparece en la lista. Este diálogo solo pide el número y el
 * remitente — al confirmarlo, se abre directamente la vista de chat con ese
 * número (todavía sin ninguna conversación real), que a su vez muestra el
 * selector de plantillas en el lugar del compositor de texto normal, porque
 * WhatsApp exige que el primer mensaje a alguien que no te escribió antes
 * sea una plantilla aprobada.
 */
export function NewChatDialog({ open, onOpenChange, onOpenChat }: Props) {
  const [phoneNumberInput, setPhoneNumberInput] = useState('');
  const [selectedPhoneNumberId, setSelectedPhoneNumberId] = useState('');

  const { data } = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: fetchInboxSettings,
    enabled: open,
  });

  const trackedPhoneNumbers = (data?.phoneNumbers ?? []).filter((phoneNumber) =>
    data?.selectedPhoneNumberIds.includes(phoneNumber.phone_number_id),
  );

  // Reinicia el formulario cada vez que se abre de nuevo.
  useEffect(() => {
    if (!open) return;
    setPhoneNumberInput('');
  }, [open]);

  // Preselecciona el número por defecto (o el único disponible) apenas
  // llegan los ajustes.
  useEffect(() => {
    if (selectedPhoneNumberId || trackedPhoneNumbers.length === 0) return;
    setSelectedPhoneNumberId(data?.defaultPhoneNumberId || trackedPhoneNumbers[0].phone_number_id);
  }, [trackedPhoneNumbers, data?.defaultPhoneNumberId, selectedPhoneNumberId]);

  const normalizedPhoneNumber = phoneNumberInput.replace(/[^\d+]/g, '');
  const digitCount = normalizedPhoneNumber.replace(/\D/g, '').length;
  const canContinue = digitCount >= 8 && !!selectedPhoneNumberId;

  const handleContinue = () => {
    if (!canContinue) return;
    onOpenChat?.(normalizedPhoneNumber, selectedPhoneNumberId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Nuevo chat</DialogTitle>
          <DialogDescription>
            Escribile a un número que todavía no está en tu lista. El primer mensaje tiene que ser una plantilla aprobada — así lo exige WhatsApp para iniciar contacto con alguien que no te escribió antes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-chat-phone">Número de WhatsApp</Label>
            <Input
              id="new-chat-phone"
              type="tel"
              value={phoneNumberInput}
              onChange={(e) => setPhoneNumberInput(e.target.value)}
              placeholder="+57 300 1234567"
              className="h-11 border-[var(--chat-border-strong)] bg-[var(--chat-input)] text-base focus-visible:ring-primary md:h-10 md:text-sm"
            />
            <p className="text-xs text-muted-foreground">Con código de país, ej. 57 para Colombia.</p>
          </div>

          {trackedPhoneNumbers.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="new-chat-sender">Enviar desde</Label>
              <select
                id="new-chat-sender"
                value={selectedPhoneNumberId}
                onChange={(e) => setSelectedPhoneNumberId(e.target.value)}
                className="h-11 w-full rounded-md border border-[var(--chat-border-strong)] bg-[var(--chat-input)] px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:h-10 md:text-sm"
              >
                {trackedPhoneNumbers.map((phoneNumber) => (
                  <option key={phoneNumber.phone_number_id} value={phoneNumber.phone_number_id}>
                    {displayNameForPhoneNumber(phoneNumber)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleContinue}
            disabled={!canContinue}
            className="bg-primary hover:bg-[var(--primary-hover)]"
          >
            Continuar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
