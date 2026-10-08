"use client";
import Link from "next/link";
import { LEGAL_READY } from "../../../legal/publication.mjs";
import { LegalLinks } from "../legal/legal-links";
import legalStyles from "../legal/legal.module.css";
import { AppHeader } from "../navigation/app-header";
import { FormEvent, useEffect, useState } from "react";
import { getSession, signInWithPassword, signUpWithPassword } from "./client";
import { safeReturnTo } from "./return-to";
import "./auth.css";
import { toUserMessage } from "@/lib/errors/user-message";
import { useI18n } from "@/lib/i18n/provider";

export function Login() {
  const { locale, t } = useI18n();
  const [mode,setMode]=useState<"sign-in"|"sign-up">("sign-in"),[name,setName]=useState(""),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  useEffect(()=>{getSession().then(user=>{if(user)location.replace(safeReturnTo(new URLSearchParams(location.search).get("returnTo"),location.origin,locale));}).catch(()=>setError(t("Не удалось проверить вход. Можно попробовать войти ниже.")));},[locale,t]);
  async function submit(event:FormEvent){event.preventDefault();if(mode==="sign-up"&&(!LEGAL_READY||!termsAccepted)){setError(t("Для регистрации примите актуальные условия использования."));return;}setBusy(true);setError("");try{if(mode==="sign-up")await signUpWithPassword(name,email,password,termsAccepted);else await signInWithPassword(email,password);const target=new URLSearchParams(location.search).get("returnTo");location.replace(safeReturnTo(target,location.origin,locale));}catch(e){setError(toUserMessage(e, "Не удалось войти.", locale));}finally{setBusy(false);}}
  function switchMode(){setTermsAccepted(false);setMode(current=>current==="sign-in"?"sign-up":"sign-in");setError("");}
  return <main className="ui-page"><AppHeader /><section className="auth-card"><p className="kicker">{t("Личный кабинет")}</p><h1>{t(mode==="sign-in"?"Вход":"Регистрация")}</h1><p>{t(mode==="sign-in"?"Войдите, чтобы открыть свои прогулки и сохранённые истории.":"Создайте аккаунт, чтобы сохранять прогулки и открывать их на других устройствах.")}</p><form onSubmit={submit}>{mode==="sign-up"&&<label>{t("Имя")}<input required autoComplete="name" maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>}<label>Email<input required autoComplete="email" type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>{t("Пароль")}<input required autoComplete={mode==="sign-in"?"current-password":"new-password"} type="password" minLength={10} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label>{mode==="sign-up"&&<p className="auth-hint">{t("Не менее 10 символов. Восстановление пароля пока недоступно.")}</p>}{mode==="sign-up"&&<label className={`auth-terms ${legalStyles.checkbox}`}><input type="checkbox" required checked={termsAccepted} onChange={event=>setTermsAccepted(event.target.checked)} /><span>{t("Я принимаю")} <Link href="/legal/terms" target="_blank" rel="noopener noreferrer">{t("условия использования")}</Link>.</span></label>}<p className="auth-hint">{t("Для работы аккаунта обрабатываем имя, email и данные сессии.")} <Link href="/legal/privacy" target="_blank" rel="noopener noreferrer">{t("Политика обработки данных")}</Link>.</p>{mode==="sign-up"&&!LEGAL_READY&&<p role="status" className="auth-hint">{t("Регистрация временно недоступна.")}</p>}{error&&<p role="alert" className="form-error">{error}</p>}<button disabled={busy||(mode==="sign-up"&&(!termsAccepted||!LEGAL_READY))} className="account-button">{t(busy?"Подождите…":mode==="sign-in"?"Войти":"Создать аккаунт")}</button></form><button type="button" className="text-button" onClick={switchMode}>{t(mode==="sign-in"?"Нет аккаунта? Зарегистрироваться":"Уже есть аккаунт? Войти")}</button><LegalLinks /></section></main>;
}
