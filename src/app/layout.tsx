import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { QueryProvider } from "@/components/query-provider";
import "./globals.css";

// My Space 1A design system — Inter Display is the sole typeface.
const interDisplay = localFont({
  src: [
    { path: "./fonts/InterDisplay-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/InterDisplay-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/InterDisplay-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/InterDisplay-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-inter-display",
  display: "swap",
});

const themeInitScript = `
try {
  const allowedModes = { light: true, dark: true, system: true };
  const storedMode = window.localStorage.getItem('mode');
  const legacyTheme = window.localStorage.getItem('whatsapp-cloud-inbox-theme');
  const forcedModeAttr = document.documentElement.getAttribute('data-force-mode');
  const forcedMode = forcedModeAttr === 'light' || forcedModeAttr === 'dark' ? forcedModeAttr : null;
  const legacyMode = legacyTheme === 'kapso' ? 'dark' : legacyTheme === 'normal' ? 'light' : null;
  const mode = forcedMode || (allowedModes[storedMode] ? storedMode : legacyMode || 'dark');
  const resolvedMode = !forcedMode && mode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;

  window.localStorage.setItem('theme', 'default');
  window.localStorage.setItem('mode', mode);
  window.localStorage.removeItem('whatsapp-cloud-inbox-theme');

  document.documentElement.dataset.theme = 'default';
  document.documentElement.dataset.mode = resolvedMode;
  document.documentElement.style.colorScheme = resolvedMode;
  document.documentElement.style.backgroundColor = resolvedMode === 'dark' ? 'hsl(20 14.3% 4.1%)' : 'hsl(0 0% 100%)';

  if (resolvedMode === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
} catch {
  document.documentElement.dataset.theme = 'default';
  document.documentElement.dataset.mode = 'dark';
  document.documentElement.classList.add('dark');
}
`;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "WhatsApp Agéntico",
  description: "Bandeja de WhatsApp con respuestas asistidas por IA, construida con Next.js",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={interDisplay.variable}>
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
