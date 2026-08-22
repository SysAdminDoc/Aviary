import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Both visual suites, because a baseline set is only trustworthy if regenerating it regenerates
// all of it. Updating one and not the other leaves the other's drift check failing for a reason
// that has nothing to do with what changed.
const testFiles = [
  path.join(root, "tests", "visual", "settings-visual-regression.test.mjs"),
  path.join(root, "tests", "visual", "injected-visual-regression.test.mjs")
];
const child = spawn(process.execPath, ["--test", ...testFiles], {
  cwd: root,
  env: { ...process.env, AVIARY_UPDATE_VISUALS: "1" },
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`visual baseline update stopped by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
