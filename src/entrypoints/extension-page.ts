import { installPageAgent, type PageAgentTarget } from "../page/page-agent";

/**
 * Runs in the page's own world (`"world": "MAIN"` in both manifests), which is the only place X's
 * `fetch` is visible. It patches nothing until the isolated world posts a config enabling a hook.
 */
installPageAgent(globalThis as unknown as PageAgentTarget);
