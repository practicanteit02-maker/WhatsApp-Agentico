import { buildKapsoFields, type ConversationRecord } from '@kapso/whatsapp-cloud-api';
import { ASSIGNABLE_STATUSES, getAllStatuses } from '@/lib/chat-status';
import { getAllZones } from '@/lib/conversation-zones';
import { groupConversationsByPhoneNumber, type Conversation } from '@/lib/inbox-data';
import { getTrackedPhoneNumbers } from '@/lib/inbox-settings';
import { getAssignableZones } from '@/lib/mock-zones';
import { whatsappClient } from '@/lib/whatsapp-client';
import type { KapsoPhoneNumber } from '@/types/settings';

/**
 * Funcionalidad "Dashboard de métricas": conteo actual de chats por estado y
 * por zona. No hay un endpoint de agregación en Kapso (ni un total), así que
 * se traen todas las conversaciones paginando por cursor y se agrupan por
 * threadKey igual que la bandeja (groupConversationsByPhoneNumber) — cada
 * thread se cuenta una sola vez. El estado/zona sale de las tablas
 * `conversaciones-estado` / `conversaciones-zonas` (un `Scan` chico cada
 * una); un thread sin fila cuenta como "Nuevo" / "Sin asignar", igual que en
 * el resto de la app. Contar solo contra los threads vivos de Kapso
 * descarta de paso las filas viejas de chats ya borrados.
 *
 * La paginación se corta a MAX_PAGINAS por número para no colgar el
 * dashboard si algún día hay miles de conversaciones — en ese caso
 * `muestraParcial` avisa que el conteo es un piso, no el total.
 */
const PAGINA = 100;
const MAX_PAGINAS = 5;

export type MetricasChats = {
  total: number;
  porEstado: Record<string, number>;
  porZona: Record<string, number>;
  muestraParcial: boolean;
};

async function traerConversaciones(phoneNumberId: string): Promise<{
  conversaciones: ConversationRecord[];
  parcial: boolean;
}> {
  const fields = buildKapsoFields(['contact_name']);
  const conversaciones: ConversationRecord[] = [];
  let after: string | undefined;
  let paginas = 0;

  do {
    const respuesta = await whatsappClient.conversations.list({
      phoneNumberId,
      limit: PAGINA,
      fields,
      ...(after ? { after } : {}),
    });
    conversaciones.push(...(respuesta.data as ConversationRecord[]));
    const siguiente = respuesta.paging?.cursors?.after;
    after = typeof siguiente === 'string' && siguiente ? siguiente : undefined;
    paginas += 1;
    if (paginas >= MAX_PAGINAS && after) {
      return { conversaciones, parcial: true };
    }
  } while (after);

  return { conversaciones, parcial: false };
}

export async function contarChatsVivos(): Promise<MetricasChats> {
  const { phoneNumbers, settings } = await getTrackedPhoneNumbers();
  const numeros = settings.selectedPhoneNumberIds
    .map((id) => phoneNumbers.find((numero) => numero.phone_number_id === id))
    .filter((numero): numero is KapsoPhoneNumber => Boolean(numero));

  const crudas: Conversation[] = [];
  let muestraParcial = false;

  for (const numero of numeros) {
    const { conversaciones, parcial } = await traerConversaciones(numero.phone_number_id);
    if (parcial) muestraParcial = true;
    for (const c of conversaciones) {
      crudas.push({
        id: c.id,
        phoneNumber: typeof c.phoneNumber === 'string' ? c.phoneNumber : '',
        status: typeof c.status === 'string' ? c.status : 'unknown',
        lastActiveAt: typeof c.lastActiveAt === 'string' ? c.lastActiveAt : undefined,
        phoneNumberId: typeof c.phoneNumberId === 'string' ? c.phoneNumberId : numero.phone_number_id,
        businessScopedUserId:
          typeof c.businessScopedUserId === 'string' ? c.businessScopedUserId : undefined,
        contactName: typeof c.kapso?.contactName === 'string' ? c.kapso.contactName : undefined,
      });
    }
  }

  const [statuses, zones] = await Promise.all([getAllStatuses(), getAllZones()]);
  const threads = groupConversationsByPhoneNumber(crudas);

  const porEstado: Record<string, number> = {};
  for (const estado of ASSIGNABLE_STATUSES) porEstado[estado] = 0;

  const porZona: Record<string, number> = { 'Sin asignar': 0 };
  for (const zona of getAssignableZones()) porZona[zona] = 0;

  for (const thread of threads) {
    const estado = statuses[thread.key] ?? 'Nuevo';
    porEstado[estado] = (porEstado[estado] ?? 0) + 1;

    const zona = zones[thread.key] ?? 'Sin asignar';
    porZona[zona] = (porZona[zona] ?? 0) + 1;
  }

  return { total: threads.length, porEstado, porZona, muestraParcial };
}
