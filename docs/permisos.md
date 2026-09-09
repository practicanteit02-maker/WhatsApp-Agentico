# Permisos por rol (RBAC)

El panel restringe lo que cada persona puede hacer en Conversaciones y
Plantillas según su **rol** (el campo `perfil` de la tabla `usuarios-panel`,
asignable desde la sección Usuarios — ver [docs sobre esa sección en el
código](../src/app/usuarios/page.tsx)).

## Matriz de permisos

| Rol            | Leer | Escribir (responder/crear) | Editar (estado/reasignar) | Eliminar |
|----------------|------|------------------------------|----------------------------|----------|
| Administrador  | Sí   | Sí                            | Sí                          | Sí       |
| Coordinadora   | Sí   | Sí                            | No                          | No       |
| QA             | Sí   | No                            | No                          | No       |

- **Leer**: ver la lista de chats, abrir un chat y ver sus mensajes, ver
  plantillas existentes.
- **Escribir**: mandar un mensaje (texto, archivo, reacción, botón
  interactivo), disparar la respuesta automática de la IA, mandar una
  plantilla ya aprobada a un chat, y crear una plantilla nueva.
- **Editar**: reasignar la zona de un chat y cambiar su estado de atención
  (Nuevo / En proceso / Cerrado).
- **Eliminar**: hoy no existe ninguna acción de borrado real en
  Conversaciones ni Plantillas (no hay forma de borrar un chat ni una
  plantilla desde el panel) — la columna queda definida en la matriz para
  cuando se construya esa funcionalidad, momento en el que su endpoint debe
  pasar por `requierePermiso('eliminar')` igual que el resto.

Un rol que no aparece en la tabla (un perfil sin asignar, o un valor viejo
que ya no existe) no tiene ningún permiso — el sistema siempre cae al
comportamiento más restrictivo, nunca al más permisivo.

La sección **Usuarios** (`/usuarios`, solo para crear/editar/borrar cuentas
del panel) queda fuera de esta matriz a propósito: sigue siendo exclusiva de
Administrador con su propio chequeo, sin pasar por este sistema.

## Cómo se usa

Todo el sistema vive en `src/lib/permissions.ts` — es la única fuente de
verdad, tanto para la matriz como para el nombre de los tres roles válidos.
Nada más en el proyecto compara un perfil contra un nombre de rol a mano.

- **En el servidor** (endpoints de `/api/...`): `requierePermiso(accion)` de
  `src/lib/require-permission.ts` lee la sesión, compara contra la matriz, y
  devuelve un `403` con el mensaje `Tu rol (<perfil>) no tiene permiso para
  <acción>` si no corresponde — o `null` si puede seguir.
- **En el cliente** (componentes de React): el hook `usePermissions()` de
  `src/hooks/use-permissions.ts` expone `{ perfil, puede, acciones }`. Los
  botones de una acción no permitida no se ocultan — quedan visibles pero
  deshabilitados, con un `title` explicando el motivo, para que sea claro
  por qué no se puede usarlos en vez de que parezcan haber desaparecido.

## Nota sobre auditoría

Ni la zona ni el estado de un chat guardan hoy quién hizo el último cambio
(no existe un campo tipo "actualizadoPor" en esas tablas de DynamoDB) — este
cambio no lo agregó, para no inventar una funcionalidad de auditoría que no
se pidió. Si en el futuro se necesita saber quién reasignó una zona o
cambió un estado, ese campo tendría que agregarse en `src/lib/
conversation-zones.ts` y `src/lib/chat-status.ts` (`setZone`/`setStatus`),
tomando el correo de la sesión (`auth()`) en el mismo endpoint que ya llama
a `requierePermiso('editar')`.
