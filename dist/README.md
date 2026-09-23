![Aviary, a quieter way to read X and keep a local media library](https://github.com/SysAdminDoc/Aviary/raw/main/docs/marketing/social-preview.png)

# Aviary v1.54.0

![Version](https://img.shields.io/badge/version-1.54.0-2f81f7) [![License](https://img.shields.io/badge/license-MIT-3fb950)](https://github.com/SysAdminDoc/Aviary/blob/main/LICENSE) ![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Firefox%20%7C%20userscript-8b5cf6) ![Runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-0ea5e9)

<p align="center">
  <a href="https://ko-fi.com/X8K126YVER">
    <img height="42" src="https://storage.ko-fi.com/cdn/kofi2.png?v=3" alt="Buy me a coffee on Ko-fi" />
  </a>
</p>

<p align="center">
  <sub><em>If this project helps you, a coffee helps me keep working on it.</em></sub>
</p>

**A quieter X. A local copy of what matters.**

Aviary adds media downloads, ad removal, reading aids and deliberate account cleanup to X, with a
Control Center for everything else. Choose a reading preset, filter your feed or keep a searchable
library of posts in your browser. It doesn't need a separate Aviary account. Optional integrations
stay off until you enable them.

The Control Center opens on **Quick setup**, with direct paths for quieting X, filtering posts,
downloading media and deleting account activity. Eight commonly used pages stay visible. Seven
specialist pages sit under **More tools** until you need them.

[Download v1.54.0](https://github.com/SysAdminDoc/Aviary/releases/tag/v1.54.0) · [Installation guide](https://github.com/SysAdminDoc/Aviary/blob/main/docs/INSTALL.md) · [Feature reference](https://github.com/SysAdminDoc/Aviary/blob/main/docs/FEATURES.md) · [Privacy](https://github.com/SysAdminDoc/Aviary/blob/main/docs/PRIVACY.md)

![Aviary's Quick setup page with four common tasks and six ready-made setups](https://github.com/SysAdminDoc/Aviary/raw/main/docs/marketing/presets.png)

*Captured from the built v1.54.0 extension in an isolated browser. The screenshot content is
synthetic. The layout was also checked separately against a signed-in X account.*

## Install

No build tools are needed for these downloads. Aviary isn't listed in a browser extension store.
Use the Chromium extension for the most complete installation path.

| Your browser | Download | Installation |
| --- | --- | --- |
| Chrome, Edge or Brave | [Chromium ZIP](https://github.com/SysAdminDoc/Aviary/releases/download/v1.54.0/extension-chrome-v1.54.0.zip) | Extract it to a folder you'll keep. Open your browser's extensions page, enable **Developer mode**, then choose **Load unpacked** and select the folder containing `manifest.json`. |
| Firefox | [Firefox ZIP](https://github.com/SysAdminDoc/Aviary/releases/download/v1.54.0/extension-firefox-v1.54.0.zip) | Extract it. Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, then select `manifest.json`. This unsigned add-on disappears when Firefox restarts. |
| A userscript manager | [Install userscript](https://raw.githubusercontent.com/SysAdminDoc/Aviary/main/dist/aviary.user.js) | Open the link in Tampermonkey or Violentmonkey and review the manager's install prompt. On Chromium 138 and later, first turn on **Allow User Scripts** on the manager's extension details page. Read the limitation below before choosing this route. |

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

## Start in Noir with a wider reading lane

Fresh installs apply Noir and Wide. On ordinary desktop windows, Wide uses the room beside
navigation. On ultrawide displays it centers a 1,180px reading lane. Post text can use that lane,
while actions stay in a 760px group. Direct post media stops at 1,040px or 72% of the viewport
height. Replies and quoted cards remain compact. Wide also hides X's discovery rail. Ad removal and
media buttons are on; filters, offscreen video pausing, and broader analytics refusal wait for you
to enable them.

- **Save media from a post.** Download photos, or the best direct video URL Aviary has observed.
  Media history helps prevent duplicate downloads. Adaptive video can use an optional local
  yt-dlp helper; it isn't required for direct MP4 downloads.
- Aviary removes recognized ad containers and closes their gaps. The extension also blocks X's
  separate promoted-content logging endpoint. It does **not** remove sponsored bytes from a
  timeline response that also contains ordinary posts.

Choose **Quiet Reader** to reduce distractions or **Media Archivist** for media-focused settings.
Every preset shows the changes it will apply.

## Make X easier to read

![The current Look and feel controls, with Noir and Wide selected by default](https://github.com/SysAdminDoc/Aviary/raw/main/docs/marketing/appearance.png)

**Look & feel** starts with Noir. Choose Off when you want X's styling, switch to a denser timeline,
or hide engagement counts. Wide expands X's real post lane, then centers it on large displays while
keeping profile headers and media at practical sizes. **Content filters** adds keyword and media
rules with hide or dim actions. Saved hidden posts can be restored, including from the Undo action
after hiding one.

Reading also has **Hide replies with images, GIFs or video**, for comment sections that are mostly
reaction GIFs and screenshots. Any reply carrying media drops out of the thread you're reading,
caption or no caption. The post itself keeps its media, and so does the thread above it.

Two optional reading aids handle common X navigation problems. **Expand long posts automatically**
opens an outer post's own Show more control after scrolling settles. **Restore position after
Back** returns to the same visible post, then stops immediately if you scroll. The Quiet Reader
preset enables both.

Switches and fields wait until you choose **Save**. Action buttons run immediately and say what
they will do. **Revert** restores the saved values. The detailed
[feature reference](https://github.com/SysAdminDoc/Aviary/blob/main/docs/FEATURES.md) explains the individual controls.

## Clear account activity deliberately

Choose posts, replies, reposts, likes or bookmarks in **Delete X activity**, then press **Run**.
Deletion starts immediately. There is no preview, arming phrase or confirmation step. Pacing and
batch controls stay under **Advanced options** until you need them.

Cleanup removes saved activity before authored content, with short randomized waits. Balanced is
the default speed. The status line shows when X is loading older items, when Aviary is taking a
brief automatic rest, and when work continues. You can pause, resume or stop from the Control
Center. The signed-in handle is checked again during the pass, and X login or anti-abuse challenges
stop it. If X leaves an action unchanged, Aviary retries it and can reload the current page before
giving up. Before a category finishes, Aviary reloads it from the top and requires a fresh empty
pass so items omitted by a long scrolled timeline are not missed. X currently limits Like removals
to 500 in a 15-minute window. Aviary displays the
remaining wait and continues automatically in the next window. Deleted posts and replies cannot be
restored. Cleanup history keeps counts and status only. Post text is never copied into it.

## Keep a copy you can use later

![The installed extension's Import and export controls for local formats and capture settings](https://github.com/SysAdminDoc/Aviary/raw/main/docs/marketing/export.png)

Save local bookmarks with notes and tags, then search them alongside captured posts. Export the
records you've collected as JSON, CSV, Markdown, HTML or XLSX. The ZIP includes an offline viewer.
WARC and WACZ are available for preservation workflows.

The Media page can add **Copy links** beside Download. It places the best direct URL for each of the
post's own media files on the clipboard, one per line. Quoted-post and link-card media stay with
their actual owner.

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

The extension targets Chromium 111+ and Firefox 140+. Use a maintained browser release.
X changes frequently. The v1.54.0 layout was checked on September 23, 2026 against signed-in Home,
Profile, post-detail, and long comment routes at 1280 and 1920 pixel desktop widths. Account cleanup was
authenticated live-tested on September 20, 2026 with
2,868 Like removals plus controlled Repost and Post actions. Its fresh final route checks were
empty. The broader DOM reference was captured on May 19, 2026; its existing freshness waiver
expires September 30, 2026.

If controls disappear after an X change, open **More tools → Privacy & diagnostics → Selector health** and copy the redacted
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
The compact `aviary-source-v1.54.0.zip` includes code and runtime icons for a clean build;
use the full Git checkout for screenshot baselines and repository-level verification.
[Build and release details](https://github.com/SysAdminDoc/Aviary/blob/main/docs/INSTALL.md#reproduce-the-source-archive-on-linux-arm64).

<!-- docs-facts:start -->

<!-- Generated by tools/docs-facts.mjs from the manifests and the panel's own metadata.
     Edit those, then run `npm run docs:facts`. -->

Aviary 1.54.0 registers 34 feature modules, draws 15 Control Center destinations, and watches 21 selector surfaces on X.

<!-- docs-facts:end -->

## Roadmap

[CHANGELOG.md](https://github.com/SysAdminDoc/Aviary/blob/main/CHANGELOG.md) records shipped changes. [ROADMAP.md](https://github.com/SysAdminDoc/Aviary/blob/main/ROADMAP.md) tracks active work;
[Roadmap_Blocked.md](https://github.com/SysAdminDoc/Aviary/blob/main/Roadmap_Blocked.md) records work waiting on live captures or distribution access.
The [recent userscript review](https://github.com/SysAdminDoc/Aviary/blob/main/docs/USERSCRIPT_REVIEW.md) records which maintained scripts informed
the current reading and media improvements.

The [brand and screenshot archive](https://github.com/SysAdminDoc/Aviary/blob/main/assets/concepts/2026-09-09-marketing/README.md) preserves the
earlier materials and records this refresh's selections. Aviary is an independent MIT-licensed
project, not affiliated with X Corp.
