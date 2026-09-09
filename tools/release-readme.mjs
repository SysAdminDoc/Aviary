/** Keep the README useful when downloaded alone or opened from dist/. */
export function releaseReadme(markdown, repository) {
  const resolve = (target, kind) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(target)) return target;
    return `${repository}/${kind}/main/${target.replace(/^\.\//, "")}`;
  };
  return markdown
    .replace(/(!\[[^\]\n]*\]\()([^\s)]+)(\))/g,
      (_match, before, target, after) => `${before}${resolve(target, "raw")}${after}`)
    .replace(/(\]\()([^\s)]+)(\))/g,
      (_match, before, target, after) => `${before}${resolve(target, "blob")}${after}`)
    .replace(/(\bsrc=["'])([^"']+)(["'])/g,
      (_match, before, target, after) => `${before}${resolve(target, "raw")}${after}`);
}
