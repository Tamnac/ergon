type Theme = 'light' | 'dark' | 'system';

const escapeAttribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

export function updateFavicon(theme: Theme, accent: string) {
  const foreground = theme === 'dark' ? '#ffffff' : '#000001';
  const systemStyle =
    theme === 'system'
      ? '<style>@media (prefers-color-scheme: dark) { .mark { fill: #ffffff; } }</style>'
      : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 496 336">${systemStyle}<g class="mark" fill="${foreground}"><path d="M40 128V84A44 44 0 0 1 84 40H412A44 44 0 0 1 456 84V128Z"/><path d="M40 190H288V278H84A44 44 0 0 1 40 234Z"/></g><circle cx="394" cy="234" r="68.2" fill="${escapeAttribute(accent)}"/></svg>`;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
