import { carRouteGeometry } from '../car-route.mjs';

export function carWalkDocument() {
  const start={lat:55.75,lon:37.61}, parking={lat:55.76,lon:37.63}, stop={lat:55.7605,lon:37.6305};
  /** @type {import("../car-route.mjs").CarRoute} */
  const car={drivingMinutes:20,totalMinutes:33,visits:[{id:'visit-1',parking:{id:'osm:way:1',name:'Городская парковка',location:parking,entrance:parking,exit:parking,pedestrianAccess:parking,access:'public',fee:null,openingHours:null},stopIds:['car-stop-1'],visitMinutes:5,parkingMinutes:5}],
    segments:[{mode:'driving',visitId:'visit-1',geometry:[start,parking],distanceM:10000,minutes:20},{mode:'walking',visitId:'visit-1',geometry:[parking,stop,parking],distanceM:300,minutes:3}]};
  return {version:2,id:'car-walk',title:'На машине по городу',description:'',city:'Москва',mode:'open',travelMode:'driving',minutes:60,start:{address:'Москва, начало поездки',location:start},
    stops:[{id:'car-stop-1',place:{address:'Москва, исторический дом',location:stop},storyRef:null,transition:'',nextHint:''}],
    route:{geometry:carRouteGeometry(car),distanceM:10300,walkingMinutes:3,attribution:'© OpenStreetMap contributors',car},fieldChecked:false};
}
