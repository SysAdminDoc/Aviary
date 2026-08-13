import { installPageAgent, type PageAgentTarget } from "../page/page-agent";

/**
 * Runs in the page's own world (`"world": "MAIN"` in both manifests), which is the only place X's
 * `fetch` is visible. The exact promoted-content logging guard starts immediately; every other
 * hook waits for the isolated world to post its persisted config.
 */
installPageAgent(globalThis as unknown as PageAgentTarget);
