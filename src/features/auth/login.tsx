"use client";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { getSession, sendLoginCode, verifyLoginCode } from "./client";
import "./auth.css";

export function Login() {
  const [email,setEmail]=useState(""),[otp,setOtp]=useState(""),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{getSession().then(user=>{if(user)location.replace("/account");});},[]);
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError("");try{if(!sent){await sendLoginCode(email);setSent(true);}else{await verifyLoginCode(email,otp);const target=new URLSearchParams(location.search).get("returnTo");location.replace(target&&target.startsWith("/")&&!target.startsWith("//")?target:"/account");}}catch(e){setError(e instanceof Error?e.message:"Не удалось войти.");}finally{setBusy(false);}}
  return <main className="account-shell"><header><Link href="/" className="wordmark">Отголосок<span>.</span></Link></header><section className="auth-card"><p className="kicker">Личный кабинет</p><h1>{sent?"Введите код":"Вход по почте"}</h1><p>{sent?`Отправили шестизначный код на ${email}.`:"Сохраняйте прогулки и открывайте их на другом устройстве."}</p><form onSubmit={submit}>{!sent?<label>Email<input required autoComplete="email" type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>:<label>Код<input required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" value={otp} onChange={e=>setOtp(e.target.value)}/></label>}{error&&<p role="alert" className="form-error">{error}</p>}<button disabled={busy} className="account-button">{busy?"Подождите…":sent?"Войти":"Получить код"}</button></form>{sent&&<button className="text-button" onClick={()=>{setSent(false);setOtp("");}}>Изменить email</button>}</section></main>;
}
