// Shared derivation of the userscript metablock's identity URLs.
// Lives outside build.mjs because build.mjs deletes and rebuilds dist/ at import
// time; preflight validates that same dist/ and must not trigger a rebuild.

export function repositoryUrl(manifest) {
  const raw = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("package.json must declare a repository so userscript update URLs can be derived.");
  }
  const normalized = raw.replace(/^git\+/, "").replace(/\.git$/, "");
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(normalized)) {
    throw new Error(`package.json repository must be a GitHub https URL, received "${raw}".`);
  }
  return normalized;
}

export function userscriptUrls(manifest) {
  const repository = repositoryUrl(manifest);
  const slug = repository.slice("https://github.com/".length);
  const owner = slug.split("/")[0];
  return {
    namespace: `https://github.com/${owner}`,
    script: `https://raw.githubusercontent.com/${slug}/main/dist/aviary.user.js`
  };
}
