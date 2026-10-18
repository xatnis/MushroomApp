/** Offline by default; --live explicitly permits <=2 public HTTP calls. Writes docs/research only. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { buildPrototype, cellResult, compareLegacy, digest, distribution, selectPilot, PROFILES } from './koroskaRegionalPrototype';
import { makeFrozenBatch, legacyFromFrozen } from './koroskaWeatherFixture';
import { capturePublicWeather } from './koroskaWeatherCapture';
import type { FrozenBatch } from './koroskaRegionalPrototype';

/** Research-process-only wrappers; restored immediately. Measures existing functions, no formula edits. */
function traceBuildStages() {
  const measures:Record<string,{calls:number;ms:number}>={},undo:Array<()=>void>=[];
  const attach=(module:Record<string,any>,key:string,label:string)=>{
    const original=module[key];measures[label]={calls:0,ms:0};
    module[key]=(...args:unknown[])=>{const start=performance.now();try{return original(...args);}finally{measures[label].calls++;measures[label].ms+=performance.now()-start;}};
    undo.push(()=>{module[key]=original;});
  };
  attach(require('../../src/domain/weatherIntervals'),'indexHourlySource','timestampIndex');
  attach(require('../../src/domain/weatherIntervals'),'aggregateCivilDay','civilDailyAggregation');
  attach(require('../../src/domain/soilSampling'),'sampleNativeSoil','soilSampling');
  attach(require('../../src/services/weather'),'buildHistoricalWeatherSummaryForTarget','rollingWindowAssembly');
  attach(require('../../src/domain/mushroomWeather'),'calculateMushroomWeatherScore','productionScorer');
  return {measures,restore:()=>undo.reverse().forEach(fn=>fn())};
}

