"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import type { Coordinates, Route } from "../tour/types";
import { getWalkChapters } from "../tour/walk-plan";
import { savedStories, jobUrl } from "../generator/offline";
import { stageLabels, terminalStages, type GenerationJob } from "../generator/types";
import { ExploreMap, type MapItem } from "./explore-map";
import { ExploreIcon } from "./icons";
import { isMoscowPoint, readMapJobs, type MapJob } from "./map-jobs";
import "./explore.css";

type Place = {label:string; address:string|null; location:Coordinates};
type StoryPin = MapItem & {address:string; duration?:number; chapter?:number; jobId?:string; status?:string};
type Tab = "nearby" | "walk" | "saved";
const MELNIKOV: StoryPin = {id:"4c76cc5f-0fcd-41db-a36e-e63cce9b3f09",jobId:"4c76cc5f-0fcd-41db-a36e-e63cce9b3f09",title:"Воздушные телефоны Дома Мельникова",address:"Кривоарбатский переулок, 10",location:{lat:55.74805556,lon:37.58944444},duration:56};
function distance(a:Coordinates,b:Coordinates){
  const rad=Math.PI/180,dlat=(b.lat-a.lat)*rad,dlon=(b.lon-a.lon)*rad;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2)));
}
const distanceLabel=(meters:number)=>meters<1000?`≈ ${Math.round(meters/50)*50 || 50} м`:`≈ ${(meters/1000).toFixed(1).replace(".",",")} км`;

