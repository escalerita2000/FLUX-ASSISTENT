import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'FLUX - Control de Asistencia Biométrica',
  description: 'Sistema administrativo y de marcado biométrico offline-first para empleados.',
  manifest: '/manifest.json',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no, viewport-fit=cover" />
      </head>
      <body>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(function(reg) {
                    console.log('ServiceWorker registrado con éxito:', reg.scope);
                  }).catch(function(err) {
                    console.warn('Fallo al registrar el ServiceWorker:', err);
                  });
                });
              }
            `
          }}
        />
      </body>
    </html>
  )
}
