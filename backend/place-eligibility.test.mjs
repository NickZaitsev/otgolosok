import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPlaceEligibility } from './place-eligibility.mjs';

const point={lat:55.75,lon:37.61};
test('weak labels are skipped while identified addressless monuments remain eligible',()=>{assert.equal(assessPlaceEligibility({name:'И. В. Мичурину',location:point,tags:{historic:'memorial'}}).eligible,false);assert.equal(assessPlaceEligibility({name:'Памятник И. В. Мичурину',location:point,tags:{historic:'memorial',wikidata:'Q1'}}).eligible,true);assert.equal(assessPlaceEligibility({name:'Киев',location:point,tags:{}}).eligible,false);});
