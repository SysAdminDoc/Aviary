import type { FeatureModule } from "../registry.ts";
import { aiCommandMenuFeature } from "../ai/command-menu.ts";
import { composerSnippetsFeature } from "../composer/composer-snippets.ts";
import { exportFeature } from "../export/export-feature.ts";
import { networkCaptureFeature } from "../export/network-capture.ts";
import { cleanShareLinksFeature } from "../library/clean-share-links.ts";
import { copyPostLinkFeature } from "../library/copy-post-link.ts";
import { linkUnshortenFeature } from "../library/link-unshorten.ts";
import { snapshotsFeature } from "../library/snapshots-feature.ts";
import { userNotesFeature } from "../library/user-notes.ts";
import { bookmarksFeature } from "../library/bookmarks-feature.ts";

/**
 * Features whose code is only needed for the panel, archive, or explicitly enabled integrations.
 *
 * The extension bundles this list with the panel chunk. The userscript imports it normally so its
 * single readable file keeps the same surface as before.
 */
export const optionalFeatureModules: FeatureModule[] = [
  exportFeature,
  bookmarksFeature,
  userNotesFeature,
  linkUnshortenFeature,
  cleanShareLinksFeature,
  copyPostLinkFeature,
  snapshotsFeature,
  composerSnippetsFeature,
  networkCaptureFeature,
  aiCommandMenuFeature
];