export function AroundScreen({route,onStart,children,updateAvailable}: {route:Route;onStart:(chapter?:number)=>void;children:ReactNode;updateAvailable:boolean}) {
  const [tab,setTab]=useState<Tab>("nearby");
  const [view,setView]=useState<"map"|"list">("map");
  const [filter,setFilter]=useState<"all"|"walk">("all");
  const [search,setSearch]=useState(false),[query,setQuery]=useState("");
  const [selected,setSelected]=useState<string>();
  const [place,setPlace]=useState<Place|null>(null),[placeBusy,setPlaceBusy]=useState(false),[placeError,setPlaceError]=useState("");
  const [focus,setFocus]=useState<Coordinates|null>(null);
  const [user,setUser]=useState<(Coordinates&{accuracyM:number})|null>(null);
  const [geo,setGeo]=useState<"idle"|"loading"|"ready"|"error">("idle"),[geoMessage,setGeoMessage]=useState("");
  const [prompt,setPrompt]=useState(true);
  const [tracked,setTracked]=useState<MapJob[]>([]),[jobs,setJobs]=useState<Record<string,GenerationJob>>({});
  const [library,setLibrary]=useState<GenerationJob[]>([]);
  const lookup=useRef<AbortController|null>(null),geoVersion=useRef(0),geoTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const input=useRef<HTMLInputElement>(null);

  useEffect(()=>{
    let disposed=false;
    void savedStories().catch(()=>[]).then(values=>{if(!disposed){setTracked(readMapJobs());setLibrary(values);}});
    const cancelLocation=()=>{geoVersion.current++;if(geoTimer.current)clearTimeout(geoTimer.current);};
    return ()=>{disposed=true;lookup.current?.abort();cancelLocation();};
  },[]);
  useEffect(()=>{if(search)input.current?.focus();},[search]);
  useEffect(()=>{
    if(!tracked.length)return;
    let disposed=false,running=false;
    const controller=new AbortController();
    const settled=new Set<string>();
    const refresh=async()=>{
      if(running||document.visibilityState!=="visible")return;
      running=true;
      try {
        const values=await Promise.all(tracked.map(async item=>{
          if(settled.has(item.id))return null;
          const request=new AbortController(),relay=()=>request.abort(),timer=setTimeout(relay,12000);
          controller.signal.addEventListener("abort",relay,{once:true});
          try{const response=await fetch(jobUrl(item.id),{signal:request.signal});
            const value=await response.json();
            if(!response.ok||value.id!==item.id||!(value.stage in stageLabels))return null;
            if(terminalStages.has(value.stage))settled.add(item.id);
            return value as GenerationJob;
          }catch{return null;}finally{clearTimeout(timer);controller.signal.removeEventListener("abort",relay);}
        }));
        if(!disposed)setJobs(current=>({...current,...Object.fromEntries(values.filter(value=>value!==null).map(value=>[value.id,value]))}));
      }finally{running=false;}
    };
    void refresh();const timer=setInterval(()=>void refresh(),15000);
    document.addEventListener("visibilitychange",refresh);
    return ()=>{disposed=true;controller.abort();clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};
  },[tracked]);

  const pins=useMemo<StoryPin[]>(()=>{
    const chapters=getWalkChapters(route).map((chapter,index)=>({id:chapter.id,title:chapter.title,address:chapter.place,location:chapter.location,duration:chapter.audio?.duration_sec,chapter:index,number:index+1}));
    const own=tracked.filter(item=>item.id!==MELNIKOV.id).map(item=>{
      const job=jobs[item.id];return {...item,jobId:item.id,title:job?.story?.title??item.address,duration:job?.audio?.durationSec,pending:job?!terminalStages.has(job.stage):false,status:job?stageLabels[job.stage]:"Открыть подготовку"};
    });
    return [...chapters,MELNIKOV,...own];
  },[route,tracked,jobs]);
  const visible=useMemo(()=>pins.filter(pin=>filter!=="walk"||pin.chapter!==undefined).sort((a,b)=>user?distance(user,a.location)-distance(user,b.location):0),[pins,filter,user]);
  const active=pins.find(pin=>pin.id===selected);
  const mapItems=useMemo(()=>place?[...visible,{id:"picked-place",title:place.address??"Выбранное место",location:place.location,pending:true}]:visible,[visible,place]);
  const readyCount=pins.filter(pin=>pin.duration).length;

  function select(pin:StoryPin){
    lookup.current?.abort();setPlaceBusy(false);setPlaceError("");setPlace(null);setSelected(pin.id);setFocus({...pin.location});setPrompt(false);setSearch(false);setView("map");setTab("nearby");
  }
  function openSearch(){setTab("nearby");setSearch(true);setPrompt(false);}
  async function findPlace(value:Coordinates|string){
    lookup.current?.abort();const controller=new AbortController();lookup.current=controller;
    setPrompt(false);setSelected(undefined);setPlace(null);setPlaceError("");setPlaceBusy(true);setSearch(false);setView("map");
    if(typeof value!=="string"){
      setFocus({...value});
      if(!isMoscowPoint(value)){setPlaceBusy(false);setPlaceError("Пока готовим истории только о Москве. Можно выбрать московский дом или открыть готовую прогулку.");return;}
    }
    const timer=setTimeout(()=>controller.abort("timeout"),12000);
    try {
      const params=new URLSearchParams(typeof value==="string"?{q:value}:{lat:String(value.lat),lon:String(value.lon)});
      const response=await fetch(`/api/story-place?${params}`,{signal:controller.signal});const result=await response.json();
      if(!response.ok)throw new Error(result.error?.message??"Не удалось определить адрес.");
      if(!result.location||!isMoscowPoint(result.location))throw new Error("Выберите адрес в Москве.");
      if(lookup.current!==controller||controller.signal.aborted)return;
      setPlace(result);setFocus(result.location);setSearch(false);
    }catch(error){
      if(lookup.current===controller&&(!controller.signal.aborted||controller.signal.reason==="timeout"))setPlaceError(controller.signal.aborted?"Поиск занял слишком много времени. Введите адрес вручную.":error instanceof Error?error.message:"Не удалось определить адрес.");
    }finally{clearTimeout(timer);if(lookup.current===controller)setPlaceBusy(false);}
  }
  function submitSearch(event:FormEvent){event.preventDefault();if(query.trim().length>=3)void findPlace(query.trim());}
  function locate(){
    const version=++geoVersion.current;setGeo("loading");setGeoMessage("");
    if(geoTimer.current)clearTimeout(geoTimer.current);
    const fail=(message:string)=>{if(version!==geoVersion.current)return;geoVersion.current++;if(geoTimer.current)clearTimeout(geoTimer.current);setGeo("error");setGeoMessage(message);};
    if(!navigator.geolocation){fail("Геолокация недоступна. Выберите дом на карте или найдите адрес.");return;}
    geoTimer.current=setTimeout(()=>fail("Не удалось определить положение. Попробуйте ещё раз или выберите дом на карте."),13000);
    navigator.geolocation.getCurrentPosition(position=>{
      if(version!==geoVersion.current)return;if(geoTimer.current)clearTimeout(geoTimer.current);
      const point={lat:position.coords.latitude,lon:position.coords.longitude,accuracyM:position.coords.accuracy};
      setUser(point);setFocus(point);setGeo("ready");setPrompt(false);
      setGeoMessage(!isMoscowPoint(point)?"Вы сейчас за пределами нашего каталога. Пока доступны истории Москвы.":point.accuracyM>100?`Положение приблизительное: точность около ${Math.round(point.accuracyM)} м.`:"");
    },error=>fail(error.code===1?"Доступ к геолокации не дан. Можно выбрать дом на карте или ввести адрес.":"Не удалось определить положение. Выберите дом на карте или повторите попытку."),{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
  }
  function metadata(pin:StoryPin){return [pin.duration?`${Math.ceil(pin.duration/60)} мин · аудио`:pin.status,user?`${distanceLabel(distance(user,pin.location))} по прямой`:null].filter(Boolean).join(" · ");}
  const createHref=place?.address?`/create?${new URLSearchParams({address:place.address,lat:String(place.location.lat),lon:String(place.location.lon)})}`:"/create?new=1";
  const walkStart=place?.address?place:active;
  const walkHref=walkStart?.address?`/walk?${new URLSearchParams({address:walkStart.address,lat:String(walkStart.location.lat),lon:String(walkStart.location.lon)})}`:"/walk";

  return <>
    {tab==="nearby"&&view==="map"?<ExploreMap items={mapItems} selectedId={selected??(place?"picked-place":undefined)} focus={focus} user={user} onSelect={id=>{const pin=pins.find(value=>value.id===id);if(pin)select(pin);}} onPoint={point=>void findPlace(point)} />:null}
    <div className={`around-content ${tab!=="nearby"||view==="list"?"scroll-view":""}${search?" searching":""}`}>
      <header className="around-header">
        <div className="around-topline"><Link href="/" prefetch={false} className="around-brand">отголосок<span>.</span></Link><span>Москва · {readyCount} аудиоисторий</span><button className="around-icon" type="button" aria-label={search?"Закрыть поиск":"Найти адрес"} onClick={()=>search?setSearch(false):openSearch()}><ExploreIcon name={search?"close":"search"}/></button></div>
        <h1 id="around-title" tabIndex={-1}>{tab==="walk"?"Пойдём гулять." :tab==="saved"?"Всегда с вами.":<>Что вокруг<br className="around-title-break"/> вас<span>?</span></>}</h1>
        {tab==="nearby"?<div className="around-toolbar"><div className="around-filters" aria-label="Истории"><button type="button" aria-pressed={filter==="all"} onClick={()=>setFilter("all")}>Все истории</button><button type="button" aria-pressed={filter==="walk"} onClick={()=>setFilter("walk")}>По дороге</button></div><div className="around-view-toggle" aria-label="Вид"><button type="button" aria-label="Карта" aria-pressed={view==="map"} onClick={()=>setView("map")}><ExploreIcon name="map"/></button><button type="button" aria-label="Список историй" aria-pressed={view==="list"} onClick={()=>setView("list")}><ExploreIcon name="list"/></button></div></div>:null}
        {search?<form className="around-search" onSubmit={submitSearch}><label htmlFor="map-address">Какой дом вас интересует?</label><div><input id="map-address" ref={input} value={query} onChange={event=>setQuery(event.target.value)} minLength={3} maxLength={180} required placeholder="Улица и номер дома в Москве" autoComplete="off"/><button type="submit" disabled={placeBusy||query.trim().length<3} aria-label="Найти дом"><ExploreIcon name="arrow"/></button></div><Link href={`/create?${new URLSearchParams(query.trim()?{address:query.trim()}:{new:"1"})}`} prefetch={false}>Ввести адрес для истории вручную →</Link></form>:null}
      </header>

      {tab==="nearby"&&view==="list"?<section className="around-list" aria-label="Доступные истории"><p className="around-subtitle">{user?"Ближайшие сначала · расстояние по прямой":"Истории Москвы · выберите место"}</p>{visible.map(pin=><button className="around-list-item" key={pin.id} onClick={()=>select(pin)} type="button"><span className="around-list-icon"><ExploreIcon name={pin.pending?"plus":"headphones"}/></span><span><strong>{pin.title}</strong><small>{pin.address}</small><em>{metadata(pin)}</em></span><ExploreIcon name="arrow"/></button>)}<div className="around-empty"><h2>У каждого дома своя история</h2><p>Не нашли нужный? Выберите дом, и мы поищем факты и подготовим рассказ с озвучкой.</p><button type="button" className="around-primary" onClick={openSearch}>Найти другой дом <ExploreIcon name="plus"/></button></div></section>:null}
      {tab==="walk"?<div className="around-route"><section className="around-empty"><h2>Моя прогулка</h2><p>Соберите свой маршрут или продолжите сохранённый черновик на этом устройстве.</p><Link href="/walk?resume=1" className="around-primary" prefetch={false}>Открыть мою прогулку <ExploreIcon name="walk"/></Link><Link href="/create?new=1" className="around-text-button" prefetch={false}>Создать историю одного дома</Link></section>{children}</div>:null}
      {tab==="saved"?<section className="around-list"><p className="around-subtitle">Текст и звук, которые вы сохранили на этом устройстве</p>{library.map(job=><Link className="around-list-item" key={job.id} href={`/create?job=${job.id}`} prefetch={false}><span className="around-list-icon"><ExploreIcon name="headphones"/></span><span><strong>{job.story?.title}</strong><small>{job.address}</small><em>Доступно без сети</em></span><ExploreIcon name="arrow"/></Link>)}{!library.length?<div className="around-empty"><ExploreIcon name="bookmark"/><h2>Возьмите истории с собой</h2><p>Откройте готовую историю и нажмите «Сохранить для прогулки без сети». Она появится здесь.</p><button type="button" className="around-primary" onClick={()=>{setTab("nearby");setView("list");}}>Выбрать историю <ExploreIcon name="arrow"/></button></div>:null}<p className="around-subtitle">Четыре записи первой прогулки сохраняются автоматически при первом открытии сайта с интернетом.</p><button type="button" className="around-secondary" onClick={()=>setTab("walk")}>Открыть прогулку</button></section>:null}
      {tab!=="nearby"||view==="list"?<div className="around-about"><details><summary>О карте и геолокации</summary><p>Карту предоставляет OpenStreetMap. При её просмотре сервис получает запросы изображений выбранного района. Геолокация включается только по кнопке и используется на устройстве. Нажатая точка или введённый адрес отправляются для поиска адреса через Nominatim. Карта требует интернета; сохранённые записи работают без сети.</p></details><a href="/update.html">{updateAvailable?"Доступна новая версия · обновить":"Проверить обновление"}</a></div>:null}
    </div>

    {tab==="nearby"&&view==="map"?<>
      {!search?<button className="around-locate around-icon" type="button" aria-label="Моё местоположение" onClick={locate} disabled={geo==="loading"}><ExploreIcon name="locate"/></button>:null}
      {geoMessage&&!search?<p className="around-geo-message" role="status">{geoMessage}<button type="button" aria-label="Скрыть сообщение" onClick={()=>setGeoMessage("")}><ExploreIcon name="close"/></button></p>:null}
      <div className="around-bottom">
        {prompt&&!active&&!place&&!placeBusy&&!placeError&&!search?<section className="around-location-card" aria-labelledby="location-title"><span className="around-location-symbol"><ExploreIcon name="locate"/></span><h2 id="location-title">Истории совсем рядом</h2><p>Разрешите геолокацию, чтобы увидеть, что можно послушать вокруг вас.</p><button type="button" className="around-primary" onClick={locate} disabled={geo==="loading"}>{geo==="loading"?"Определяем положение…":"Включить геолокацию"}<ExploreIcon name="locate"/></button><button className="around-text-button" type="button" onClick={()=>setPrompt(false)}>Выбрать место на карте</button></section>
        :active?<section className="around-place-card" aria-labelledby="selected-place-title"><div className="around-card-label"><span>{active.pending?"Готовим для вас":active.chapter!==undefined?`По дороге · часть ${active.chapter+1}`:"История дома"}</span><button type="button" className="around-icon" aria-label="Закрыть карточку" onClick={()=>setSelected(undefined)}><ExploreIcon name="close"/></button></div><h2 id="selected-place-title">{active.title}</h2>{active.title!==active.address?<p>{active.address}</p>:null}<small>{metadata(active)}</small>{active.chapter!==undefined?<button type="button" className="around-primary" onClick={()=>onStart(active.chapter)}>Слушать эту часть <ExploreIcon name="headphones"/></button>:<Link className="around-primary" href={`/create?job=${active.jobId}`} prefetch={false}>{active.duration?"Открыть и слушать":"Открыть подготовку"}<ExploreIcon name={active.duration?"headphones":"arrow"}/></Link>}</section>
        :place||placeBusy||placeError?<section className="around-place-card" aria-labelledby="new-place-title"><div className="around-card-label"><span>История по запросу</span><button type="button" className="around-icon" aria-label="Закрыть выбранное место" onClick={()=>{lookup.current?.abort();setPlace(null);setPlaceBusy(false);setPlaceError("");}}><ExploreIcon name="close"/></button></div><h2 id="new-place-title">{placeBusy?"Определяем адрес…":place?.address??"О чём расскажет этот дом?"}</h2>{placeError?<p role="status">{placeError}</p>:placeBusy?<p role="status">Смотрим, какой дом находится рядом с выбранной точкой.</p>:<p>{place?.address?"Проверьте номер и строение: ищем историю именно этого дома. Текст и озвучка обычно готовы за 5–10 минут.":"У этой точки нет точного номера дома. Введите адрес, чтобы мы искали историю нужного здания."}</p>}{!placeBusy?<Link className="around-primary" href={createHref} prefetch={false}>{place?.address?"Выбрать этот дом":"Ввести адрес вручную"}<ExploreIcon name="plus"/></Link>:null}<small>Готовая запись появится после проверки фактов и озвучки.</small></section>
        :!search?<div className="around-map-hint"><span><strong>Какой дом вам интересен?</strong>Нажмите на карту — найдём его историю.</span><button className="around-icon" type="button" aria-label="Найти дом по адресу" onClick={openSearch}><ExploreIcon name="search"/></button></div>:null}
        {walkStart?.address&&!placeBusy?<Link className="around-primary" href={walkHref} prefetch={false}>Создать прогулку отсюда <ExploreIcon name="walk"/></Link>:null}
        {updateAvailable?<a className="around-update" href="/update.html">Доступна новая версия · обновить</a>:null}
      </div>
    </>:null}
    <nav className="around-nav" aria-label="Основная навигация">{([{id:"nearby",label:"Рядом",icon:"map"},{id:"walk",label:"Прогулка",icon:"walk"},{id:"saved",label:"Сохранено",icon:"bookmark"}] as const).map(item=><button key={item.id} type="button" aria-current={tab===item.id?"page":undefined} onClick={()=>{setTab(item.id);setSearch(false);}}><ExploreIcon name={item.icon}/><span>{item.label}</span></button>)}<Link href="/walk" prefetch={false}><ExploreIcon name="plus"/><span>Создать</span></Link></nav>
  </>;
}
