// This standalone page is deliberately outside the offline manifest. Even an
// old cache-first worker must fetch it, so recovery needs no new app code.
const statusElement = document.getElementById("update-status");
const retryButton = document.getElementById("retry-update");
const requestedLanguage = new URLSearchParams(window.location.search ?? "").get("lang");
const language = requestedLanguage === "en" || requestedLanguage === "zh" ? requestedLanguage : "ru";
const home = language === "ru" ? "/#top" : `/${language}#top`;
const copy = {
  ru: { title: "Обновление · Отголосок", heading: "Открываем новую версию", loading: "Загружаем обновление. Затем откроется первая история.", retry: "Попробовать ещё раз", back: "Вернуться к прогулке", failed: "Не удалось загрузить обновление. Проверьте интернет и попробуйте ещё раз. Сохранённая история остаётся доступной." },
  en: { title: "Update · Otgolosok", heading: "Opening the new version", loading: "Downloading the update. The first story will open next.", retry: "Try again", back: "Back to the walk", failed: "Unable to download the update. Check your connection and try again. Your saved story is still available." },
  zh: { title: "更新 · Otgolosok", heading: "正在打开新版本", loading: "正在下载更新，随后将打开第一个故事。", retry: "重试", back: "返回漫步", failed: "无法下载更新。请检查网络后重试。已保存的故事仍可使用。" },
}[language];
if (document.documentElement) document.documentElement.lang = language === "zh" ? "zh-Hans" : language;
document.title = copy.title;
const heading = document.getElementById("update-heading");
const back = document.getElementById("back-to-walk");
if (heading) heading.textContent = copy.heading;
if (back) { back.textContent = copy.back; back.href = home; }
retryButton.textContent = copy.retry;

function waitFor(target, event, predicate, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(event, check);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => { cleanup(); reject(new Error("Update timed out")); };
    const check = () => {
      if (signal.aborted) return abort();
      if (predicate()) { cleanup(); resolve(); }
    };
    target.addEventListener(event, check);
    signal.addEventListener("abort", abort, { once: true });
    check();
  });
}

async function update() {
  retryButton.hidden = true;
  statusElement.textContent = copy.loading;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const signal = controller.signal;
  const abortable = (promise) => new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Update timed out"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });

  try {
    if (!("serviceWorker" in navigator)) {
      window.location.replace(home);
      return;
    }
    const registration = await abortable(navigator.serviceWorker.register("/sw.js", {
      scope: "/", updateViaCache: "none",
    }));
    // Finish checking the server before choosing a waiting worker: an older
    // waiting build may not yet understand the activation message.
    await abortable(registration.update());
    const installing = registration.installing;
    if (installing) {
      await waitFor(installing, "statechange", () => ["installed", "activated", "redundant"].includes(installing.state), signal);
      if (installing.state === "redundant") throw new Error("Installation failed");
    }
    const worker = registration.waiting ?? registration.active;
    if (!worker) throw new Error("No installed worker");
    if (worker.state !== "activated") {
      const activated = waitFor(worker, "statechange", () => ["activated", "redundant"].includes(worker.state), signal);
      worker.postMessage({ type: "ACTIVATE_UPDATE" });
      await activated;
      if (worker.state === "redundant") throw new Error("Activation failed");
    }
    await waitFor(navigator.serviceWorker, "controllerchange", () => navigator.serviceWorker.controller === worker, signal);
    window.location.replace(home);
  } catch {
    statusElement.textContent = copy.failed;
    retryButton.hidden = false;
  } finally {
    clearTimeout(timeout);
  }
}

retryButton.addEventListener("click", () => void update());
void update();
