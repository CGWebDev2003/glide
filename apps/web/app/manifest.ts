import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Glide – Scroll-Videos',
    short_name: 'Glide',
    description: 'Flüssige Scroll-Videos von Websites, Frame für Frame gerendert.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0e0f13',
    theme_color: '#0e0f13',
    lang: 'de',
    categories: ['productivity', 'utilities', 'photo'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // share a link from any app (e.g. the browser on the phone) -> prefilled form
    share_target: {
      action: '/',
      method: 'GET',
      enctype: 'application/x-www-form-urlencoded',
      params: { title: 'title', text: 'text', url: 'url' },
    },
    shortcuts: [{ name: 'Neue Aufnahme', url: '/', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] }],
  } as MetadataRoute.Manifest;
}
