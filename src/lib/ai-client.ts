import OpenAI from 'openai';

// Usada por src/lib/auto-reply.ts para responder automáticamente a mensajes
// de texto entrantes (disparado solo al abrir el chat — ver
// src/components/message-view.tsx).
//
// Proveedor: Groq (https://console.groq.com) — tiene un nivel gratuito real
// (sin tarjeta de crédito) y expone una API compatible con el SDK de OpenAI,
// así que reutilizamos el paquete `openai` apuntando a su baseURL en vez de
// llamar a OpenAI directamente. Si más adelante quieres volver a OpenAI (o
// usar otro proveedor compatible), solo hay que cambiar baseURL/apiKey/model
// aquí abajo — el resto de la app no sabe ni le importa cuál se use.
let _aiClient: OpenAI | null = null;

function getAIClient(): OpenAI {
  if (!_aiClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY environment variable is not set');
    }
    _aiClient = new OpenAI({
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1'
    });
  }
  return _aiClient;
}

export type ChatHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

/**
 * Funcionalidad "Historial real para la IA": antes esta función solo recibía
 * el último mensaje suelto, sin nada de lo hablado antes — por eso siempre
 * sonaba como si fuera la primera vez que le escribía el cliente (abría con
 * "Hola" en cada respuesta). Ahora recibe el historial reciente de la
 * conversación (armado en src/lib/auto-reply.ts vía fetchRecentConversationHistory)
 * y se lo manda tal cual al modelo, para que responda con contexto real.
 * El último elemento de `history` debe ser el mensaje del cliente al que se
 * está respondiendo.
 */
export async function generateAIResponse(history: ChatHistoryMessage[]): Promise<string> {
  const client = getAIClient();

  const response = await client.chat.completions.create({
    // Catálogo de Groq en console.groq.com/docs/models — cambia con el tiempo,
    // así que si esto empieza a fallar con "model_not_found", revisa ahí el
    // id vigente. 'openai/gpt-oss-20b' es una alternativa más rápida/liviana.
    model: 'openai/gpt-oss-120b',
    messages: [
      {
        role: 'system',
        content:
          'Eres un asistente de atención al cliente por WhatsApp. Responde en español, ' +
          'de forma amable, clara y breve. No inventes información que no conozcas. ' +
          'A continuación verás el historial reciente de esta conversación (mensajes ' +
          'del cliente y tus propias respuestas anteriores) — úsalo para entender el ' +
          'contexto. No vuelvas a saludar ("Hola", "Buenos días", etc.) si la ' +
          'conversación ya estaba en curso; solo saluda si de verdad es el primer ' +
          'mensaje del historial.'
      },
      ...history.map((message) => ({ role: message.role, content: message.content }))
    ]
  });

  return response.choices[0]?.message?.content?.trim() ?? '';
}
