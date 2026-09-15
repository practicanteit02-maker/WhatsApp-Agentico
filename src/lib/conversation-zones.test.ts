import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

// Mockea el módulo @/auth ENTERO (archivo aparte de conversation-zones.ts,
// así que vi.mock funciona sin problema — a diferencia de mockear una
// función definida en el MISMO archivo que se está probando, que con
// módulos ES no se puede interceptar desde afuera). auth() normalmente lee
// cookies de un request real; en el test se controla directo, un valor de
// retorno distinto por caso.
vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { checkZoneAccess } from './conversation-zones';

/**
 * Simula la respuesta de DynamoDBDocumentClient.send() para el GetCommand
 * que hace getZone() adentro de checkZoneAccess() — mockear el PROTOTIPO de
 * la clase (no una instancia) alcanza porque el `dynamoClient` de
 * conversation-zones.ts es una instancia de esa misma clase, creada en otro
 * módulo: cualquier .send() que haga pasa por acá mientras dure el mock.
 * `zonaDelChat` es la zona real que "tiene" el chat en DynamoDB —
 * `undefined` simula un chat sin zona asignada (fila inexistente).
 */
function mockearZonaDelChat(zonaDelChat: string | undefined) {
  return vi.spyOn(DynamoDBDocumentClient.prototype, 'send').mockImplementation(async (command) => {
    if (command instanceof GetCommand) {
      return zonaDelChat ? { Item: { threadKey: command.input.Key?.threadKey, zona: zonaDelChat } } : {};
    }
    throw new Error(`Comando inesperado en el test: ${command.constructor.name}`);
  });
}

// auth() de NextAuth v5 tiene una firma sobrecargada (uso normal vs. uso
// como middleware) que confunde la inferencia de vi.mocked() — se castea a
// Mock a mano en vez de pelear con esos overloads, el runtime funciona
// exactamente igual.
const mockedAuth = auth as unknown as Mock;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkZoneAccess', () => {
  it('sin sesión -> no permite (401)', async () => {
    mockedAuth.mockResolvedValue(null);
    mockearZonaDelChat('Bogotá');

    const resultado = await checkZoneAccess('123:573000000');

    expect(resultado).toEqual({ allowed: false, status: 401, error: 'No autenticado' });
  });

  it('Administrador -> siempre permite, sin importar sus zonas', async () => {
    mockedAuth.mockResolvedValue({ user: { perfil: 'Administrador', zonas: [] } } as never);
    mockearZonaDelChat('Bogotá');

    const resultado = await checkZoneAccess('123:573000000');

    expect(resultado).toEqual({ allowed: true });
  });

  it('la zona real del chat está entre las zonas del usuario -> permite', async () => {
    mockedAuth.mockResolvedValue({ user: { perfil: 'Coordinadora', zonas: ['Cali', 'Bogotá'] } } as never);
    mockearZonaDelChat('Bogotá');

    const resultado = await checkZoneAccess('123:573000000');

    expect(resultado).toEqual({ allowed: true });
  });

  it('la zona real del chat NO está entre las zonas del usuario -> no permite (403)', async () => {
    mockedAuth.mockResolvedValue({ user: { perfil: 'Coordinadora', zonas: ['Cali', 'Bogotá'] } } as never);
    mockearZonaDelChat('Medellín');

    const resultado = await checkZoneAccess('123:573000000');

    expect(resultado).toEqual({ allowed: false, status: 403, error: 'No tenés acceso a esta conversación' });
  });

  // El caso que pidió el usuario explícitamente: zonas vacío/undefined NUNCA
  // da acceso a nada — falla CERRADO. Es a propósito el criterio contrario
  // al del lock de respuesta de IA (ver adquirirLockRespuestaIA en el otro
  // repo, que ante una falla ajena prefiere dejar pasar): acá el riesgo de
  // fallar mal es exponer chats de otra zona, no dejar de responder un
  // mensaje. Se prueba con una zona real coincidente de pura casualidad
  // (ver el segundo test) para que quede claro que no es solo "no hay nada
  // que matchee" — es que un array vacío nunca deja pasar, punto.
  describe('zonas vacío o undefined -> nunca da acceso (falla cerrado)', () => {
    it('con zonas: [] y ninguna zona real en el chat', async () => {
      mockedAuth.mockResolvedValue({ user: { perfil: 'Coordinadora', zonas: [] } } as never);
      mockearZonaDelChat(undefined);

      const resultado = await checkZoneAccess('123:573000000');

      expect(resultado.allowed).toBe(false);
    });

    it('con zonas: [] aunque el chat SÍ tenga una zona real asignada', async () => {
      mockedAuth.mockResolvedValue({ user: { perfil: 'Coordinadora', zonas: [] } } as never);
      mockearZonaDelChat('Bogotá');

      const resultado = await checkZoneAccess('123:573000000');

      expect(resultado.allowed).toBe(false);
    });

    it('con zonas: undefined (sesión con JWT viejo sin normalizar todavía)', async () => {
      mockedAuth.mockResolvedValue({ user: { perfil: 'Coordinadora', zonas: undefined } } as never);
      mockearZonaDelChat('Bogotá');

      const resultado = await checkZoneAccess('123:573000000');

      expect(resultado.allowed).toBe(false);
    });
  });
});
