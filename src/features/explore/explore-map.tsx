"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import type { Coordinates } from "../tour/types";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map-dots.css";

/** Vector basemap; its tiles, glyphs and sprites are all served by tiles.openfreemap.org (see the CSP). */
export const MAP_STYLE_URL="https://tiles.openfreemap.org/styles/bright";
/** Raster basemap for browsers without WebGL, which the vector basemap requires. */
export const FALLBACK_TILE_URL="https://tile.openstreetmap.org/{z}/{x}/{y}.png";

function supportsWebGL() {
  const canvas=document.createElement("canvas");
  const gl=canvas.getContext("webgl2")??canvas.getContext("webgl");
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  // jsdom and some locked-down browsers return undefined rather than null.
  return Boolean(gl);
}

type VectorModule=typeof import("@maplibre/maplibre-gl-leaflet");
type BasemapInternals={_map:Leaflet.Map|null; _glMap:import("maplibre-gl").Map&{_actualCanvas:HTMLElement}; _resizeContainer():void; _zoomEnd():void};

/**
 * maplibre-gl-leaflet 0.1.4 redraws after a resize in an animation frame without checking that
 * the layer is still on a map, so a resize right before unmount throws on the removed map.
 * Same redraw as upstream, skipped once the layer is gone.
 */
function safeBasemapLayer(L:typeof Leaflet,{MaplibreGL}:VectorModule):typeof Leaflet.MaplibreGL {
  return MaplibreGL.extend({
    _transitionEnd(this:BasemapInternals){
      L.Util.requestAnimFrame(()=>{
        const map=this._map;if(!map)return;
        const offset=map.latLngToContainerPoint(map.getBounds().getNorthWest());
        this._resizeContainer();
        L.DomUtil.setTransform(this._glMap._actualCanvas,offset,1);
        this._glMap.once("moveend",()=>this._zoomEnd());
        const center=map.getCenter();
        this._glMap.jumpTo({center:[center.lng,center.lat],zoom:map.getZoom()-1});
      });
    },
  });
}

