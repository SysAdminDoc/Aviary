import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";


test("ad observations retain only bounded, normalized marker counts and reset cleanly", async () => {
  const {
    AD_OBSERVATIONS_KEY,
    AD_OBSERVATION_RETENTION_MS,
    AdObservationStore
  } = await importSourceModule("src/features/core/ad-observations.ts");
  const values = new Map();
  const storage = {
    async get(key, fallback) { return structuredClone(values.get(key) ?? fallback); },
    async set(key, value) { values.set(key, structuredClone(value)); },
    async remove(key) { values.delete(key); }
  };
  let now = Date.UTC(2026, 7, 13, 12);
  values.set(AD_OBSERVATIONS_KEY, {
    version: 1,
    observations: [
      {
        at: new Date(now - AD_OBSERVATION_RETENTION_MS - 1).toISOString(),
        route: "home",
        counts: { native: 99, trend: 99, housePromo: 99, video: 99 },
        postText: "expired private copy"
      },
      {
        at: new Date(now - 1_000).toISOString(),
        route: "home",
        counts: { native: 1.8, trend: -4, housePromo: 2, video: Number.POSITIVE_INFINITY },
        handle: "private-handle",
        url: "https://x.com/?twclid=private",
        responseBody: "private body"
      }
    ]
  });

  const store = new AdObservationStore(storage, { limit: 3, now: () => now });
  await store.load();
  assert.deepEqual(store.observations(), [{
    at: new Date(now - 1_000).toISOString(),
    route: "home",
    counts: { native: 1, trend: 0, housePromo: 2, video: 0 }
  }]);
  assert.doesNotMatch(JSON.stringify(values.get(AD_OBSERVATIONS_KEY)), /postText|handle|twclid|responseBody|private/i);

  now += 1_000;
  const missing = await store.observe("home", {
    native: 0,
    trend: 0,
    housePromo: 0,
    video: 0,
    postText: "must not persist",
    handle: "must-not-persist",
    url: "https://x.com/?twclid=must-not-persist",
    responseBody: "must not persist"
  });
  assert.deepEqual(missing.missingContracts, ["native", "housePromo"]);
  assert.match(missing.degradedReason, /Formerly observed native, housePromo/);

  for (let index = 1; index <= 4; index += 1) {
    now += 1_000;
    await store.observe(index % 2 === 0 ? "home" : "search", {
      native: index,
      trend: 0,
      housePromo: 0,
      video: 0
    });
  }
  assert.equal(store.observations().length, 3);
  const serialized = JSON.stringify(values.get(AD_OBSERVATIONS_KEY));
  for (const forbidden of ["postText", "handle", "twclid", "responseBody", "private"]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
  }

  await store.clear();
  assert.equal(values.has(AD_OBSERVATIONS_KEY), false);
  assert.deepEqual(store.snapshot(), {
    lastObservedAt: null,
    lastRoute: null,
    counts: { native: 0, trend: 0, housePromo: 0, video: 0 },
    retained: 0,
    missingContracts: [],
    degradedReason: null
  });
});
