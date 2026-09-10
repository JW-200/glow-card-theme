import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { transform as transformJavascript } from 'esbuild';
import { transform } from 'lightningcss';

const outputDirectory = new URL('../.release/', import.meta.url);
const javascriptSource = new URL('../dist/glow-cards.js', import.meta.url);
const cssSource = new URL('../dist/glow-card.css', import.meta.url);
const javascriptOutput = new URL('glow-cards.js', outputDirectory);
const cssOutput = new URL('glow-card.css', outputDirectory);

const source = await readFile(javascriptSource, 'utf8');
const fallbackVersion = source.match(/: '([^']+)';\s*$/m)?.[1];
const version = String(process.env.GLOW_VERSION || fallbackVersion || 'dev').replace(/^v/, '');

await mkdir(outputDirectory, { recursive:true });

const minifiedJavascript = await transformJavascript(source, {
  loader:'js',
  format:'esm',
  target:'es2022',
  minify:true,
  legalComments:'none',
  define:{ __GLOW_VERSION__:JSON.stringify(version) },
});
await writeFile(javascriptOutput, minifiedJavascript.code);

const css = await readFile(cssSource);
const minifiedCss = transform({
  filename:'glow-card.css',
  code:css,
  minify:true,
});
await writeFile(cssOutput, minifiedCss.code);

const javascriptBytes = (await readFile(javascriptOutput)).byteLength;
const cssBytes = minifiedCss.code.byteLength;
console.log(`Built Glow Cards ${version}: JS ${javascriptBytes} bytes, CSS ${cssBytes} bytes`);
