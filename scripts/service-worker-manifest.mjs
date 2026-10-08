const precacheNames = new Set(["index.html", "login.html", "account.html", "account/walks.html", "walk.html", "history.html", "trends.html", "icon.svg", "manifest.webmanifest"]);
const localizedPage = /^(?:en|zh)(?:\/(?:login|account(?:\/walks)?|walk|history|trends))?\.html$/;

export function normalizeOutputPath(file) {
  return file.replaceAll("\\", "/");
}

export function selectPrecacheFiles(files) {
  return files.map(normalizeOutputPath).filter(file =>
    precacheNames.has(file) || localizedPage.test(file) || /^(?:en|zh)\/manifest\.webmanifest$/.test(file) || /^(?:_next\/static|data|audio|icons)\/.+\.[^/]+$/.test(file),
  ).sort();
}

export function precacheUrl(file) {
  if (file === "index.html") return "/";
  if (["login.html", "account.html", "account/walks.html", "walk.html", "history.html", "trends.html"].includes(file)) return `/${file.slice(0, -5)}`;
  if (localizedPage.test(file)) return `/${file.slice(0, -5)}`;
  return `/${file}`;
}
