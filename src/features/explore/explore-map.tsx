"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import type { Coordinates } from "../tour/types";
import "leaflet/dist/leaflet.css";

export type MapItem = {id:string; title:string; location:Coordinates; number?:number; pending?:boolean};
export function ExploreMap({items,selectedId,focus,user,onSelect,onPoint,geometry,mapLabel}: {
  items: MapItem[]; selectedId?:string; focus:Coordinates|null; user:(Coordinates&{accuracyM:number})|null;
  onSelect:(id:string)=>void; onPoint:(point:Coordinates)=>void;
  geometry?: Coordinates[]; mapLabel?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<{L:typeof Leaflet; map:Leaflet.Map; markers:Leaflet.LayerGroup; position:Leaflet.LayerGroup; route:Leaflet.LayerGroup}|null>(null);
  const handlers = useRef({onSelect,onPoint});
  const [ready,setReady] = useState(false);
  const [tileError,setTileError] = useState(false);
  const [mapError,setMapError] = useState(false);
  useEffect(()=>{handlers.current={onSelect,onPoint};},[onSelect,onPoint]);

  useEffect(()=>{
    let disposed=false;
    let observer:ResizeObserver|undefined;
    void import("leaflet").then((L)=>{
      if(disposed||!container.current)return;
      const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
      const map=L.map(container.current,{zoomControl:false,attributionControl:false,zoomAnimation:!reduced,fadeAnimation:!reduced,markerZoomAnimation:!reduced,minZoom:3,maxZoom:19}).setView([55.7249,37.6507],16);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,updateWhenIdle:true,keepBuffer:1}).on("tileerror",()=>setTileError(true)).on("tileload",()=>setTileError(false)).addTo(map);
      L.control.zoom({position:"bottomright",zoomInTitle:"Приблизить",zoomOutTitle:"Отдалить"}).addTo(map);
      L.control.scale({position:"bottomleft",imperial:false}).addTo(map);
      map.on("click",(event:Leaflet.LeafletMouseEvent)=>handlers.current.onPoint({lat:event.latlng.lat,lon:event.latlng.lng}));
      runtime.current={L,map,markers:L.layerGroup().addTo(map),position:L.layerGroup().addTo(map),route:L.layerGroup().addTo(map)};
      observer=new ResizeObserver(()=>map.invalidateSize());observer.observe(container.current);
      setReady(true);
    }).catch(()=>{if(!disposed)setMapError(true);});
    return ()=>{disposed=true;observer?.disconnect();runtime.current?.map.remove();runtime.current=null;};
  },[]);

  useEffect(()=>{
    const rt=runtime.current;if(!rt||!ready)return;
    rt.markers.clearLayers();
    for(const item of items) {
      const active=item.id===selectedId;
      // Marker contents are fixed symbols/numbers, never upstream HTML.
      const label=item.number ? String(item.number) : item.pending ? "…" : "♪";
      const icon=rt.L.divIcon({className:`explore-pin${active?" selected":""}${item.pending?" pending":""}`,html:`<span><b>${label}</b></span>`,iconSize:[44,52],iconAnchor:[22,48]});
      const marker=rt.L.marker([item.location.lat,item.location.lon],{icon,title:item.title,alt:item.title,keyboard:true,bubblingMouseEvents:false}).addTo(rt.markers);
      marker.on("click",()=>handlers.current.onSelect(item.id));
      marker.getElement()?.setAttribute("aria-pressed",String(active));
    }
  },[items,selectedId,ready]);

  useEffect(()=>{
    const rt=runtime.current;if(!rt||!ready||!focus)return;
    rt.map.setView([focus.lat,focus.lon],Math.max(rt.map.getZoom(),16),{animate:false});
    rt.map.panBy([0,80],{animate:false});
  },[focus,ready]);

  useEffect(()=>{
    const rt=runtime.current;if(!rt||!ready)return;
    rt.route.clearLayers();
    if(!geometry || geometry.length<2)return;
    const line=rt.L.polyline(geometry.map(p=>[p.lat,p.lon] as [number,number]),{color:"#203e38",weight:5,opacity:.9,interactive:false}).addTo(rt.route);
    rt.map.fitBounds(line.getBounds(),{padding:[35,35],maxZoom:17,animate:false});
  },[geometry,ready]);

  useEffect(()=>{
    const rt=runtime.current;if(!rt||!ready)return;
    rt.position.clearLayers();if(!user)return;
    rt.L.circle([user.lat,user.lon],{radius:Math.min(user.accuracyM,5000),color:"#246b90",weight:1,fillOpacity:.1,interactive:false}).addTo(rt.position);
    rt.L.circleMarker([user.lat,user.lon],{radius:7,color:"white",weight:3,fillColor:"#246b90",fillOpacity:1,interactive:false}).addTo(rt.position);
  },[user,ready]);

  return <div className="explore-map-layer">
    <div ref={container} className="explore-map" aria-label={mapLabel??"Карта историй. Выберите отметку или нажмите на дом, чтобы подготовить историю."} />
    {!ready?<p className="map-loading" role="status">{mapError?"Карта не загрузилась. Откройте список историй.":"Загружаем карту…"}</p>:null}
    {tileError?<p className="map-network-note" role="status">Карта требует интернета. Сохранённые истории доступны в разделе «Сохранено».</p>:null}
    <a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
  </div>;
}
