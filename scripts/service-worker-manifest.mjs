const precacheNames = new Set(["index.html", "login.html", "account.html", "walk.html", "history.html", "icon.svg", "manifest.webmanifest"]);

export function normalizeOutputPath(file) {
  return file.replaceAll("\\", "/");
}

export function selectPrecacheFiles(files) {
  return files.map(normalizeOutputPath).filter(file =>
    precacheNames.has(file) || /^(?:en|zh)(?:\/(?:login|account|walk|history))?\.html$/.test(file) || /^(?:en|zh)\/manifest\.webmanifest$/.test(file) || /^(?:_next\/static|data|audio|icons)\/.+\.[^/]+$/.test(file),
  ).sort();
}

export function precacheUrl(file) {
  if (file === "index.html") return "/";
  if (["login.html", "account.html", "walk.html", "history.html"].includes(file)) return `/${file.slice(0, -5)}`;
  if (/^(?:en|zh)(?:\/(?:login|account|walk|history))?\.html$/.test(file)) return `/${file.slice(0, -5)}`;
  return `/${file}`;
}
