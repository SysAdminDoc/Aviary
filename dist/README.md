<img src="https://github.com/SysAdminDoc/Aviary/raw/main/src/extension/icons/icon-128.png" alt="Aviary bird icon" width="72" height="72">

# Aviary v1.49.4

![Version](https://img.shields.io/badge/version-1.49.4-2f81f7) [![License](https://img.shields.io/badge/license-MIT-3fb950)](https://github.com/SysAdminDoc/Aviary/blob/main/LICENSE) ![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Firefox%20%7C%20userscript-8b5cf6) ![Runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-0ea5e9)

**A quieter X. A local copy of what matters.**

Aviary adds media downloads and ad removal to X, with a Control Center for everything else.
Choose a reading preset, filter your feed or keep a searchable library of posts in your browser.
It doesn't need a separate Aviary account. Optional integrations stay off until you enable them.

[Download v1.49.4](https://github.com/SysAdminDoc/Aviary/releases/tag/v1.49.4) · [Installation guide](https://github.com/SysAdminDoc/Aviary/blob/main/docs/INSTALL.md) · [Feature reference](https://github.com/SysAdminDoc/Aviary/blob/main/docs/FEATURES.md) · [Privacy](https://github.com/SysAdminDoc/Aviary/blob/main/docs/PRIVACY.md)

![Aviary's installed extension showing six reading and archiving presets](https://github.com/SysAdminDoc/Aviary/raw/main/docs/marketing/presets.png)

*Captured from the built v1.49.4 extension in an isolated browser. X pages and posts in these
screenshots are synthetic test content, not a signed-in account or evidence of current live-X compatibility.*

## Install

No build tools are needed for these downloads. Aviary isn't listed in a browser extension store.
Use the Chromium extension for the most complete installation path.

| Your browser | Download | Installation |
| --- | --- | --- |
| Chrome, Edge or Brave | [Chromium ZIP](https://github.com/SysAdminDoc/Aviary/releases/download/v1.49.4/extension-chrome-v1.49.4.zip) | Extract it to a folder you'll keep. Open your browser's extensions page, enable **Developer mode**, then choose **Load unpacked** and select the folder containing `manifest.json`. |
| Firefox | [Firefox ZIP](https://github.com/SysAdminDoc/Aviary/releases/download/v1.49.4/extension-firefox-v1.49.4.zip) | Extract it. Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, then select `manifest.json`. This unsigned add-on disappears when Firefox restarts. |
| A userscript manager | [Install userscript](https://raw.githubusercontent.com/SysAdminDoc/Aviary/main/dist/aviary.user.js) | Open the link in Tampermonkey or Violentmonkey and review the manager's install prompt. Read the limitation below before choosing this route. |

The Firefox manifest still has a **placeholder add-on id**. It isn't an AMO-signed permanent
installation. The secondary Chromium CRX3 is self-signed, not store approval; use the ZIP above
for developer loading. Neither path removes your browser's developer or signing restrictions.

**Userscript limitation:** Violentmonkey's content mode cannot install Aviary's page-world observer.
Structural ad removal and local controls still work, but promoted logging refusal, broader analytics
refusal and direct video-variant discovery are unavailable there. Trust reports the limitation.
See the [manager and permission details](https://github.com/SysAdminDoc/Aviary/blob/main/docs/INSTALL.md).

After installation, refresh X and click the Aviary launcher in its left navigation. In the extension's
**Options** page, **Grant download access** enables browser-managed saves. Media buttons can open
a file instead of saving it when that optional permission is absent.

## Start with two useful defaults

Ad removal and media buttons are on. Themes, layout cleanup, filters, offscreen video pausing and
broader analytics refusal start off, so a fresh install doesn't repaint your feed.

- **Save media from a post.** Download photos, or the best direct video URL Aviary has observed.
  Media history helps prevent duplicate downloads. Adaptive video can use an optional local
  yt-dlp helper; it isn't required for direct MP4 downloads.
- Aviary removes recognized ad containers and closes their gaps. The extension also blocks X's
  separate promoted-content logging endpoint. It does **not** remove sponsored bytes from a
  timeline response that also contains ordinary posts.

Choose **Quiet Reader** to reduce distractions or **Media Archivist** for media-focused settings.
Every preset shows the changes it will apply.

## Make X easier to read

![The current Appearance controls, with theme and layout changes off by default](https://github.com/SysAdminDoc/Aviary/raw/main/docs/marketing/appearance.png)

**Appearance** offers Noir and other themes. Keep X's own styling, use a denser timeline or hide
engagement counts. **Filtering** adds keyword and media rules with hide or dim actions. Saved
hidden posts can be restored, including from the Undo action after hiding one.

Control Center settings stay in a draft until you choose **Save**. **Revert** restores the saved
values. The detailed [feature reference](https://github.com/SysAdminDoc/Aviary/blob/main/docs/FEATURES.md) explains the individual controls.

## Keep a copy you can use later

![The installed extension's Export controls for local formats and capture settings](https://github.com/SysAdminDoc/Aviary/raw/main/docs/marketing/export.png)

Save local bookmarks with notes and tags, then search them alongside captured posts. Export the
records you've collected as JSON, CSV, Markdown, HTML or XLSX. The ZIP includes an offline viewer.
WARC and WACZ are available for preservation workflows.

The Library storage view measures the active profile's collections. It reports unavailable
measurements explicitly instead of implying an empty library.

Capture is bounded by what the page has rendered or already received. Aviary doesn't fetch a
complete account history or invent missing replies. Official X archive imports are a separate
local workflow. The [feature reference](https://github.com/SysAdminDoc/Aviary/blob/main/docs/FEATURES.md) covers formats, limits and recovery.

## Know what stays local

The default build sends no telemetry and loads no remote code. Text search, bookmarks and library
backups don't require a provider account. Media downloads contact the selected media URL.
Optional integrations can send data to an endpoint you configure; they are off by default.

The **Local AI command menu is off by default**. On its own it builds a prompt locally. A separately
configured provider runner can send it after disclosure. Semantic search also uses an optional
provider; ordinary text search does not. [Read the complete network and storage map](https://github.com/SysAdminDoc/Aviary/blob/main/docs/PRIVACY.md).

**Back up before removing the extension.** Export a full library backup, not just settings.
Ordinary extension removal deletes its own stored library. Downloaded files remain on disk;
userscript-manager retention follows the manager. Aviary doesn't encrypt browser storage.

## Compatibility and help

The extension targets Chromium 102+ and Firefox 140+. Use a maintained browser release.
X changes frequently. The current DOM reference was captured on May 19, 2026; its existing
freshness waiver expires September 30, 2026. Isolated fixture tests aren't a fresh authenticated-X check.

If controls disappear after an X change, open **Trust → Selector health** and copy the redacted
diagnostics. Include your browser, install method and Aviary version in a
[bug report](https://github.com/SysAdminDoc/Aviary/issues/new?template=bug_report.yml).
Don't attach your credentials, account archive or private posts.

[Troubleshooting and settings reference](https://github.com/SysAdminDoc/Aviary/blob/main/docs/FAQ.md) · [Update and uninstall](https://github.com/SysAdminDoc/Aviary/blob/main/docs/INSTALL.md)

## Build from source

Use the Node version in `.node-version`, then run:

```sh
npm ci --ignore-scripts
npm run verify:fast
```

This builds `dist/aviary.user.js`, reloadable Chrome and Firefox directories, and the ZIP packages.
Before releasing, run `npm run verify:release` for the serial visual and browser smoke lanes too.
The compact `aviary-source-v1.49.4.zip` includes code and runtime icons for a clean build;
use the full Git checkout for screenshot baselines and repository-level verification.
[Build and release details](https://github.com/SysAdminDoc/Aviary/blob/main/docs/INSTALL.md#reproduce-the-source-archive-on-linux-arm64).

<!-- docs-facts:start -->

<!-- Generated by tools/docs-facts.mjs from the manifests and the panel's own metadata.
     Edit those, then run `npm run docs:facts`. -->

Aviary 1.49.4 registers 31 feature modules, draws 14 Control Center destinations, and watches 21 selector surfaces on X.

<!-- docs-facts:end -->

## Roadmap

[CHANGELOG.md](https://github.com/SysAdminDoc/Aviary/blob/main/CHANGELOG.md) records shipped changes. [ROADMAP.md](https://github.com/SysAdminDoc/Aviary/blob/main/ROADMAP.md) tracks active work;
[Roadmap_Blocked.md](https://github.com/SysAdminDoc/Aviary/blob/main/Roadmap_Blocked.md) records work waiting on live captures or distribution access.

The [brand and screenshot archive](https://github.com/SysAdminDoc/Aviary/blob/main/assets/concepts/2026-09-09-marketing/README.md) preserves the
earlier materials and records this refresh's selections. Aviary is an independent MIT-licensed
project, not affiliated with X Corp.
