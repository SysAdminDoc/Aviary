import type { FeatureModule } from "../features/registry.ts";

/** Build-only replacements for static userscript imports in the extension bootstrap. */
export const controlCenterFeature: FeatureModule = {
  id: "core.controlCenter",
  title: "Control Center",
  category: "core",
  init() {
    return Promise.resolve();
  },
  destroy() {
    return Promise.resolve();
  }
};

export const optionalFeatureModules: FeatureModule[] = [];
