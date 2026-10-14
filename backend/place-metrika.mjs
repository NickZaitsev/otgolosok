import { createHash } from "node:crypto";
import { LEGAL_READY } from "../legal/publication.mjs";

/**
 * Yandex Metrica on place pages. The page is rendered here, outside the static site and its React counter
 * (src/features/analytics/metrika.ts), so it carries its own small script with the same rules: it runs only after
 * the visitor accepted analytics on the site (the stored choice of src/features/legal/cookie-consent.ts, checked
 * exactly as cookieChoice does), sends the path without query, no title, no Webvisor or click map. The referrer is cut
 * to its origin: enough to tell search from other traffic, without anyone's query string.
 * Goals: place_audio_play (first play), place_audio_end, place_open_map.
 */
export const METRIKA_ID = 113326536;
export const CONSENT_KEY = "otgolosok:cookie-choice";
export const CONSENT_VERSION = "2026-10-08";
export const CONSENT_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
const TAG = `https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}`;

// Exact collector origins from Yandex's CSP documentation, as in scripts/content-security-policy.mjs.
export const METRIKA_COLLECTORS = [
  "ru", "az", "by", "co.il", "com", "com.am", "com.ge", "com.tr", "ee",
  "fr", "kg", "kz", "lt", "lv", "md", "tj", "tm", "uz",
].map(zone => `https://mc.yandex.${zone}`).concat("https://mc.webvisor.com", "https://mc.webvisor.org");

export const PLACE_METRIKA_SCRIPT = `(()=>{
const id=${METRIKA_ID},now=Date.now();let choice=null;
try{choice=JSON.parse(localStorage.getItem(${JSON.stringify(CONSENT_KEY)})??"null");}catch{return;}
if(!choice||choice.version!==${JSON.stringify(CONSENT_VERSION)}||choice.analytics!==true||!Number.isFinite(choice.decidedAt)||choice.decidedAt>now||now-choice.decidedAt>=${CONSENT_LIFETIME_MS}||typeof choice.receipt!=="string"||!/^[a-f0-9-]{36}\\.[A-Za-z0-9_-]{43}$/.test(choice.receipt))return;
const url=location.origin+location.pathname;let referer="";
try{referer=document.referrer?new URL(document.referrer).origin+"/":"";}catch{}
const ym=window.ym=window.ym||Object.assign(function(){(ym.a=ym.a||[]).push(arguments);},{l:now});
const load=attempt=>{const tag=document.createElement("script");tag.async=true;tag.src=${JSON.stringify(TAG)};
tag.onerror=()=>{tag.remove();if(attempt<2)setTimeout(()=>load(attempt+1),1000*2**attempt);else{if(ym.a)ym.a.length=0;console.warn("Яндекс.Метрика недоступна: статистика этой страницы отключена.");}};
document.head.append(tag);};
try{
ym(id,"init",{defer:true,ssr:true,webvisor:false,clickmap:false,ecommerce:false,referrer:referer,url,sendTitle:false,accurateTrackBounce:false,trackLinks:false,disableYtm:true});
ym(id,"hit",url,{referer,title:"Отголосок"});
}catch{console.warn("Яндекс.Метрика недоступна: статистика этой страницы отключена.");return;}
load(0);
const goal=name=>{try{ym(id,"reachGoal",name);}catch{}};
const audio=document.querySelector("audio");let played=false;
audio?.addEventListener("play",()=>{if(!played){played=true;goal("place_audio_play");}});
audio?.addEventListener("ended",()=>goal("place_audio_end"));
document.getElementById("open")?.addEventListener("click",()=>goal("place_open_map"));
})();`;

/** Whether place pages carry the counter: only once the legal documents it relies on are published. */
export const PLACE_METRIKA_ENABLED = LEGAL_READY;
const SCRIPT_HASH = createHash("sha256").update(PLACE_METRIKA_SCRIPT).digest("base64");

/** CSP sources the counter needs, or none when it is off. */
export const PLACE_METRIKA_CSP = PLACE_METRIKA_ENABLED ? {
  script: `'sha256-${SCRIPT_HASH}' https://mc.yandex.ru`,
  collectors: METRIKA_COLLECTORS.join(" "),
  sockets: METRIKA_COLLECTORS.map(origin => origin.replace("https:", "wss:")).join(" "),
} : null;
