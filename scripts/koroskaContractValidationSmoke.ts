import {readFileSync} from 'node:fs';
import {deepStrictEqual,strictEqual,ok,rejects} from 'node:assert';
import {gzipSync,gunzipSync} from 'node:zlib';
import {validateContracts,variablePair,scoreStats} from './research/koroskaContractValidation';
import {providerRows,providerRow,replayDaily,type ContractCapture} from './research/koroskaContractCapture';
import {digest,buildPrototype,selectPilot} from './research/koroskaRegionalPrototype';
import {makeFrozenBatch} from './research/koroskaWeatherFixture';
import {civilDailyPeriod,providerDailyPeriod,resolveLjubljanaClock} from '../src/domain/soilSampling';

async function main(){
  const capture:ContractCapture=JSON.parse(readFileSync('docs/research/koroska-contract-validation-v1.capture.json','utf8'));
  strictEqual(capture.measurement.httpRequests,4);strictEqual(capture.records.length,4);
  ok(capture.records.every(r=>r.httpStatus===200&&!r.error));
  for(const record of capture.records){const url=new URL(record.url);
    strictEqual(url.searchParams.get('timezone'),record.path==='daily'?'Europe/Ljubljana':'GMT');
    if(record.path==='daily')ok(url.searchParams.has('daily')&&!url.searchParams.has('timeformat'));
    else {strictEqual(url.searchParams.get('timeformat'),'unixtime');ok(!url.searchParams.has('daily'));}
  }
  strictEqual(capture.measurement.dailyWarmAdditionalHttp,0);
  const before=digest(capture),originalFetch=globalThis.fetch,originalNow=Date.now,originalTZ=process.env.TZ;
  let escapedRequests=0;
  globalThis.fetch=(async()=>{escapedRequests++;throw new Error('No external HTTP allowed in validation smoke');}) as typeof fetch;
  try{
    const {batch}=await replayDaily(capture);ok(batch);strictEqual(batch.policyVersion,'pilot-weather-v1');
    const first=selectPilot().weather[0],archive=capture.records.find(r=>r.path==='daily'&&r.endpoint==='archive')!;
    const raw=providerRow(archive.payload,0,11)!;
    strictEqual(batch.cells[first.id].days[0].precipitationMm,raw.daily.precipitation_sum[0],'REAL daily product enters production adapter unchanged');
    const firstRun=await validateContracts(capture),r=firstRun.report;
    strictEqual(digest(capture),before);strictEqual(Date.now,originalNow);strictEqual(process.env.TZ,originalTZ);
    strictEqual(r.evidence,'observational-authentic-products');strictEqual(r.cases.length,88);
    strictEqual(r.weatherDates.length,22);strictEqual(r.cellDiagnostics.length,696);
    strictEqual(r.fullQualityCases,88);strictEqual(r.rawInputEquality,0);strictEqual(r.soilInstantEquality,22);
    strictEqual(r.weatherScoreImpact.changed,4);strictEqual(r.weatherScoreImpact.categoryChanges,1);
    strictEqual(r.weatherScoreImpact.absoluteDelta.max,1);strictEqual(r.candidateCellImpact.cases,4776);
    strictEqual(r.candidateCellImpact.changed,185);strictEqual(r.candidateCellImpact.categoryChanges,94);
    strictEqual(r.allCellWeatherImpact.cases,5568);strictEqual(r.dailyBoundaryMismatches,0);
    strictEqual(firstRun.dailyDifferences.length,671);
    ok(r.cases.every(c=>c.identityAndUnitsComparable));
    ok(r.cases.every(c=>c.factors.every(f=>!f.legacy||!f.hourly||f.legacy.weight===f.hourly.weight)));
    ok(r.cases.every(c=>c.factors.every(f=>f.delta==null||f.historicalInputDelta==null||f.remainingSoilProductDelta==null
      ||Math.abs(f.delta-f.historicalInputDelta-f.remainingSoilProductDelta)<1e-12)));
    ok(r.cases.filter(c=>c.delta!==0).every(c=>c.historyOnlyScore===c.hourlyScore&&c.sameDailySourcePolicyOnlyScore===c.legacyScore));
    strictEqual(r.comparability.providerRunEqualityVerified,false);
    ok(r.metadata.every(m=>m.dailyForecast.verifiedModelRunTime===null&&m.hourlyForecast.verifiedModelRunTime===null));
    ok(r.metadata.every(m=>m.dailyForecast.offsetSeconds===7200&&m.hourlyForecast.offsetSeconds===0));
    ok(r.variableSummary.rain60dMm.absoluteDelta.max!<1e-9);ok(r.variableSummary.avgTemp20dC.absoluteDelta.max!>0);
    strictEqual(r.variableSummary.soil0To7.exact,22);
    const repeat=await validateContracts(capture);
    const stable=({performance,...rest}:typeof r)=>rest;
    deepStrictEqual(stable(repeat.report),stable(r));deepStrictEqual(repeat.dailyDifferences,firstRun.dailyDifferences);
    deepStrictEqual(JSON.parse(gunzipSync(gzipSync(JSON.stringify(stable(r)))).toString()),JSON.parse(JSON.stringify(stable(r))));
    strictEqual(variablePair(0,null,'mm').delta,null);strictEqual(variablePair(0,0,'mm').exact,true);
    strictEqual(scoreStats([{legacyScore:null,hourlyScore:0,delta:null,categoryChanged:null}]).availabilityChanges,1);
    strictEqual(providerRow([{location_id:0},{location_id:0}],0,2),undefined);
    strictEqual(providerRow([{location_id:0}],0,2),undefined);
    ok(providerRow([{}, {location_id:1}],0,2));

    // Explicitly labelled controlled response mutations; never saved/called live observations.
    const changeDaily=(edit:(rows:Record<string,any>[])=>void)=>{
      const c=structuredClone(capture),record=c.records.find(r=>r.path==='daily'&&r.endpoint==='forecast')!,old=record.payloadDigest;
      edit(providerRows(record.payload));record.payloadDigest=digest(record.payload);
      c.legacyCache.filter(row=>row.payloadDigest===old).forEach(row=>{row.payloadDigest=record.payloadDigest!;});return c;
    };
    const wrongUnits=await validateContracts(changeDaily(rows=>{rows[0].daily_units.precipitation_sum='inch';}),{controlLabel:'wrong legacy units'});
    ok(wrongUnits.report.cases.filter(c=>c.weatherIndex===0).every(c=>!c.identityAndUnitsComparable&&!c.fullyComparable&&c.delta===null));
    strictEqual(wrongUnits.report.evidence,'controlled-response-mutation');
    const partialDaily=await validateContracts(changeDaily(rows=>{delete rows[0].hourly.soil_moisture_7_to_28cm;}),{controlLabel:'missing legacy soil'});
    ok(partialDaily.report.cases.filter(c=>c.weatherIndex===0).every(c=>c.legacyQuality===(c.profileId==='generic'?'limited':'complete')
      &&!c.fullyComparable&&!c.equivalentRequiredCoverage),
      'Generic needs both soil layers; species retain a soil factor from one layer. Canonical full-input comparability must not claim both layers.');
    const noLegacySoil=await validateContracts(changeDaily(rows=>{delete rows[0].hourly.soil_moisture_7_to_28cm;delete rows[0].hourly.soil_moisture_0_to_7cm;}),{controlLabel:'both legacy soil layers missing'});
    ok(noLegacySoil.report.cases.filter(c=>c.weatherIndex===0).every(c=>c.legacyQuality==='limited'&&!c.fullyComparable));
    const missingHourly=structuredClone(capture),hour=missingHourly.records.find(r=>r.path==='hourly'&&r.endpoint==='forecast')!;
    const rows=providerRows(hour.payload);delete rows[0].hourly.soil_moisture_7_to_28cm;
    hour.payloadDigest=digest(hour.payload);
    const source=missingHourly.hourlyBatch.locations[0].sources[1];if(source.status==='fulfilled')source.value.data=rows[0] as any;
    const missing=await validateContracts(missingHourly,{controlLabel:'missing canonical soil'});
    ok(missing.report.cases.filter(c=>c.weatherIndex===0).every(c=>c.hourlyScore===null&&c.hourlyMissing.length>0));
    strictEqual(missing.report.weatherScoreImpact.availabilityChanges,8);
    const failedDaily=structuredClone(capture),failedRecord=failedDaily.records.find(r=>r.path==='daily'&&r.endpoint==='forecast')!,oldDigest=failedRecord.payloadDigest;
    failedDaily.legacyCache=failedDaily.legacyCache.filter(row=>row.payloadDigest!==oldDigest);
    Object.assign(failedRecord,{httpStatus:503,error:'controlled provider failure',payload:undefined,payloadDigest:undefined,fetchedAt:undefined});
    const failedResult=await validateContracts(failedDaily,{controlLabel:'actual adapter handling of recorded failure'});
    strictEqual(failedResult.report.weatherScoreImpact.legacyNumeric,0);strictEqual(failedResult.report.weatherScoreImpact.availabilityChanges,88);
    const mismatched=structuredClone(capture);mismatched.hourlyBatch.locations[0].definition.latitude+=.001;
    await rejects(()=>validateContracts(mismatched,{controlLabel:'wrong query point'}),/coordinate/);
    const wrongDate=structuredClone(capture);wrongDate.hourlyBatch.baseLocalDate='2026-10-19';await rejects(()=>validateContracts(wrongDate),/matched-date/);
    const wrongVintage=structuredClone(capture),s=wrongVintage.hourlyBatch.locations[0].sources[1];
    if(s.status==='fulfilled')s.value.fetchedAt='2026-10-18T20:09:19.000Z';
    await rejects(()=>validateContracts(wrongVintage,{controlLabel:'mismatched source snapshot'}),/authentic captured/);
    const tampered=structuredClone(capture);providerRows(tampered.records[0].payload)[0].elevation=-99;
    await rejects(()=>validateContracts(tampered),/integrity/);

    // Deterministic, explicitly SYNTHETIC DST controls; no future historical observation claimed.
    const spring=await buildPrototype(makeFrozenBatch('2026-03-30'),'fixture');
    strictEqual(spring.snapshots[0].intervalCoverage!['2026-03-29'].precipitation.expected,23);
    strictEqual(spring.data.vectors.filter(v=>v.score!=null).length,308);
    const autumn=await buildPrototype(makeFrozenBatch('2026-10-24'),'fixture');
    strictEqual(autumn.snapshots[0].intervalCoverage!['2026-10-25'].precipitation.expected,25);
    strictEqual(autumn.data.vectors.filter(v=>v.score!=null).length,308);
    strictEqual(providerDailyPeriod('2026-03-29',7200).compatible,false);
    strictEqual(providerDailyPeriod('2026-10-25',3600).compatible,false);
    strictEqual(resolveLjubljanaClock('2026-03-29T02:30').length,0);
    strictEqual(resolveLjubljanaClock('2026-10-25T02:30').length,2);
    strictEqual(civilDailyPeriod('2026-03-29').startUtc,'2026-03-28T23:00:00.000Z');
    strictEqual(civilDailyPeriod('2026-10-25').endUtc,'2026-10-25T23:00:00.000Z');
    strictEqual(escapedRequests,0);strictEqual(Date.now,originalNow);strictEqual(process.env.TZ,originalTZ);
    console.log('PASS authentic daily/hourly production replay: 11x2x4, raw variables/soil/provenance, 696-cell impact, controls, units/missing/vintage/identity gates, DST fixtures, reproducibility; external HTTP=0.');
  }finally{globalThis.fetch=originalFetch;}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
