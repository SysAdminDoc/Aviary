import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cacheKey = new Map();
let freshSequence = 0;

/** Import a TypeScript source module directly through Node's native type stripping. */
export async function importSourceModule(relativePath, { fresh = false } = {}) {
  const base = pathToFileURL(path.join(root, relativePath)).href;
  const resolved = fresh ? `${base}?aviary-test-${++freshSequence}` : base;
  const cached = cacheKey.get(resolved);
  if (cached) return cached;
  const loaded = import(resolved);
  cacheKey.set(resolved, loaded);
  return loaded;
}

/** Import several source modules while preserving Node's normal shared module cache. */
export async function importSourceEntry(relativePaths) {
  const modules = await Promise.all(relativePaths.map((relativePath) => importSourceModule(relativePath)));
  return Object.assign({}, ...modules);
}
