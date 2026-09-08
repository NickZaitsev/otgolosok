"use client";

import { useEffect, useRef, useState } from "react";
import { draftCheck, initialDraft, safeSourceLink, stages, type Draft, type Job, type Summary, type TtsProvider } from "./model";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function AdminDesk() {
  const token = useRef("");
  const request = useRef<AbortController | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [jobs, setJobs] = useState<Summary[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [ttsProvider, setTtsProvider] = useState<TtsProvider>("openai");
  const [ttsVoice, setTtsVoice] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const dirty = draft !== null && JSON.stringify(draft) !== baseline;

  useEffect(() => () => { request.current?.abort(); request.current = null; token.current = ""; }, []);
  useEffect(() => {
    if (!dirty && !busy) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, busy]);

  function clearAccess() {
    token.current = "";
    setTokenInput(""); setAuthenticated(false); setJobs([]); setOffset(0); setHasMore(false);
    setJob(null); setDraft(null); setBaseline(""); setConfirmed(false); setConflict(false); setNotice("");
    setTtsProvider("openai");
    setTtsVoice("");
  }

  // One operation owns the controller, including login + deep-link loading.
  async function run(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(label); setError(""); setNotice("");
    const timer = window.setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), 20000);
    try { await action(controller.signal); }
    catch (cause) {
      if (request.current !== controller) return;
      if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
        clearAccess();
        setError("Доступ закрыт. Данные и токен очищены. Проверьте ADMIN_TOKEN и адрес сайта, затем войдите снова.");
      } else if (cause instanceof ApiError && cause.status === 409) {
        setConflict(true); setConfirmed(false);
        setError("Версия задания изменилась. Ваш текст оставлен в редакторе. Скопируйте нужные правки перед загрузкой новой версии.");
      } else {
        setError(controller.signal.aborted
          ? "Время ожидания истекло. Результат операции неизвестен. Обновите задание перед повторной отправкой; локальный текст пока сохранён."
          : cause instanceof ApiError ? cause.message : "Не удалось связаться с сервером. Проверьте соединение и повторите попытку.");
        if (controller.signal.aborted && job) { setConflict(true); setConfirmed(false); }
      }
    } finally {
      window.clearTimeout(timer);
      if (request.current === controller) { request.current = null; setBusy(""); }
    }
  }

  async function api<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
    const response = await fetch(`/api/story-admin/jobs${path}`, {
      method: body === undefined ? "GET" : "POST", cache: "no-store", credentials: "omit",
      redirect: "error", signal,
      headers: { Authorization: `Bearer ${token.current}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: "Сервер отклонил черновик. Проверьте текст, объём и привязку к фактам.",
        404: "Задание не найдено. Выберите другое задание в очереди.",
        429: "Лимит запросов или очередь заполнены. Подождите минуту и повторите попытку.",
        503: "Сервис озвучивания недоступен. Сохранённый черновик можно утвердить позже.",
      };
      throw new ApiError(response.status, messages[response.status] ?? `Ошибка сервера (${response.status}). Повторите попытку позже.`);
    }
    const result = await response.json() as T;
    signal.throwIfAborted();
    return result;
  }

  function accept(value: Job, preserveTts = false) {
    const next = initialDraft(value);
    setJob(value); setDraft(next); setBaseline(JSON.stringify(next)); setConfirmed(false); setConflict(false);
    if (!preserveTts) {
      setTtsProvider(value.data.ttsProvider);
      setTtsVoice(value.data.ttsVoice ?? value.ttsProviders.find(option => option.id === value.data.ttsProvider)?.defaultVoice ?? "");
    }
    setJobs(current => current.map(item => item.id === value.id ? value : item));
    window.history.replaceState(window.history.state, "", `/admin?job=${value.id}`);
  }

  function consent() {
    return !dirty || window.confirm("Есть несохранённые правки. Отбросить их и продолжить?");
  }

  async function loadQueue(nextOffset: number, signal: AbortSignal) {
    const result = await api<{ jobs: Summary[]; hasMore: boolean }>(`?limit=50&offset=${nextOffset}`, signal);
    setJobs(result.jobs); setHasMore(result.hasMore); setOffset(nextOffset);
  }

  function openJob(id: string, reload = false) {
    if (request.current || !consent()) return;
    if (reload && conflict && !dirty && !window.confirm("Загрузить текущую версию задания с сервера?")) return;
    void run("Загрузка задания…", async signal => accept((await api<{ job: Job }>(`/${id}`, signal)).job));
  }

  function change(next: Draft) { setDraft(next); setConfirmed(false); }

  const facts = job?.data.evidence?.facts ?? [];
  const check = draft ? draftCheck(draft, facts) : null;
  const editable = job?.stage === "review_required" && Boolean(facts.length);
  const savedUnchanged = Boolean(job?.data.editorDraft && draft && JSON.stringify(draft) === JSON.stringify(job.data.editorDraft));
  const selectedTts = job?.ttsProviders.find(option => option.id === ttsProvider);
  const selectedVoice = selectedTts?.voices.find(voice => voice.id === ttsVoice);
  const approvalAllowed = Boolean(job?.canApprove && selectedTts?.available && selectedVoice && savedUnchanged && !dirty && !conflict && confirmed);

  return (
    <main className="admin-desk">
      <header className="admin-masthead">
        {/* A document navigation invokes beforeunload and destroys the in-memory session. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="admin-wordmark" href="/" aria-disabled={Boolean(busy)} onClick={event => { if (request.current) event.preventDefault(); }}>отголосок<span>.</span></a>
        <span className="admin-eyebrow">Редакционный кабинет</span>
        {authenticated && <button disabled={Boolean(busy)} onClick={() => {
          if (!request.current && consent()) { clearAccess(); setError(""); window.history.replaceState(window.history.state, "", "/admin"); }
        }}>Выйти</button>}
      </header>
      <div className="admin-heading"><p className="admin-eyebrow">Текст / факты / голос</p><h1>Перед публикацией</h1><p>Проверьте историю по источникам. Последнее слово за редактором.</p></div>
      <div role="status" aria-live="polite" className="admin-status">{busy || notice}</div>
      {error && <div role="alert" className="admin-error">{error}</div>}
      {!authenticated ? (
        <form className="admin-login" onSubmit={event => {
          event.preventDefault();
          if (request.current || !tokenInput.trim()) return;
          token.current = tokenInput.trim(); setTokenInput("");
          void run("Проверка доступа…", async signal => {
            await loadQueue(0, signal); setAuthenticated(true);
            const id = new URLSearchParams(window.location.search).get("job");
            if (id && UUID.test(id)) accept((await api<{ job: Job }>(`/${id}`, signal)).job);
            else if (id) setError("В ссылке указан неверный идентификатор задания. Выберите задание из очереди.");
          });
        }}>
          <p className="admin-eyebrow">Доступ для редактора</p><h2>Войти в редакцию</h2>
          <label htmlFor="admin-token">ADMIN_TOKEN</label>
          <input id="admin-token" type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" value={tokenInput} onChange={event => setTokenInput(event.target.value)} disabled={Boolean(busy)} required />
          <p id="admin-token-note">Токен хранится только в памяти этой вкладки. После выхода или перезагрузки потребуется новый вход.</p>
          <button className="admin-primary" type="submit" disabled={Boolean(busy) || !tokenInput.trim()} aria-describedby="admin-token-note">Открыть очередь</button>
        </form>
      ) : (
        <div className="admin-workspace" aria-busy={Boolean(busy)}>
          <aside className="admin-queue" aria-labelledby="admin-queue-title">
            <div className="admin-section-head"><h2 id="admin-queue-title">Очередь</h2><button disabled={Boolean(busy)} onClick={() => void run("Обновление очереди…", signal => loadQueue(offset, signal))}>Обновить</button></div>
            <p className="admin-meta">{jobs.length ? `${offset + 1}–${offset + jobs.length}` : "Нет заданий на этой странице"}</p>
            <ul>{jobs.map(item => <li key={item.id}><button className="admin-job" aria-current={job?.id === item.id ? "true" : undefined} disabled={Boolean(busy)} onClick={() => openJob(item.id)}>
              <span className="admin-eyebrow">{stages[item.stage] ?? item.stage}</span><strong>{item.address}</strong><span className="admin-meta">Версия {item.revision} · {item.id.slice(0, 8)}</span>
            </button></li>)}</ul>
            <nav className="admin-actions" aria-label="Страницы очереди">
              <button disabled={Boolean(busy) || offset === 0} onClick={() => void run("Загрузка очереди…", signal => loadQueue(Math.max(0, offset - 50), signal))}>Назад</button>
              <button disabled={Boolean(busy) || !hasMore} onClick={() => void run("Загрузка очереди…", signal => loadQueue(offset + 50, signal))}>Далее</button>
            </nav>
            <p className="admin-meta">Смена страницы очереди не меняет открытый текст.</p>
          </aside>
          {!job || !draft ? <section className="admin-empty"><p className="admin-eyebrow">Редакторская проверка</p><h2>Выберите историю</h2><p>Здесь появятся текст, замечания проверки и цитаты из источников.</p></section> : (
            <article className="admin-document">
              <header className="admin-document-head"><p className="admin-eyebrow">{stages[job.stage] ?? job.stage} / версия {job.revision}</p><h2>{job.address}</h2><p className="admin-meta">{job.id} · Обновлено {new Date(job.updatedAt).toLocaleString("ru-RU")}</p>
                <button disabled={Boolean(busy)} onClick={() => openJob(job.id, true)}>{conflict ? "Загрузить новую версию" : "Обновить задание"}</button>
              </header>
              {job.error && <p className="admin-callout">{job.error.message}</p>}
              <section className="admin-review" aria-labelledby="admin-review-title"><h3 id="admin-review-title">Последняя проверка</h3>
                {job.data.review ? <><p>{job.data.review.approved ? "Автоматическая проверка пройдена." : "Автоматическая проверка не пройдена."}</p>{job.data.review.issues.length ? <ul>{job.data.review.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : <p>Замечаний к тексту нет.</p>}</> : <p>Результата проверки текста пока нет.</p>}
                {job.data.factReview && <div className="admin-identity"><h4>Идентификация места</h4><p>{job.data.factReview.placeName} · {job.data.factReview.resolvedAddress}</p><p>{job.data.factReview.addressConfirmed ? "Адрес подтверждён проверкой." : "Адрес не подтверждён проверкой."}</p><p>{job.data.factReview.identityNote || "Комментарий к идентификации отсутствует."}</p></div>}
              </section>
              {!facts.length && <div className="admin-callout"><h3>Нет проверенной доказательной базы</h3><p>Без подтверждённых фактов и источников нельзя сохранить редакторский текст или разрешить озвучивание. Доступные наброски показаны только для чтения. Требуется повторная проверка источников на стороне сервиса.</p></div>}
              <div className="admin-editor-grid">
                <section className="admin-editor" aria-labelledby="admin-draft-title"><h3 id="admin-draft-title">Редакторский текст</h3>
                  <p className="admin-meta">{dirty ? "Есть несохранённые правки" : job.data.editorDraft ? "Сохранённая редакторская версия" : "Исходный набросок: сохраните перед утверждением"}</p>
                  <fieldset disabled={Boolean(busy) || !editable}><legend className="admin-sr-only">Редактирование истории</legend>
                    <label htmlFor="admin-title">Заголовок</label><input id="admin-title" maxLength={140} value={draft.title} onChange={event => change({ ...draft, title: event.target.value })} />
                    {draft.paragraphs.map((paragraph, index) => <div className="admin-paragraph" key={index}>
                      <label htmlFor={`admin-paragraph-${index}`}>Абзац {index + 1}</label><textarea id={`admin-paragraph-${index}`} rows={7} maxLength={2000} value={paragraph.text} onChange={event => change({ ...draft, paragraphs: draft.paragraphs.map((p, i) => i === index ? { ...p, text: event.target.value } : p) })} />
                      <fieldset className="admin-fact-picks"><legend>Факты, подтверждающие абзац {index + 1}</legend>{facts.map(fact => <label key={fact.id}><input type="checkbox" checked={paragraph.factIds.includes(fact.id)} onChange={event => change({ ...draft, paragraphs: draft.paragraphs.map((p, i) => i === index ? { ...p, factIds: event.target.checked ? [...p.factIds, fact.id] : p.factIds.filter(id => id !== fact.id) } : p) })} /><span><b>{fact.id}</b> {fact.claim}</span></label>)}</fieldset>
                      <button disabled={draft.paragraphs.length <= 2} onClick={() => change({ ...draft, paragraphs: draft.paragraphs.filter((_, i) => i !== index) })}>Удалить абзац {index + 1}</button>
                    </div>)}
                    <button disabled={draft.paragraphs.length >= 6} onClick={() => change({ ...draft, paragraphs: [...draft.paragraphs, { text: "", factIds: [] }] })}>Добавить абзац</button>
                  </fieldset>
                </section>
                <aside className="admin-evidence" aria-labelledby="admin-evidence-title"><h3 id="admin-evidence-title">На чём основан текст</h3>
                  {job.data.evidence && <p className="admin-meta">{job.data.evidence.placeName}<br />{job.data.evidence.resolvedAddress}</p>}
                  {facts.map(fact => <section className="admin-fact" key={fact.id}><h4>{fact.id} / {fact.claim}</h4>{fact.evidence.map((proof, index) => {
                    const source = job.data.evidence?.sources.find(s => s.id === proof.sourceId);
                    const href = safeSourceLink(source?.url ?? null);
                    return <div key={index}><blockquote>{proof.quote}</blockquote><p className="admin-meta">{source?.publisher && `${source.publisher} · `}{href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{source?.title || proof.sourceId} (новая вкладка)</a> : `${source?.title || proof.sourceId}: ссылка недоступна`}</p></div>;
                  })}</section>)}
                  {!facts.length && <p>Подтверждённых фактов нет.</p>}
                </aside>
              </div>
              <footer className="admin-publish"><h3>Решение редактора</h3><p>{check?.words} слов из 100–250 · {check?.facts} из минимум 5 фактов · {draft.paragraphs.length} абзацев из 2–6.</p><p className="admin-meta">У каждого абзаца должен быть текст и хотя бы один подтверждающий факт. Сохранение не запускает озвучивание.</p>
                <button disabled={Boolean(busy) || !editable || !check?.valid || conflict || (!dirty && Boolean(job.data.editorDraft))} onClick={() => void run("Сохранение текста…", async signal => {
                  accept((await api<{ job: Job }>(`/${job.id}/edit`, signal, { revision: job.revision, draft })).job, true);
                  setNotice("Редакторский текст сохранён. Проверьте его и подтвердите решение перед озвучиванием.");
                })}>Сохранить текст</button>
                <div className="admin-tts">
                  <label htmlFor="admin-tts-provider">Сервис озвучивания</label>
                  <select id="admin-tts-provider" value={ttsProvider} disabled={Boolean(busy) || !editable || conflict} aria-describedby="admin-tts-note" onChange={event => {
                    const next = event.target.value as TtsProvider;
                    setTtsProvider(next);
                    setTtsVoice(job.ttsProviders.find(option => option.id === next)?.defaultVoice ?? "");
                    setConfirmed(false);
                  }}>
                    {job.ttsProviders.map(option => <option key={option.id} value={option.id} disabled={!option.available}>{option.label}{option.available ? "" : " — недоступен"}</option>)}
                  </select>
                  <label className="admin-voice-label" htmlFor="admin-tts-voice">Голос</label>
                  <select id="admin-tts-voice" value={ttsVoice} disabled={Boolean(busy) || !editable || conflict || !selectedTts?.available} onChange={event => {
                    setTtsVoice(event.target.value); setConfirmed(false);
                  }}>
                    {ttsVoice && !selectedVoice ? <option value={ttsVoice} disabled>{ttsVoice} — недоступен</option> : null}
                    {selectedTts?.voices.map(voice => <option key={voice.id} value={voice.id}>{voice.label}{voice.id === selectedTts.defaultVoice ? " (по умолчанию)" : ""}</option>)}
                  </select>
                  <p id="admin-tts-note" className="admin-meta">{job.ttsProviders.some(option => option.id === "yandex" && option.available)
                    ? "Текст будет озвучен выбранным голосом. Повторная попытка использует тот же сервис и голос."
                    : "Яндекс SpeechKit недоступен. Для подключения нужен ключ Яндекса в настройках сервера."}</p>
                </div>
                <label className="admin-confirm"><input type="checkbox" checked={confirmed} disabled={Boolean(busy) || !job.canApprove || !savedUnchanged || dirty || conflict} onChange={event => setConfirmed(event.target.checked)} /><span>Я сверил текст с цитатами, проверил адрес и подтверждаю сохранённую версию для публикации и озвучивания.</span></label>
                <button className="admin-primary" disabled={Boolean(busy) || !approvalAllowed} onClick={() => {
                  if (!approvalAllowed || request.current || !window.confirm(`Утвердить сохранённый текст и озвучить через ${selectedTts?.label}, голос «${selectedVoice?.label}»?`)) return;
                  void run("Отправка на озвучивание…", async signal => {
                    accept((await api<{ job: Job }>(`/${job.id}/approve`, signal, { revision: job.revision, ttsProvider, ttsVoice })).job);
                    setNotice("Текст утверждён. Озвучивание поставлено в очередь. Обновите задание, чтобы проверить готовность.");
                  });
                }}>Утвердить и озвучить</button>
                {!job.canApprove && editable && <p className="admin-meta">Сервер пока не разрешает утверждение. Сохраните корректный текст; если разрешение не появится, проверьте доступность сервиса и доказательную базу.</p>}
                {(job.stage === "ready" || (job.data.editorDraft && job.stage !== "review_required")) && <p className="admin-result"><a href={`/create?job=${job.id}`} target="_blank" rel="noopener noreferrer">{job.stage === "ready" ? "Открыть готовую историю" : "Открыть публичную страницу задания"} (новая вкладка)</a></p>}
              </footer>
            </article>
          )}
        </div>
      )}
    </main>
  );
}
