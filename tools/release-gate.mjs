import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? process.execPath : "npm";
const npmCli = process.platform === "win32"
  ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  : null;
const visualTests = [
  "tests/visual/settings-visual-regression.test.mjs",
  "tests/visual/injected-visual-regression.test.mjs",
  "tests/visual/reflow-visual-regression.test.mjs"
];
const steps = [
  [npm, npmCli ? [npmCli, "run", "typecheck"] : ["run", "typecheck"]],
  [npm, npmCli ? [npmCli, "run", "lint"] : ["run", "lint"]],
  [npm, npmCli ? [npmCli, "run", "test"] : ["run", "test"]],
  [npm, npmCli ? [npmCli, "run", "build"] : ["run", "build"]],
  [npm, npmCli ? [npmCli, "run", "preflight"] : ["run", "preflight"]],
  [process.execPath, ["--test", ...visualTests]],
  [npm, npmCli ? [npmCli, "run", "smoke"] : ["run", "smoke"]]
];

await rm(path.join(root, "dist"), { recursive: true, force: true });

try {
  for (const [command, args] of steps) {
    await run(command, args);
  }
  console.log("[verify:release] typecheck, lint, tests, build, preflight, visual, and smoke gates passed.");
} catch (error) {
  await rm(path.join(root, "dist"), { recursive: true, force: true });
  console.error(`[verify:release] rejected artifacts were removed: ${error.message}`);
  process.exitCode = 1;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} ${args.join(" ")} stopped by ${signal}`));
      else if (code !== 0) reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      else resolve();
    });
  });
}
