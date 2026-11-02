import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  const manifest = {
    name: 'BMS AI',
    short_name: 'BMS AI',
    description: 'One intelligence. Unlimited possibilities.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b1020',
    theme_color: '#0b1020',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Lets other apps (WhatsApp, Chrome, Gallery...) "Share" text and links to BMS AI.
    share_target: {
      action: '/',
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'url' },
    },
  };
  return manifest as MetadataRoute.Manifest;
}
