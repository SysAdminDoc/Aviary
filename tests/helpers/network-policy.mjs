import { importSourceModule } from "./source-import.mjs";

/**
 * Installs an explicit outbound policy for a spec that exercises an integration.
 *
 * The module used to start permissive, so a test that never mentioned the policy still reached the
 * network — and every test that "reset" it afterwards restored exactly the state the product is
 * not allowed to be in. Nothing outbound is permitted until a policy is installed now, so a spec
 * that wants a request to go through says so, in one line, at the point it depends on it.
 *
 * `allowOutbound()` is the ordinary case: not in local-only mode. `blockOutbound()` is the
 * opposite, for a spec asserting the refusal.
 */
export async function allowOutbound() {
  const { setLocalOnlyPolicy } = await importSourceModule(
    "src/features/integrations/network-policy.ts"
  );
  setLocalOnlyPolicy(() => false);
}

export async function blockOutbound() {
  const { setLocalOnlyPolicy } = await importSourceModule(
    "src/features/integrations/network-policy.ts"
  );
  setLocalOnlyPolicy(() => true);
}

/** Leaves the module with no policy at all, which is the state a fresh boot starts in. */
export async function uninstallOutboundPolicy() {
  const { resetLocalOnlyPolicy } = await importSourceModule(
    "src/features/integrations/network-policy.ts"
  );
  resetLocalOnlyPolicy();
}