export type MapItem = {id:string; title:string; location:Coordinates; number?:number; pending?:boolean; compact?:boolean};
export type MapFocus = Coordinates & {zoom?:number};
export type MapViewState = {current: {center:Coordinates; zoom:number; focus:MapFocus|null}|null};
export function ExploreMap({items,selectedId,focus,user,onSelect,onPoint,geometry,mapLabel,viewState,routePadding}: {
  items: MapItem[]; selectedId?:string; focus:MapFocus|null; user:(Coordinates&{accuracyM:number})|null;
  onSelect:(id:string)=>void; onPoint:(point:Coordinates)=>void;
  geometry?: Coordinates[]; mapLabel?: string; viewState?: MapViewState; routePadding?: {top:number;right:number;bottom:number;left:number};
}) {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<{L:typeof Leaflet; map:Leaflet.Map; markers:Leaflet.LayerGroup; markerById:Map<string,{marker:Leaflet.Marker; look:string}>; position:Leaflet.LayerGroup; route:Leaflet.LayerGroup}|null>(null);
  const handlers = useRef({onSelect,onPoint});
  const appliedFocus = useRef<Coordinates|null>(null);
  const [ready,setReady] = useState(false);
  const [tileError,setTileError] = useState(false);
  const [mapError,setMapError] = useState(false);
  useEffect(()=>{handlers.current={onSelect,onPoint};},[onSelect,onPoint]);

  useEffect(()=>{
    let disposed=false;
    let observer:ResizeObserver|undefined;
    let saveView:(()=>void)|undefined;
    void import("leaflet").then(async(L)=>{
      // The vector engine is large and useless without WebGL, so only those browsers download it.
      // If its chunk fails to load, the raster fallback still gives a working map.
      const vector=supportsWebGL()?await import("@maplibre/maplibre-gl-leaflet").catch(()=>null):null;
      if(disposed||!container.current)return;
      const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
      const saved=viewState?.current;
      appliedFocus.current=saved?.focus??null;
      // Leaflet 1.9 leaves its zoom transition timer alive after remove().
      // Zoom immediately so switching tabs mid-zoom cannot touch a removed map.
      const map=L.map(container.current,{zoomControl:false,attributionControl:false,zoomAnimation:false,fadeAnimation:!reduced,markerZoomAnimation:false,minZoom:3,maxZoom:19}).setView(saved?[saved.center.lat,saved.center.lon]:[55.7249,37.6507],saved?.zoom??16);
      if(viewState){
        saveView=()=>{const center=map.getCenter();viewState.current={center:{lat:center.lat,lon:center.lng},zoom:map.getZoom(),focus:appliedFocus.current};};
        map.on("moveend zoomend",saveView);
      }
      if(vector){
        // Leaflet keeps markers, route and controls; MapLibre only draws the basemap underneath.
        const Basemap=safeBasemapLayer(L,vector);
        const basemap=new Basemap({style:MAP_STYLE_URL,attributionControl:false}).addTo(map).getMaplibreMap();
        // The Bright sprite lacks a few POI icons (office, gate, atm…); draw nothing instead of warning per tile.
        basemap.on("styleimagemissing",({id})=>{if(!basemap.hasImage(id))basemap.addImage(id,{width:1,height:1,data:new Uint8Array(4)});});
        basemap.on("error",()=>setTileError(true));
        basemap.on("data",(event)=>{if(event.dataType==="source"&&"tile" in event&&event.tile)setTileError(false);});
      } else {
        L.tileLayer(FALLBACK_TILE_URL,{maxZoom:19,updateWhenIdle:true,keepBuffer:1}).on("tileerror",()=>setTileError(true)).on("tileload",()=>setTileError(false)).addTo(map);
      }
      L.control.zoom({position:"bottomright",zoomInTitle:"Приблизить",zoomOutTitle:"Отдалить"}).addTo(map);
      map.on("click",(event:Leaflet.LeafletMouseEvent)=>handlers.current.onPoint({lat:event.latlng.lat,lon:event.latlng.lng}));
      runtime.current={L,map,markers:L.layerGroup().addTo(map),markerById:new Map(),position:L.layerGroup().addTo(map),route:L.layerGroup().addTo(map)};
      observer=new ResizeObserver(()=>{if(!disposed)map.invalidateSize();});observer.observe(container.current);
      setReady(true);
    }).catch(()=>{if(!disposed)setMapError(true);});
    return ()=>{
      disposed=true;
      observer?.disconnect();
      const map=runtime.current?.map;
      if(map){
        saveView?.();
        // Leaflet may emit a delayed resize event after remove().
        if(saveView)map.off("moveend zoomend",saveView);
        map.remove();
      }
      runtime.current=null;
    };
  },[viewState]);

  // Markers are updated by id instead of being rebuilt: playback re-renders the
  // map often, and a rebuilt marker would drop keyboard focus.
  useEffect(()=>{
    const rt=runtime.current;if(!rt||!ready)return;
    const wanted=new Set(items.map(item=>item.id));
    for(const [id,entry] of rt.markerById)if(!wanted.has(id)){entry.marker.remove();rt.markerById.delete(id);}
    for(const item of items) {
      const active=item.id===selectedId;
      // Marker contents are fixed symbols/numbers, never upstream HTML.
      const label=item.number ? String(item.number) : item.pending ? "…" : "♪";
      const look=JSON.stringify([item.title,label,item.compact??false,item.pending??false,active]);
      const position:[number,number]=[item.location.lat,item.location.lon];
      const existing=rt.markerById.get(item.id);
      if(existing) {
        const current=existing.marker.getLatLng();
        if(current.lat!==position[0]||current.lng!==position[1])existing.marker.setLatLng(position);
        if(existing.look===look)continue;
      }
      const icon=item.compact ? rt.L.divIcon({className:"explore-dot",html:"<span></span>",iconSize:[32,32],iconAnchor:[16,16]}) : rt.L.divIcon({className:`explore-pin${active?" selected":""}${item.pending?" pending":""}`,html:`<span><b>${label}</b></span>`,iconSize:[44,52],iconAnchor:[22,48]});
      let marker=existing?.marker;
      if(marker) {
        // A div icon reuses its element, so focus and listeners survive the update.
        Object.assign(marker.options,{title:item.title,alt:item.title});
        marker.setIcon(icon).setZIndexOffset(item.compact?-1000:0);
      } else {
        marker=rt.L.marker(position,{icon,title:item.title,alt:item.title,keyboard:true,zIndexOffset:item.compact?-1000:0,bubblingMouseEvents:false}).addTo(rt.markers);
        marker.on("click",()=>handlers.current.onSelect(item.id));
      }
      marker.getElement()?.setAttribute("aria-pressed",String(active));
      rt.markerById.set(item.id,{marker,look});
    }
  },[items,selectedId,ready]);

  useEffect(()=>{
    const rt=runtime.current;if(!rt||!ready||!focus)return;
    // A remount must not replay the old selection over a manually moved view.
    if(focus===appliedFocus.current)return;
    appliedFocus.current=focus;
    rt.map.setView([focus.lat,focus.lon],focus.zoom??Math.max(rt.map.getZoom(),16),{animate:false});
    if(routePadding){
      // The creation panel covers part of the map: centre the point in the uncovered area, as the route is.
      const size=rt.map.getSize();
      const visible=rt.L.point((routePadding.left+size.x-routePadding.right)/2,(routePadding.top+size.y-routePadding.bottom)/2);
      rt.map.panBy(size.divideBy(2).subtract(visible),{animate:false});
    } else if(focus.zoom===undefined)rt.map.panBy([0,80],{animate:false});
  // routePadding is read at the moment of focusing; a later resize must not move a view the user may have panned.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[focus,ready]);

  useEffect(()=>{
    const rt=runtime.current;if(!rt||!ready)return;
    rt.route.clearLayers();
    if(!geometry || geometry.length<2)return;
    const line=rt.L.polyline(geometry.map(p=>[p.lat,p.lon] as [number,number]),{color:"#203e38",weight:5,opacity:.9,interactive:false}).addTo(rt.route);
    rt.map.fitBounds(line.getBounds(),{paddingTopLeft:routePadding?[routePadding.left,routePadding.top]:[35,35],paddingBottomRight:routePadding?[routePadding.right,routePadding.bottom]:[35,35],maxZoom:17,animate:false});
  },[geometry,ready,routePadding]);

  useEffect(()=>{
    const rt=runtime.current;if(!rt||!ready)return;
    rt.position.clearLayers();if(!user)return;
    // Keep the user's position visually distinct from story pins.  A custom
    // icon is more reliable than a tiny circleMarker on high-DPI/mobile maps.
    rt.L.circle([user.lat,user.lon],{radius:Math.min(Math.max(user.accuracyM,20),5000),color:"#246b90",weight:2,fillColor:"#246b90",fillOpacity:.16,interactive:false}).addTo(rt.position);
    const icon=rt.L.divIcon({className:"explore-user-position",html:"<span aria-hidden=\"true\"></span>",iconSize:[30,30],iconAnchor:[15,15]});
    rt.L.marker([user.lat,user.lon],{icon,interactive:false,zIndexOffset:1000}).addTo(rt.position);
  },[user,ready]);

  return <div className="explore-map-layer">
    <div ref={container} className="explore-map" role="region" aria-label={mapLabel??"Карта историй. Выберите отметку или нажмите на дом, чтобы подготовить историю."} />
    {!ready?<p className="map-loading" role="status">{mapError?"Карта не загрузилась. Откройте список историй.":"Загружаем карту…"}</p>:null}
    {tileError?<p className="map-network-note" role="status">Карта требует интернета. Сохранённые истории доступны в разделе «Сохранено».</p>:null}
    <p className="map-attribution"><a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></p>
  </div>;
}
