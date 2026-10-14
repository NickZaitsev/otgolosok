import test from 'node:test';
import assert from 'node:assert/strict';
import { validCarRoute, copyCarRoute, tripMinutes } from './car-route.mjs';
import { validateWalkDocument } from './walk-document.mjs';
import { carWalkDocument } from './test-fixtures/car-walk.mjs';

test('car document uses total visit time and permits a road journey longer than a walking route',()=>{
  const doc=carWalkDocument();assert.equal(validateWalkDocument(doc),doc);assert.equal(tripMinutes(doc),33);
});
test('walking documents cannot accept car metadata or car distance limits',()=>{
  const doc=carWalkDocument();delete doc.travelMode;assert.throws(()=>validateWalkDocument(doc),{code:'BAD_REQUEST'});
  delete doc.route.car;assert.throws(()=>validateWalkDocument(doc),{code:'BAD_REQUEST'});
});
test('car route validates ordered references, actual walking return and complete time',()=>{
  const doc=carWalkDocument(),car=doc.route.car;
  assert.equal(validCarRoute(car,['car-stop-1']),true);
  for(const mutate of [c=>c.visits[0].stopIds=['missing'],c=>c.totalMinutes=32,c=>c.segments[1].geometry[2]={lat:55.8,lon:37.7},c=>c.segments[0].mode='walking',c=>c.segments[1].distanceM=1501]){
    const copy=copyCarRoute(car);mutate(copy);assert.equal(validCarRoute(copy,['car-stop-1']),false);
  }
});
test('several stories share one parking visit; nested copying and ID remapping are isolated',()=>{
  const car=carWalkDocument().route.car;car.visits[0].stopIds.push('car-stop-2');
  assert.equal(validCarRoute(car,['car-stop-1','car-stop-2']),true);
  const next=copyCarRoute(car,new Map([['car-stop-1','saved-stop']]));
  assert.equal(next.visits[0].stopIds[0],'saved-stop');next.visits[0].parking.entrance.lat=55.9;
  assert.equal(car.visits[0].parking.entrance.lat,55.76);
});
test('car document rejects unknown transport, visits outside its city and excessive total budget',()=>{
  for(const mutate of [d=>d.travelMode='bicycle',d=>d.route.car.visits[0].parking.exit={lat:55.79,lon:49.12},d=>d.minutes=30]){
    const doc=carWalkDocument();mutate(doc);assert.throws(()=>validateWalkDocument(doc),{code:'BAD_REQUEST'});
  }
});
