import { expect, it, vi } from "vitest";
import { carWalkDocument } from "../../../backend/test-fixtures/car-walk.mjs";
import { carCopyDocument, createCarCopy } from "./car-copy";
import type { WalkView } from "./model";

function fixture() {
  const car = carWalkDocument() as WalkView["document"];
  const document = { ...car, travelMode: "walking" as const, minutes:60, route:{...car.route!,distanceM:300,car:undefined} };
  const view: WalkView = {document,revision:1,contentVersion:"source",chapters:[{id:"car-stop-1",status:"unavailable",story:null,audio:null}]};
  const plan={...car.route!,stops:car.stops.map(stop=>({...stop.place,stopId:stop.id}))};
  return {view,plan};
}
it("сохраняет ссылки историй в отдельной поездке без изменения оригинала", () => {
  const {view,plan}=fixture();
  view.document.stops[0].storyRef={kind:"catalog",id:"source--story"};
  const copy=carCopyDocument(view,plan,"copy-car");
  expect(copy.stops[0].storyRef).toEqual(view.document.stops[0].storyRef);
  expect(copy.id).toBe("copy-car");expect(copy.travelMode).toBe("driving");
  expect(view.document.travelMode).toBe("walking");
});
it("отклоняет потерю остановки или подмену её координат", () => {
  const {view,plan}=fixture();
  expect(()=>carCopyDocument(view,{...plan,stops:[]},"copy")).toThrow();
  expect(()=>carCopyDocument(view,{...plan,stops:[{...plan.stops[0],location:{lat:55.77,lon:37.64}}]},"copy")).toThrow();
});
it("отказ маршрутизатора не сохраняет копию", async () => {
  const {view}=fixture();const setItem=vi.fn();
  await expect(createCarCopy(view,new AbortController().signal,{plan:vi.fn().mockRejectedValue(new Error("Нет пути")),storage:()=>({getItem:()=>null,setItem}) as unknown as Storage,newId:()=>"copy"})).rejects.toThrow("Нет пути");
  expect(setItem).not.toHaveBeenCalled();
});
it("переведённый экран сохраняет русский исходник и отмена не пишет копию", async () => {
  const {view,plan}=fixture();
  view.sourceDocument=structuredClone(view.document);
  view.document.title="Translated title";
  expect(carCopyDocument(view,plan,"copy").title).toBe(view.sourceDocument.title);
  const controller=new AbortController();const setItem=vi.fn();
  await expect(createCarCopy(view,controller.signal,{plan:async()=>{controller.abort();return plan;},storage:()=>({getItem:()=>null,setItem}) as unknown as Storage,newId:()=>"copy"})).rejects.toThrow();
  expect(setItem).not.toHaveBeenCalled();
});
it("успешная поездка появляется в локальной библиотеке, отказ хранения виден пользователю", async () => {
  const {view,plan}=fixture();const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}} as unknown as Storage;
  const deps={plan:async()=>plan,storage:()=>storage,newId:()=>"new-copy"};
  expect(await createCarCopy(view,new AbortController().signal,deps)).toBe("new-copy");
  expect(JSON.parse([...values.values()][0]).items["new-copy"].document.stops[0].id).toBe("car-stop-1");
  await expect(createCarCopy(view,new AbortController().signal,{...deps,storage:()=>({getItem:()=>null,setItem:()=>{throw new Error("Хранилище заполнено");}}) as unknown as Storage})).rejects.toThrow("Хранилище заполнено");
});
