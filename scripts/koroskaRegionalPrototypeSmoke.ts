import { strictEqual, deepStrictEqual, ok, rejects, throws } from 'node:assert';
import { gzipSync, gunzipSync } from 'node:zlib';
import { buildPrototype, cellResult, compareLegacy, digest, PROFILES, selectPilot } from './research/koroskaRegionalPrototype';
import { makeFrozenBatch, legacyFromFrozen, memoryDb } from './research/koroskaWeatherFixture';
import { civilDailyPeriod } from '../src/domain/soilSampling';
import { buildWeatherInputsForTargetDate } from '../src/domain/sevenDayConditions';
import { shiftLocalDate } from '../src/services/weather';
import { loadPointSnapshots } from '../src/services/pointConditions';
import { containsPoint } from '../src/domain/heatmap/spatial';

async function main() {
  const pilot=selectPilot(); strictEqual(pilot.cells.length,696); strictEqual(pilot.weather.length,11);
  ok(pilot.cells.length<=700 && pilot.weather.length<=13);
  for(const cell of pilot.cells) ok(containsPoint(cell.geometry,[cell.properties.centerLongitude,cell.properties.centerLatitude]),'original representative centre is in its original geometry');
  const batch=makeFrozenBatch(), frozen=digest(batch), built=await buildPrototype(batch,'test-scorer-fingerprint');
  strictEqual(digest(batch),frozen,'input batch is immutable');
  strictEqual(built.data.dates.length,7); strictEqual(built.data.vectors.length,308);
  strictEqual(built.data.inputs.length,77); strictEqual(built.metrics.civilDailyAggregates,737);
  strictEqual(built.data.snapshotValidity.length,11);
  ok(built.data.snapshotValidity.every(s=>s.expiresAt===Date.parse(s.assessmentAsOf)+1800000),'replay does not reset original TTL');
  strictEqual(built.data.vectors.filter(v=>v.score!=null).length,308);
  deepStrictEqual(built.data.dates,Array.from({length:7},(_,i)=>shiftLocalDate(batch.baseLocalDate,i)));
  for(const [wi,snapshot] of built.snapshots.entries()) for(const profile of PROFILES) for(let day=0;day<7;day++) {
    const target=shiftLocalDate(batch.baseLocalDate,day), inputs=buildWeatherInputsForTargetDate(snapshot,target,profile);
    strictEqual(inputs.missing.length,0);
    strictEqual(inputs.history.length,60,'D60 never truncated to 30');
    ok(inputs.history.every(e=>e.day.date<target && e.day.date>=shiftLocalDate(target,-60)));
    strictEqual(snapshot.latitude,pilot.weather[wi].latitude);
    strictEqual(snapshot.dailyPeriods['2026-10-25'].basis,'local-calendar');
    strictEqual(snapshot.intervalCoverage?.['2026-10-25'].precipitation.expected,25);
    strictEqual(snapshot.soilSampling?.[target].mode,day?'forecast':'currentModelled');
    if(day) strictEqual(snapshot.soilSampling?.[target].localTime,`${target}T09:00`);
  }
  for(const [pi,profile] of PROFILES.entries()) for(let day=0;day<7;day++) for(let ci=0;ci<pilot.cells.length;ci++) {
    const row=cellResult(built.data,ci,pi,day), vector=built.data.vectors[(row.provenance.weatherIndex*4+pi)*7+day];
    strictEqual(row.profileId,profile); strictEqual(row.targetLocalDate,built.data.dates[day]);
    strictEqual(row.weatherScore,vector.score); deepStrictEqual(row.factors,vector.factors);
    strictEqual(row.score,row.habitatState==='candidate'?row.weatherScore:null);
    ok(row.factors.every(c=>c.weight>0 && c.weightedPoints>=0 && c.weightedPoints<=c.weight));
  }
  throws(()=>cellResult(built.data,0,0,7));
  const repeat=await buildPrototype(batch,'test-scorer-fingerprint');
  deepStrictEqual(repeat.data,built.data,'deterministic artifact (timings not part of dataset)');
  deepStrictEqual(JSON.parse(gunzipSync(gzipSync(JSON.stringify(built.data))).toString()),JSON.parse(JSON.stringify(built.data)));
  const legacy=await legacyFromFrozen(batch); strictEqual(legacy.realHttpRequests,0); strictEqual(legacy.mockRequests,2);
  ok(legacy.result);
  const comparison=compareLegacy(built.data,legacy.result.cells);
  strictEqual(comparison.weatherSummary.cases,88); strictEqual(comparison.cellWeightedSummary.cases,5568);
  strictEqual(comparison.weatherSummary.exact+comparison.weatherSummary.different,88);
  strictEqual(comparison.weatherSummary.different,16); strictEqual(comparison.weatherSummary.absoluteDelta.max,1);
  ok(comparison.comparisons.every(c=>c.sameCoordinates && c.factorDeltas.every(f=>f.weight===f.legacyWeight)));
  ok(comparison.comparisons.some(c=>c.soilChanged));
  const wrong=structuredClone(legacy.result.cells); wrong[pilot.weather[0].id].latitude+=.01;
  throws(()=>compareLegacy(built.data,wrong),/coordinate/);

  // Missing/incompatible sources are never converted to zero or renormalized full scores.
  const mutate=async (edit:(value:ReturnType<typeof makeFrozenBatch>)=>void)=>{const changed=structuredClone(batch);edit(changed);return buildPrototype(changed,'test-scorer-fingerprint');};
  const missingSoil=await mutate(b=>{const s=b.locations[0].sources[1]; if(s.status==='fulfilled') delete s.value.data.hourly!.soil_moisture_7_to_28cm;});
  ok(missingSoil.data.vectors.filter(v=>v.weatherIndex===0).every(v=>v.score===null && v.missing.length>0));
  ok(compareLegacy(missingSoil.data,legacy.result.cells).weatherSummary.availabilityChanges>0,'missing weather remains a changed availability, not zero');
  const wrongDepth=await mutate(b=>{const s=b.locations[0].sources[1]; if(s.status==='fulfilled') s.value.data.hourly_units!.soil_moisture_0_to_7cm='cm';});
  ok(wrongDepth.data.vectors.filter(v=>v.weatherIndex===0).every(v=>v.score===null));
  const zeroRain=await mutate(b=>{for(const s of b.locations[0].sources)if(s.status==='fulfilled')s.value.data.hourly!.precipitation!.fill(0);});
  ok(zeroRain.data.vectors.filter(v=>v.weatherIndex===0).every(v=>v.score!==null&&v.factors.filter(c=>c.key.startsWith('rain')).every(c=>c.weightedPoints===0)));
  const missingEt=await mutate(b=>{const s=b.locations[0].sources[1];if(s.status==='fulfilled') s.value.data.hourly!.et0_fao_evapotranspiration!.fill(null);});
  ok(missingEt.data.vectors.filter(v=>v.weatherIndex===0).every(v=>v.score===null));
  const missingD60=await mutate(b=>{const s=b.locations[0].sources[0]; if(s.status==='fulfilled') {
    const d=shiftLocalDate(batch.baseLocalDate,-59), start=Date.parse(civilDailyPeriod(d).startUtc!)/1000;
    const i=s.value.data.hourly!.time!.findIndex(t=>t===start+3600);s.value.data.hourly!.precipitation![i]=null;
  }});
  strictEqual(missingD60.data.vectors.find(v=>v.weatherIndex===0&&v.profileId==='lactariusDeliciosus')!.score,null);
  ok(missingD60.data.vectors.filter(v=>v.weatherIndex===0&&v.profileId==='generic').every(v=>v.score!==null),'D60 missing does not block Generic D30');
  const duplicate=await mutate(b=>{const s=b.locations[0].sources[1]; if(s.status==='fulfilled') s.value.data.hourly!.time![50]=s.value.data.hourly!.time![49];});
  ok(duplicate.data.vectors.filter(v=>v.weatherIndex===0).some(v=>v.score===null));
  const failed=await mutate(b=>{b.locations[0].sources[1]={status:'rejected',reason:'offline synthetic'};});
  ok(failed.data.vectors.filter(v=>v.weatherIndex===0).every(v=>v.score===null && v.status==='error'));
  const allFailed=structuredClone(batch);allFailed.locations.forEach(row=>{row.sources=[{status:'rejected',reason:'offline'},{status:'rejected',reason:'offline'}];});
  const noNetworkData=await buildPrototype(allFailed,'test');
  ok(noNetworkData.data.vectors.every(v=>v.score===null&&v.status==='error'));
  strictEqual(noNetworkData.metrics.civilDailyAggregates,0);
  const noLegacy=await legacyFromFrozen(allFailed);strictEqual(noLegacy.result,undefined);strictEqual(noLegacy.realHttpRequests,0);
  const stale=await mutate(b=>{for(const s of b.locations[0].sources) if(s.status==='fulfilled')s.value.stale=true;});
  ok(stale.data.vectors.filter(v=>v.weatherIndex===0).every(v=>v.score!==null&&v.status==='stale'));
  const vintage=structuredClone(batch), first=vintage.locations[0].sources[1]; if(first.status==='fulfilled')first.value.fetchedAt='2026-10-26T09:46:00Z';
  await rejects(()=>buildPrototype(vintage,'test'),/vintages/);
  const moved=structuredClone(batch);moved.locations[0].definition.latitude+=.001;
  await rejects(()=>buildPrototype(moved,'test'),/coordinate/);
  const dupe=structuredClone(batch);dupe.locations[0]=dupe.locations[1]; await rejects(()=>buildPrototype(dupe,'test'),/identity/);
  // Rainfall AFTER a target cutoff cannot alter that target's numerical score/factors.
  const noLeak=await mutate(b=>{const s=b.locations[0].sources[1];if(s.status==='fulfilled') {
    const cutoff=Date.parse(civilDailyPeriod(shiftLocalDate(batch.baseLocalDate,3)).startUtc!)/1000;
    s.value.data.hourly!.precipitation=s.value.data.hourly!.precipitation!.map((v,i)=>s.value.data.hourly!.time![i]>cutoff?1000:v);
  }});
  for(const pi of [0,1,2,3]) for(let day=0;day<=3;day++) {
    const i=pi*7+day; strictEqual(noLeak.data.vectors[i].score,built.data.vectors[i].score);
    deepStrictEqual(noLeak.data.vectors[i].factors,built.data.vectors[i].factors);
  }
  // Both true DST days plus leap/month/year transitions and future 09:00 offset change.
  for(const date of ['2026-03-28','2026-10-24','2024-02-28','2026-12-29']) {
    const result=await buildPrototype(makeFrozenBatch(date),'test');
    strictEqual(result.data.vectors.filter(v=>v.score!==null).length,308,date);
    strictEqual(result.data.dates[6],shiftLocalDate(date,6));
    for(const snap of result.snapshots) for(const day of result.data.dates.slice(1)) strictEqual(snap.soilSampling![day].localTime,day+'T09:00');
    if(date==='2026-03-28')strictEqual(result.snapshots[0].intervalCoverage!['2026-03-29'].precipitation.expected,23);
    if(date==='2026-10-24')strictEqual(result.snapshots[0].intervalCoverage!['2026-10-25'].precipitation.expected,25);
  }

  // Exercise ACTUAL production multi-location batching/in-flight dedupe, but route all HTTP to fixture.
  // No production cache/table is opened; memoryDb is per-test and discarded.
  const original=globalThis.fetch, transport=makeFrozenBatch('2026-10-18'), database=memoryDb();let requests=0;
  globalThis.fetch=(async (url:string|URL|Request)=>{
    if(++requests>2)throw new Error('Per-cell or duplicated acquisition');
    const params=new URL(String(url)).searchParams, endpoint=String(url).includes('archive-api')?0:1;
    strictEqual(params.get('latitude')!.split(',').length,11);
    return {ok:true,status:200,json:async()=>transport.locations.map(row=>{const s=row.sources[endpoint];if(s.status!=='fulfilled')throw Error('fixture');return s.value.data;})} as Response;
  }) as typeof fetch;
  try {
    const points=pilot.weather.map(p=>({latitude:p.latitude,longitude:p.longitude}));
    const [a,b]=await Promise.all([loadPointSnapshots(database,points,'2026-10-18'),loadPointSnapshots(database,points,'2026-10-18')]);
    strictEqual(requests,2);strictEqual(a.length,11);strictEqual(a[0],b[0]);
    await loadPointSnapshots(database,points,'2026-10-18');strictEqual(requests,2,'warm reopen zero extra');
    for(let day=0;day<7;day++)cellResult(built.data,0,0,day); strictEqual(requests,2);
  } finally{globalThis.fetch=original;}
  console.log('Koroška research: 696 cells / 11 weather locations; 308 vectors; 19,488 cell/date/profile entries; DST, gates, legacy, serialization, mocked 2-request batching and warm 0-request reuse PASS. Real HTTP: 0.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
