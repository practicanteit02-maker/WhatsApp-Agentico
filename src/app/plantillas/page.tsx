'use client';

import Link from 'next/link';
import { ArrowLeft, LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { TemplateManager } from '@/components/template-manager';

export default function PlantillasPage() {
  return (
    <div className="h-dvh min-h-dvh overflow-y-auto bg-background text-foreground">
      <header className="chat-header-on-brand sticky top-0 z-20 border-b border-[var(--chat-border-strong)] bg-[var(--chat-header)] px-4 py-3 safe-area-top">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="size-10 flex-shrink-0 rounded-md text-muted-foreground hover:bg-[var(--chat-hover)]"
              aria-label="Volver al inbox"
              title="Volver al inbox"
            >
              <Link href="/">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              <LayoutTemplate className="size-4 flex-shrink-0 text-[var(--chat-presence)]" />
              <h1 className="truncate text-base font-semibold text-foreground">Plantillas</h1>
            </div>
          </div>
          <ThemeToggle className="size-10 rounded-md text-muted-foreground" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-5 pb-10">
        <TemplateManager />
      </main>
    </div>
  );
}
