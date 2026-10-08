"use client";
import { AppHeader } from "../navigation/app-header";
import { FormEvent, useEffect, useState } from "react";
import { getAuthProviders, getSession, getTelegramAuthorizationUrl, signInWithPassword, signUpWithPassword } from "./client";
import { safeReturnTo } from "./return-to";
import "./auth.css";
import { toUserMessage } from "@/lib/errors/user-message";
import { useI18n } from "@/lib/i18n/provider";

export function Login() {
  const { locale, t } = useI18n();
  const [mode,setMode]=useState<"sign-in"|"sign-up">("sign-in"),[name,setName]=useState(""),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[busy,setBusy]=useState(false),[telegramBusy,setTelegramBusy]=useState(false),[error,setError]=useState("");
  const [providerState,setProviderState]=useState<"loading"|"enabled"|"disabled"|"error">("loading"),[providerAttempt,setProviderAttempt]=useState(0);
  useEffect(()=>{
    const parameters = new URLSearchParams(location.search);
    const telegramFailed = parameters.get("telegram_error") === "1";
    getSession().then(user=>{if(telegramFailed)setError(t("Не удалось войти через Telegram. Попробуйте ещё раз."));else if(user)location.replace(safeReturnTo(parameters.get("returnTo"),location.origin,locale));}).catch(()=>setError(t(telegramFailed?"Не удалось войти через Telegram. Попробуйте ещё раз.":"Не удалось проверить вход. Можно попробовать войти ниже.")));
  },[locale,t]);
  useEffect(()=>{
    let active=true;
    getAuthProviders().then(providers=>{if(active)setProviderState(providers.telegram?"enabled":"disabled");}).catch(()=>{if(active)setProviderState("error");});
    return()=>{active=false;};
  },[providerAttempt]);
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError("");try{if(mode==="sign-up")await signUpWithPassword(name,email,password);else await signInWithPassword(email,password);const target=new URLSearchParams(location.search).get("returnTo");location.replace(safeReturnTo(target,location.origin,locale));}catch(e){setError(toUserMessage(e, "Не удалось войти.", locale));}finally{setBusy(false);}}
  async function telegram(){
    if(telegramBusy)return;
    setTelegramBusy(true);setError("");
    try{const target=new URLSearchParams(location.search).get("returnTo");const authorizationURL=await getTelegramAuthorizationUrl(target,locale,location.origin);location.replace(authorizationURL);}
    catch(e){setError(toUserMessage(e,"Не удалось открыть вход через Telegram. Попробуйте ещё раз.",locale));setTelegramBusy(false);}
  }
  function switchMode(){setMode(current=>current==="sign-in"?"sign-up":"sign-in");setError("");}
  return <main className="ui-page"><AppHeader /><section className="auth-card"><p className="kicker">{t("Личный кабинет")}</p><h1>{t(mode==="sign-in"?"Вход":"Регистрация")}</h1><p>{t(mode==="sign-in"?"Войдите, чтобы открыть свои прогулки и сохранённые истории.":"Создайте аккаунт, чтобы сохранять прогулки и открывать их на других устройствах.")}</p>{providerState==="enabled"&&<><button type="button" className="telegram-button" disabled={telegramBusy||busy} onClick={()=>void telegram()}><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 4.2 18.8 19c-.2 1-1 1.2-1.8.8l-4.3-3.2-2.1 2c-.2.2-.4.4-.9.4l.3-4.4 8-7.2c.4-.3-.1-.5-.5-.2l-9.9 6.2-4.3-1.3c-.9-.3-.9-.9.2-1.3L20.2 4c.8-.3 1.5.2 1.4.2z"/></svg>{t(telegramBusy?"Открываем Telegram…":"Продолжить через Telegram")}</button><div className="auth-separator"><span>{t("или по email")}</span></div></>}{providerState==="error"&&<p className="auth-provider-error" role="alert">{t("Не удалось проверить доступность входа через Telegram.")} <button type="button" onClick={()=>{setProviderState("loading");setProviderAttempt(value=>value+1);}}>{t("Повторить")}</button></p>}<form onSubmit={submit}>{mode==="sign-up"&&<label>{t("Имя")}<input required autoComplete="name" maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>}<label>Email<input required autoComplete="email" type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>{t("Пароль")}<input required autoComplete={mode==="sign-in"?"current-password":"new-password"} type="password" minLength={10} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label>{mode==="sign-up"&&<p className="auth-hint">{t("Не менее 10 символов. Восстановление пароля пока недоступно.")}</p>}{error&&<p role="alert" className="form-error">{error}</p>}<button disabled={busy||telegramBusy} className="account-button">{t(busy?"Подождите…":mode==="sign-in"?"Войти":"Создать аккаунт")}</button></form><button type="button" className="text-button" disabled={busy||telegramBusy} onClick={switchMode}>{t(mode==="sign-in"?"Нет аккаунта? Зарегистрироваться":"Уже есть аккаунт? Войти")}</button></section></main>;
}
