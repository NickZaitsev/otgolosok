const precacheNames = new Set(["index.html", "create.html", "login.html", "account.html", "icon.svg", "favicon.ico", "manifest.webmanifest"]);

export function normalizeOutputPath(file) {
  return file.replaceAll("\\", "/");
}

export function selectPrecacheFiles(files) {
  return files.map(normalizeOutputPath).filter(file =>
    precacheNames.has(file) || /^(?:_next\/static|data|audio)\/.+\.[^/]+$/.test(file),
  ).sort();
}

export function precacheUrl(file) {
  if (file === "index.html") return "/";
  if (["create.html", "login.html", "account.html"].includes(file)) return `/${file.slice(0, -5)}`;
  return `/${file}`;
}
