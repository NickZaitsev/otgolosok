import {join} from "node:path";
import {fileURLToPath} from "node:url";

/** Корень репозитория: скрипты и тесты видео берут материалы сайта и видео от него, а не от текущей папки. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** @param {...string} parts путь от корня репозитория */
export function repoPath(...parts) {
  return join(REPO_ROOT, ...parts);
}
