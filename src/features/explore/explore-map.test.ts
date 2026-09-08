import { afterEach, expect, it, vi } from "vitest";
import type { MapViewState } from "./explore-map";

const mock=vi.hoisted(()=>({effects:[] as Array<()=>void|(()=>void)>,maps:[] as Array<{setView:ReturnType<typeof vi.fn<([lat,lng]:number[],zoom:number)=>unknown>>;panBy:ReturnType<typeof vi.fn>}>}));
vi.mock("react",()=>({
  useRef:(current:unknown)=>({current:current??{}}),
  useState:()=>[true,vi.fn()],
  useEffect:(effect:()=>void|(()=>void))=>mock.effects.push(effect),
}));
vi.mock("leaflet",()=>{
  const layer=()=>({addTo:vi.fn().mockReturnThis(),on:vi.fn().mockReturnThis(),clearLayers:vi.fn()});
  return {
    map:()=>{
      let center={lat:0,lng:0},zoom=0;
      const map={
        setView:vi.fn(([lat,lng]:number[],value:number)=>{center={lat,lng};zoom=value;return map;}),
        getCenter:()=>center,getZoom:()=>zoom,
        on:vi.fn(),remove:vi.fn(),invalidateSize:vi.fn(),panBy:vi.fn(),
      };
      mock.maps.push(map);return map;
    },
    tileLayer:layer,layerGroup:layer,control:{zoom:layer,scale:layer},
  };
});

import { ExploreMap } from "./explore-map";

afterEach(()=>{mock.effects=[];mock.maps=[];vi.unstubAllGlobals();});

async function mount(viewState?:MapViewState,focus:{lat:number;lon:number}|null=null){
  vi.stubGlobal("matchMedia",()=>({matches:true}));
  vi.stubGlobal("ResizeObserver",class{observe(){} disconnect(){}});
  mock.effects=[];
  ExploreMap({items:[],focus,user:null,onSelect:vi.fn(),onPoint:vi.fn(),viewState});
  const effects=[...mock.effects];
  effects[0]();
  const cleanup=effects[1]();
  await vi.dynamicImportSettled();
  effects.slice(2).forEach(effect=>effect());
  return {map:mock.maps.at(-1)!,cleanup};
}

it("restores the actual center and zoom after leaving and returning to the map",async()=>{
  const state:MapViewState={current:null};
  const first=await mount(state);
  expect(first.map.setView).toHaveBeenCalledWith([55.7249,37.6507],16);
  first.map.setView([55.76,37.61],14);
  first.cleanup?.();
  const returned=await mount(state);
  expect(returned.map.setView).toHaveBeenCalledExactlyOnceWith([55.76,37.61],14);
  returned.cleanup?.();
});

it("does not replay old focus, but allows a new selection to recenter",async()=>{
  const focus={lat:55.75,lon:37.6};
  const state:MapViewState={current:null};
  const first=await mount(state,focus);
  first.map.setView([55.76,37.61],14);
  first.cleanup?.();
  const returned=await mount(state,focus);
  expect(returned.map.setView).toHaveBeenCalledExactlyOnceWith([55.76,37.61],14);
  expect(returned.map.panBy).not.toHaveBeenCalled();
  returned.cleanup?.();
  const selected=await mount(state,{...focus});
  expect(selected.map.setView).toHaveBeenLastCalledWith([55.75,37.6],16,{animate:false});
  selected.cleanup?.();
});

it("does not share the nearby viewport with maps that do not opt in",async()=>{
  const state:MapViewState={current:{center:{lat:55.76,lon:37.61},zoom:14,focus:null}};
  const other=await mount();
  expect(other.map.setView).toHaveBeenCalledExactlyOnceWith([55.7249,37.6507],16);
  other.cleanup?.();
  expect(state.current?.zoom).toBe(14);
});
