// Run: node --experimental-vm-modules --test dev/live-reload.test.mjs
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./live-reload.js', import.meta.url), 'utf8');

async function start() {
  const files = new Map();
  const requests = [];
  const timers = [];
  const observers = [];
  let reloads = 0;
  let offline = false;
  const link = { localName: 'link', rel: 'stylesheet', href: 'http://localhost:8123/local/glow-cards/glow-card.css?v=16.0.0' };
  const root = { querySelectorAll: () => [link] };
  const document = { querySelectorAll: () => [{ shadowRoot: root }] };
  const context = vm.createContext({
    URL, WeakSet, Date, console, document,
    location: { href: 'http://localhost:8123/glow-cards/samples', reload: () => reloads++ },
    MutationObserver: class {
      constructor(callback) { observers.push(callback); }
      observe() {}
    },
    setTimeout: (callback) => timers.push(callback),
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (offline) throw new Error('Restarting');
      return { ok: true, text: async () => files.get(url) || 'original' };
    },
  });
  let imported;
  const module = new vm.SourceTextModule(source, {
    context,
    importModuleDynamically: async (specifier) => {
      imported = specifier;
      const cards = new vm.SyntheticModule([], () => {}, { context });
      await cards.link(() => {});
      await cards.evaluate();
      return cards;
    },
  });
  await module.link(() => {});
  await module.evaluate();
  return { files, requests, timers, observers, link, imported,
    reloads: () => reloads, offline: (value) => { offline = value; } };
}

test('loads fresh modules; unchanged files do not reload', async () => {
  const app = await start();
  assert.match(app.imported, /glow-cards\.js\?dev=\d+/);
  await app.timers.shift()();
  assert.equal(app.reloads(), 0);
  assert.equal(app.timers.length, 1);
});

for (const path of ['glow-cards/glow-cards.js', 'glow-cards/glow-card.css', 'glow-dev-dashboard.yaml', 'glow-dev-reload.js']) {
  test(`reloads after editing ${path}`, async () => {
    const app = await start();
    app.files.set(`/local/${path}`, 'edited');
    await app.timers.shift()();
    assert.equal(app.reloads(), 1);
    assert.equal(app.requests.at(-1).options.cache, 'reload');
    assert.equal(app.timers.length, 0);
  });
}

test('resumes polling after a server restart', async () => {
  const app = await start();
  app.offline(true);
  await app.timers.shift()();
  assert.equal(app.reloads(), 0);
  app.offline(false);
  app.files.set('/local/glow-cards/glow-card.css', 'edited');
  await app.timers.shift()();
  assert.equal(app.reloads(), 1);
});
