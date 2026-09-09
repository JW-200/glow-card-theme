// Development only: load real cards and watch the bind-mounted source files.
const moduleUrl = '/local/glow-cards/glow-cards.js';
const cssUrl = '/local/glow-cards/glow-card.css';
const watched = [moduleUrl, cssUrl, '/local/glow-dev-dashboard.yaml', '/local/glow-dev-reload.js'];

async function read(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

const initial = await Promise.all(watched.map(read));

// The cards propagate this revision to their stylesheet URL, including cards
// created later when Home Assistant upgrades or replaces its shadow roots.
const revision = Date.now();
await import(`${moduleUrl}?dev=${revision}`);

async function poll() {
  try {
    const current = await Promise.all(watched.map(read));
    if (current.some((source, index) => source !== initial[index])) {
      // Refresh the loader's HTTP cache too, in case the loader itself changed.
      await fetch('/local/glow-dev-reload.js', { cache: 'reload' });
      location.reload();
      return;
    }
  } catch (error) {
    // A restart or a file being saved must not stop future reload checks.
    console.debug('[Glow dev] Waiting for files', error);
  }
  setTimeout(poll, 1000);
}
setTimeout(poll, 1000);
console.info('[Glow dev] Live reload enabled for cards, CSS, and sample dashboard');
