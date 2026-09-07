import { spawn } from "node:child_process";
import path from "node:path";

const npm = process.platform === "win32" ? process.execPath : "npm";
const npmCli = process.platform === "win32"
  ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  : null;
const steps = ["typecheck", "lint", "test", "build", "preflight"];

for (const script of steps) {
  await run(npm, npmCli ? [npmCli, "run", script] : ["run", script]);
}

console.log("[verify:fast] passed; visual checks and all browser smoke lanes are omitted. Use npm run verify:release before publishing.");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} ${args.join(" ")} stopped by ${signal}`));
      else if (code !== 0) reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      else resolve();
    });
  });
}
