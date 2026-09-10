'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

type Props = {
  children: React.ReactNode;
};

export function QueryProvider({ children }: Props) {
  // `refetchOnWindowFocus: true` se deja como default global a propósito: al
  // volver a la pestaña querés ver los chats y el chat abierto al día. Las
  // queries de metadata que casi no cambian (zona/estado/etiqueta de cada
  // chat) lo apagan una por una con `refetchOnWindowFocus: false` + un
  // `staleTime` de 3 min, para que el alt-tab no dispare un refetch de todo.
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: true,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
