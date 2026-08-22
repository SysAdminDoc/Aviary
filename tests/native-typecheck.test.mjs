import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name) => path.join(root, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
const compilerArgs = [
  "--noEmit",
  "--target", "ES2022",
  "--module", "ESNext",
  "--moduleResolution", "Bundler",
  "--lib", "DOM,ES2022",
  "--strict",
  "--exactOptionalPropertyTypes",
  "--noUncheckedIndexedAccess",
  "--noImplicitOverride",
  "--useDefineForClassFields",
  "--skipLibCheck",
  "--isolatedModules"
];

test("typecheck uses the native compiler while lint keeps the TypeScript 6 parser", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.match(packageJson.scripts.typecheck, /\btsgo\b/);
  assert.equal(packageJson.devDependencies.typescript, "6.0.3");
  assert.match(packageJson.devDependencies["@typescript/native-preview"], /^7\./);
});

test("native and TypeScript 6 compilers report the same deliberate diagnostic", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-native-typecheck-"));
  const source = path.join(temp, "broken.ts");
  try {
    await writeFile(source, "const count: number = \"not a number\";\n", "utf8");
    const run = (compiler) => spawnSync(bin(compiler), [...compilerArgs, source], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true
    });
    const native = run("tsgo");
    const legacy = run("tsc");
    assert.notEqual(native.status, 0, "native compiler must reject the broken fixture");
    assert.notEqual(legacy.status, 0, "TypeScript 6 must reject the broken fixture");
    const normalize = (result) => `${result.stdout}\n${result.stderr}`
      .replaceAll("\r", "")
      .replaceAll(source, "<broken.ts>")
      .trim();
    assert.equal(normalize(native), normalize(legacy));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
