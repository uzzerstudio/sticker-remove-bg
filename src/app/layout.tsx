import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProvider } from "@/components/language-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Generador de sticker - Crea stickers increíbles en segundos",
  description: "La mejor herramienta para crear stickers profesionales con remoción de fondo automática y contorno personalizable.",
  keywords: ["stickers", "editor", "remover fondo", "PNG", "WebP", "generador", "sticker"],
  authors: [{ name: "Sticker Team" }],
  icons: {
    icon: [
      { url: "sticker-logo.png", href: "sticker-logo.png" },
    ],
    shortcut: "sticker-logo.png",
    apple: "sticker-logo.png",
  },
  openGraph: {
    title: "Generador de sticker - Creador de Stickers",
    description: "Crea stickers increíbles en segundos",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <LanguageProvider>
            <div className="min-h-screen flex flex-col">
              {children}
            </div>
            <Toaster />
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
