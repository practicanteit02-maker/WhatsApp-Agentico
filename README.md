Información sobre el proyecto

## Cómo funciona el sistema

Cada vez que alguien abre el panel, pasa por estos pasos antes de ver cualquier chat:

```mermaid
flowchart TD
    A(["Alguien abre el panel"]) --> B["Inicia sesión con su cuenta de Google del trabajo"]
    B --> C["El sistema confirma que es una cuenta de Google válida"]
    C --> D["Busca su perfil y su ciudad en la lista de personas autorizadas"]
    D --> E{"¿Qué perfil tiene esa persona?"}
    E -- Administrador --> F["Ve los chats de TODAS las ciudades"]
    E -- Otro perfil --> G["Ve solo los chats de SU propia ciudad"]
    F --> H["Puede prender o apagar la IA en cada chat, uno por uno"]
    G --> H

    classDef start fill:#0E6B54,stroke:#0A5343,color:#fff,font-weight:bold;
    classDef step fill:#EBF0E8,stroke:#B7C7B2,color:#172420;
    classDef decision fill:#F6E9D3,stroke:#A9701D,color:#172420;
    classDef branch fill:#E1EEE7,stroke:#0E6B54,color:#172420;
    classDef finish fill:#0E6B54,stroke:#0A5343,color:#fff,font-weight:bold;

    class A start;
    class B,C,D step;
    class E decision;
    class F,G branch;
    class H finish;
```

En palabras simples:

1. **Inicio de sesión** — la persona entra con su cuenta de Google del trabajo, no hay usuario ni contraseña propios que mantener.
2. **Verificación de identidad** — el sistema confirma con Google que la cuenta es real y válida.
3. **Consulta de perfil y zona** — el sistema busca esa persona en la lista interna de autorizados y le asigna su perfil (Administrador u otro) y su ciudad.
4. **Según el perfil** — un Administrador ve los chats de todas las ciudades; cualquier otro perfil ve únicamente los de su propia ciudad.
5. **En cualquiera de los dos casos** — la persona puede, chat por chat, prender o apagar que la IA responda automáticamente.