async function main() {
  const started = performance.now(), memoryStart = process.memoryUsage(), cpuStart = process.cpuUsage();
  const phase = performance.now();
  const replay=process.argv.indexOf('--replay'), live=process.argv.includes('--live');
  if(live&&replay>=0)throw new Error('Choose live OR replay, never both');
  const acquired=live?await capturePublicWeather():undefined;
  const batch:FrozenBatch=acquired?.batch??(replay>=0?JSON.parse(readFileSync(process.argv[replay+1],'utf8')):makeFrozenBatch());
  const oldSummaryPath='docs/research/koroska-regional-week-v1.summary.json';
  const previous=replay>=0&&existsSync(oldSummaryPath)?JSON.parse(readFileSync(oldSummaryPath,'utf8')):undefined;
  const originalCaptureMeasurement=acquired?.metrics??(previous?.batchId===digest(batch)
    ?previous.acquisition.originalCaptureMeasurement??previous.acquisition.liveMeasurement:null);
  const fixtureLookupAndGenerationMs = performance.now() - phase;
  const fingerprint = digest(['src/domain/mushroomWeather.ts','src/domain/heatmap/pilot.ts','src/domain/heatmap/zgs.ts',
    'src/domain/sevenDayConditions.ts','src/domain/weatherIntervals.ts','src/domain/soilSampling.ts','src/services/sevenDayHourlyWeather.ts']
    .map(file => ({file, contents:readFileSync(file,'utf8')})));
  const trace=traceBuildStages();
  let built:Awaited<ReturnType<typeof buildPrototype>>;
  try{built=await buildPrototype(batch,fingerprint);}finally{trace.restore();}
  strictEqual(trace.measures.timestampIndex.calls,batch.locations.reduce((n,row)=>n+row.sources.filter(s=>s.status==='fulfilled').length,0));
  strictEqual(trace.measures.civilDailyAggregation.calls,built.metrics.civilDailyAggregates);
  strictEqual(trace.measures.soilSampling.calls,77);strictEqual(trace.measures.productionScorer.calls,308);
  strictEqual(trace.measures.rollingWindowAssembly.calls,319);
  const legacyStart = performance.now();
  if(process.argv.includes('--verify'))deepStrictEqual(built.data,JSON.parse(readFileSync('docs/research/koroska-regional-week-v1.dataset.json','utf8')));
  const legacy = await legacyFromFrozen(batch), comparison = legacy.result?compareLegacy(built.data, legacy.result.cells):undefined;
  const legacyComparisonMs = performance.now() - legacyStart;
  const joinStart = performance.now();
  const availability: Record<string,number> = {}, byDateProfile = [];
  for (const [profileIndex,profile] of PROFILES.entries()) for (let day=0;day<7;day++) {
    const rows = built.data.cells.map((_,i)=>cellResult(built.data,i,profileIndex,day));
    const histogram = (key: 'availability'|'habitatState') => Object.fromEntries([...new Set(rows.map(r=>r[key]))].map(k=>[k,rows.filter(r=>r[key]===k).length]));
    rows.forEach(row=>{availability[row.availability]=(availability[row.availability]??0)+1;});
    byDateProfile.push({profile,date:built.data.dates[day], publishedScore:distribution(rows.flatMap(r=>r.score==null?[]:[r.score])),
      weatherScore:distribution(rows.flatMap(r=>r.weatherScore==null?[]:[r.weatherScore])),availability:histogram('availability'),habitat:histogram('habitatState')});
  }
  const materializeAllCellSummariesMs = performance.now()-joinStart;
  const serializationStart = performance.now(), text=JSON.stringify(built.data), serializationMs=performance.now()-serializationStart;
  const compressionStart=performance.now(), compressed=gzipSync(text), compressionMs=performance.now()-compressionStart;
  deepStrictEqual(JSON.parse(text), JSON.parse(JSON.stringify(built.data)));
  const pilot=selectPilot(), geometry={type:'FeatureCollection',researchOnly:true,
    geometryFingerprint:built.data.geometryFingerprint, features:pilot.cells.map((cell,index)=>({...cell,
      properties:{id:cell.properties.id,cellIndex:index,weatherIndex:built.data.cells[index].weatherIndex}}))};
  const geometryText=JSON.stringify(geometry), memoryEnd=process.memoryUsage(), cpu=process.cpuUsage(cpuStart);
  const summary={researchOnly:true,evidence:batch.evidence,notAPublishedForecast:true,
    environment:`${process.platform} Node ${process.version}; no native Android measurements`,
    contract:built.data.inputVersion,batchId:built.data.batchId,geometryFingerprint:built.data.geometryFingerprint,
    bboxSelectionRule:'Inclusive EXISTING representative centre in [14.65,46.35,15.05,46.59]; preserve whole existing clipped polygons',
    cells:built.data.cells.length,weatherLocations:built.data.weather,dates:built.data.dates,profiles:PROFILES,
    availability,byDateProfile,weatherVectorAvailability:Object.fromEntries(['ready','stale','insufficient_data','error'].map(s=>[s,built.data.vectors.filter(v=>v.status===s).length])),
    acquisition:{realHttpRequests:acquired?.metrics.realHttpRequests??0,liveMeasurement:acquired?.metrics??null,
      originalCaptureMeasurement,canonicalSuppliedSourceObjects:batch.locations.length*2,
      legacyMockTransportInvocations:legacy.mockRequests,sourceDecodedBytesByEndpoint:[0,1].map(endpoint=>Buffer.byteLength(JSON.stringify(batch.locations.map(row=>{
        const s=row.sources[endpoint]; return s.status==='fulfilled'?s.value.data:null;})))),
      note:acquired?'Two-endpoint bounded public weather probe; shared production plan/cache/dedupe, ephemeral memory DB. No private data.'
        :'Offline fixture/replay; no HTTP. Production batching/warm dedupe also exercised under mocked HTTP in smoke test.'},
    timings:{fixtureLookupAndGenerationMs,...built.metrics,stages:trace.measures,
      instrumentationNote:'Synchronous wrappers around actual production functions, research process only; small timing overhead included. Nested timings must not be added twice.',
      materializeAllCellSummariesMs,legacyComparisonMs,serializationMs,compressionMs,
      wallMs:performance.now()-started,processCpuUserMs:cpu.user/1000,processCpuSystemMs:cpu.system/1000},
    memory:{processStart:memoryStart,processEnd:memoryEnd,processPeakRssBytes:process.resourceUsage().maxRSS*1024,
      note:'Whole Node process incl TS compiler/static production imports/fixtures; NOT Android PSS and NOT isolated adapter allocation. Peak RSS measured by OS.'},
    size:{datasetJsonBytes:Buffer.byteLength(text),datasetGzipBytes:compressed.length,
      geometryJsonBytes:Buffer.byteLength(geometryText),geometryGzipBytes:gzipSync(geometryText).length},
    legacy:comparison?{methodology:comparison.methodology,weatherSummary:comparison.weatherSummary,cellWeightedSummary:comparison.cellWeightedSummary,
      candidateWeightedSummary:comparison.candidateWeightedSummary,byProfileDate:comparison.byProfileDate,signedDelta:comparison.signedDelta}
      :{available:false,reason:legacy.error},
    limitations:[batch.evidence==='synthetic-fixture'?'Synthetic sensitivity experiment, not a live weather forecast.':'Captured operational best-match weather; NOT a provider-run-pinned national publication or ecological validation.',
      'Legacy fixed-offset DAILY bins reconstructed from the same hourly field; not proof of exact live provider daily-product equality.',
      'Hourly adaptation shares civil days; existing target-window validation still repeats per profile.',
      'No tile encoding, Android rendering, server deployment or national extrapolated completion-time guarantee.']};
  if(process.argv.includes('--save')&&process.argv.includes('--summary-only')) {
    if(batch.evidence!=='synthetic-fixture')throw new Error('Summary-only control must be explicitly synthetic');
    writeFileSync('docs/research/koroska-regional-week-v1.fixture-summary.json',JSON.stringify(summary,null,2)+'\n');
  } else if(process.argv.includes('--save')) {
    // Fixed explicit outputs: never source assets/cache/private data.
    writeFileSync('docs/research/koroska-regional-week-v1.dataset.json',text+'\n');
    writeFileSync('docs/research/koroska-regional-week-v1.geometry.geojson',geometryText+'\n');
    writeFileSync('docs/research/koroska-regional-week-v1.summary.json',JSON.stringify(summary,null,2)+'\n');
    writeFileSync('docs/research/koroska-regional-week-v1.legacy.json',JSON.stringify(comparison??{available:false,reason:legacy.error},null,2)+'\n');
    if(live)writeFileSync('docs/research/koroska-regional-week-v1.sources.json',JSON.stringify(batch)+'\n');
  }
  console.log(JSON.stringify(summary,null,2));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
