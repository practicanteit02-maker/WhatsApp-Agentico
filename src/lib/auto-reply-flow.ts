// Flujo de respuesta automática para el webhook de WhatsApp
// (src/app/api/webhooks/whatsapp). Antes de caer en la respuesta libre que
// redacta la IA (src/lib/ai-client.ts), primero se revisa si el mensaje
// entrante es un saludo o la elección de una opción del menú, para dar una
// respuesta fija y predecible en esos dos casos.
//
// EDITA AQUÍ:
// - MENU_MESSAGE: el texto del menú que se envía después de un saludo.
// - MENU_OPTION_REPLIES: qué contesta cada número del menú. Cuando decidas
//   la acción real de cada opción (conectar con un asesor de verdad, mandar
//   un link real, etc.), este es el lugar para cambiarla.

const GREETING_PATTERN =
  /^\s*(hola+|ola+|buen[oa]s?(\s+d[ií]as|\s+tardes|\s+noches)?|hey+|hi+|hello)\b/i;

export const MENU_MESSAGE = [
  '¡Hola! 👋 Bienvenido/a. ¿En qué te puedo ayudar hoy?',
  '',
  '1️⃣ Contactarme con un asesor',
  '2️⃣ Ver catálogo y precios',
  '3️⃣ Consultar el estado de mi pedido',
  '4️⃣ Otro tema',
  '',
  'Responde solo con el número de la opción 👆',
].join('\n');

export const MENU_OPTION_REPLIES: Record<string, string> = {
  '1': 'Perfecto 🙋 En un momento un asesor se pondrá en contacto contigo por este mismo chat.',
  '2': 'Claro, este es nuestro catálogo: [PON AQUÍ EL LINK O LA INFO]. ¿Buscas algo en particular?',
  '3': 'Para revisar tu pedido, cuéntame el número de orden o el nombre con el que compraste.',
  '4': 'Cuéntame con tus palabras en qué te puedo ayudar y con gusto te oriento.',
};

export function isGreeting(text: string): boolean {
  return GREETING_PATTERN.test(text.trim());
}

/** Devuelve la respuesta fija para una opción de menú como "1", o undefined si el texto no lo es. */
export function matchMenuOption(text: string): string | undefined {
  return MENU_OPTION_REPLIES[text.trim()];
}
