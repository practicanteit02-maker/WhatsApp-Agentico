import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Config mínima: el proyecto usa el runtime de Node (los tests son de
// src/lib/*.ts, no de componentes React/DOM — no hace falta jsdom ni el
// plugin de React), así que el único ajuste real que hace falta es resolver
// el alias "@/*" que ya usa el resto del código (ver tsconfig.json) — Vitest
// no lee tsconfig "paths" solo, hay que repetirlo acá.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Vite intenta auto-descubrir postcss.config.mjs (el de Tailwind v4 del
  // proyecto) aunque los tests no toquen CSS para nada — su formato de
  // plugin no es compatible con lo que Vite espera fuera del pipeline de
  // Next, y rompe el arranque de Vitest. Un postcss vacío explícito evita
  // que lo busque.
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    environment: 'node',
  },
});
