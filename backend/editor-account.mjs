import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { DatabaseSync } from "node:sqlite";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { hashPassword, verifyPassword } from "better-auth/crypto";

const messages = {
  EMAIL: "Укажите корректный email редактора.",
  PASSWORD_REQUIRED: "Нужен пароль аккаунта: запустите команду в терминале или передайте --password-stdin.",
  PASSWORD: "Пароль должен содержать от 10 до 128 символов и не содержать переводы строк.",
  PASSWORD_MISMATCH: "Пароли не совпадают. Аккаунт не создан.",
  EXISTS: "Аккаунт изменился во время выполнения команды. Повторите её с текущим паролем аккаунта.",
  PASSWORD_INVALID: "Текущий пароль аккаунта не подтверждён. Права не изменены.",
  DATABASE: "Не удалось открыть базу авторизации. Укажите существующую auth.sqlite работающего приложения.",
  USAGE: "Использование: node scripts/set-editor.mjs EMAIL [ПУТЬ_К_БАЗЕ] [--password-stdin]",
  CANCELLED: "Ввод отменён. Аккаунт не создан.",
};
const fail = code => Object.assign(new Error(messages[code]), { editorCode: code });

function normalizedEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  // Match the z.email() format accepted by Better Auth's sign-in endpoint.
  if (email.length > 254 || !/^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/.test(email)) throw fail("EMAIL");
  return email;
}

// Keep both records atomic; use Better Auth's own password format.
export async function ensureEditor(database, { email: rawEmail, password }) {
  const email = normalizedEmail(rawEmail);
  if (password === undefined) throw fail("PASSWORD_REQUIRED");
  if (typeof password !== "string" || password.length < 10 || password.length > 128 || /[\r\n\0]/.test(password)) throw fail("PASSWORD");
  const credential = () => database.prepare("SELECT u.id,a.password FROM user u LEFT JOIN account a ON a.userId=u.id AND a.providerId='credential' WHERE lower(u.email)=?").get(email);
  const prior = credential();
  if (prior && (!prior.password || !await verifyPassword({ hash: prior.password, password }))) throw fail("PASSWORD_INVALID");
  const passwordHash = prior ? null : await hashPassword(password);
  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = credential();
    if (existing?.id !== prior?.id || existing?.password !== prior?.password) throw fail("EXISTS");
    const now = new Date().toISOString();
    if (existing) {
      database.prepare("UPDATE user SET role='editor',updatedAt=? WHERE id=?").run(now, existing.id);
    } else {
      const id = randomUUID();
      database.prepare("INSERT INTO user (id,name,email,emailVerified,role,createdAt,updatedAt) VALUES (?,?,?,0,'editor',?,?)")
        .run(id, "Редактор", email, now, now);
      database.prepare("INSERT INTO account (id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?,?,'credential',?,?,?,?)")
        .run(randomUUID(), id, id, passwordHash, now, now);
    }
    database.exec("COMMIT");
    return { email, created: !existing };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function hiddenPassword() {
  const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const input = createInterface({ input: process.stdin, output, terminal: true });
  const abort = new AbortController();
  input.on("SIGINT", () => abort.abort());
  input.on("close", () => abort.abort());
  const ask = async prompt => {
    process.stderr.write(prompt);
    try { return await input.question("", { signal: abort.signal }); }
    finally { process.stderr.write("\n"); }
  };
  try {
    const password = await ask("Пароль редактора (новый для нового аккаунта, текущий для существующего; ввод скрыт): ");
    if (password !== await ask("Повторите пароль: ")) throw fail("PASSWORD_MISMATCH");
    return password;
  } catch (error) {
    if (abort.signal.aborted) throw fail("CANCELLED");
    throw error;
  } finally { input.close(); output.end(); }
}

async function stdinPassword() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024) throw fail("PASSWORD");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

export async function runEditorCli(args = process.argv.slice(2)) {
  let database;
  try {
    if (args[0] === "--") args = args.slice(1);
    if (args.length === 1 && args[0] === "--help") { console.log(messages.USAGE); return; }
    const passwordStdin = args.includes("--password-stdin");
    const positional = args.filter(value => value !== "--password-stdin");
    if (positional.length < 1 || positional.length > 2 || positional.some(value => value.startsWith("--")) || args.filter(value => value === "--password-stdin").length > 1) throw fail("USAGE");
    const email = normalizedEmail(positional[0]);
    const databasePath = resolve(positional[1] ?? process.env.AUTH_DB_PATH ?? join(process.env.DATA_DIR ?? "backend/data", "auth.sqlite"));
    try {
      if (!statSync(databasePath).isFile()) throw fail("DATABASE");
      database = new DatabaseSync(databasePath, { timeout: 5000 });
      database.exec("PRAGMA foreign_keys = ON");
      database.prepare("SELECT role FROM user LIMIT 0").all();
      database.prepare("SELECT password FROM account LIMIT 0").all();
    } catch { throw fail("DATABASE"); }
    let result;
    if (passwordStdin) {
      if (process.stdin.isTTY) throw fail("USAGE");
      result = await ensureEditor(database, { email, password: await stdinPassword() });
    } else {
      try { result = await ensureEditor(database, { email }); }
      catch (error) {
        if (error.editorCode !== "PASSWORD_REQUIRED" || !process.stdin.isTTY || !process.stderr.isTTY) throw error;
        result = await ensureEditor(database, { email, password: await hiddenPassword() });
      }
    }
    console.log(`${result.created ? "Аккаунт редактора создан" : "Права редактора назначены"}: ${result.email}`);
  } catch (error) {
    // Never include raw SQLite/provider errors or input in diagnostics.
    console.error(messages[error.editorCode] ?? "Не удалось создать редактора. Проверьте доступность и схему базы авторизации.");
    process.exitCode = 1;
  } finally { database?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runEditorCli();
