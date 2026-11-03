// Static mock artifact only: the FastAPI production entry remains unchanged.
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'app/web');
const output = path.join(root, 'dist');
const allowed = new Set(['.html', '.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2']);
async function filesUnder(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Static source may not contain symlinks: ${name}`);
    if (entry.isDirectory()) files.push(...await filesUnder(path.join(directory, entry.name), name));
    else if (allowed.has(path.extname(entry.name))) files.push(name);
  }
  return files.sort();
}
const files = await filesUnder(source);
if (!files.includes('mock.html')) throw new Error('app/web/mock.html is required for the isolated mock build.');
// Check HTML, CSS and literal /web/ references before replacing a previous build.
for (const file of files) {
  if (!['.html', '.css', '.js'].includes(path.extname(file))) continue;
  const content = await readFile(path.join(source, file), 'utf8');
  const pattern = path.extname(file) === '.js'
    ? /["'`]((?:\/web\/)[^"'`\s<>]+)/g
    : /(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^\s)"']+)/g;
  const refs = [...content.matchAll(pattern)];
  for (const match of refs) {
    const reference = (match[1] || match[2]).split(/[?#]/)[0];
    if (!reference || /^(?:[a-z]+:|\/\/)/i.test(reference)) continue;
    if (reference.includes('${')) throw new Error(`Cannot validate dynamic asset reference: ${file}: ${reference}`);
    const relative = reference.startsWith('/web/') ? reference.slice(5) : path.posix.join(path.posix.dirname(file), reference);
    if (!files.includes(relative)) throw new Error(`Missing static reference: ${file} -> ${reference}`);
  }
}
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'web'), { recursive: true });
for (const file of files) {
  const target = path.join(output, 'web', file);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(source, file), target);
  if (['.html', '.js', '.css'].includes(path.extname(file))) {
    // JS image URLs resolve against the document; CSS URLs resolve against CSS.
    const replacement = path.extname(file) === '.css' ? './' : './web/';
    const content = await readFile(target, 'utf8');
    await writeFile(target, content.replaceAll('/web/', replacement));
  }
}
const entry = (await readFile(path.join(source, 'mock.html'), 'utf8')).replaceAll('/web/', './web/');
await writeFile(path.join(output, 'index.html'), entry);
const artifacts = ['index.html', ...files.map(file => `web/${file}`)];
const manifest = { mode: 'mock-only', entry: 'index.html', files: [] };
for (const file of artifacts) {
  const content = await readFile(path.join(output, file));
  manifest.files.push({ path: file, bytes: (await stat(path.join(output, file))).size, sha256: createHash('sha256').update(content).digest('hex') });
}
await writeFile(path.join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Built ${artifacts.length} static mock files in dist/ (build-manifest.json).`);
