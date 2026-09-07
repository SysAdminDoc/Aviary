import {
  openMountedControlCenter,
  startControlCenter,
  stopControlCenter
} from "../features/core/control-center.ts";
import { optionalFeatureModules } from "../features/core/optional-features.ts";

export { optionalFeatureModules, startControlCenter, stopControlCenter };

export function openControlCenter(options?: { focusSelectorHealth?: boolean }): void {
  openMountedControlCenter(options);
}
