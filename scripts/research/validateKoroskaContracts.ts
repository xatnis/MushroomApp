/** Offline only. All primary values come from captured authentic API products, never reconstruction. */
import { readFileSync,writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { validateContracts } from './koroskaContractValidation';
const prefix='docs/research/koroska-contract-validation-v1';
const stages:Record<string,{calls:number;ms:number}>={},undo:Array<()=>void>=[];
for(const [path,key] of [['../../src/domain/mushroomWeather','calculateMushroomWeatherScore'],['../../src/domain/weatherIntervals','aggregateCivilDay'],
  ['../../src/domain/soilSampling','sampleNativeSoil'],['../../src/services/weather','buildHistoricalWeatherSummaryForTarget']]){
  const module=require(path),original=module[key];stages[key]={calls:0,ms:0};
  module[key]=(...args:unknown[])=>{const start=performance.now();try{return original(...args);}finally{stages[key].calls++;stages[key].ms+=performance.now()-start;}};
  undo.push(()=>{module[key]=original;});
}
const capture=JSON.parse(readFileSync(prefix+'.capture.json','utf8'));
const offlineParse=capture.records.map((r:{path:string;endpoint:string;payload:unknown})=>{
  const text=JSON.stringify(r.payload),times=Array.from({length:5},()=>{const s=performance.now();JSON.parse(text);return performance.now()-s;}).sort((a,b)=>a-b);
  return {path:r.path,endpoint:r.endpoint,semanticJsonBytes:Buffer.byteLength(text),medianParseMs:times[2]};
});
void validateContracts(capture).then(result=>{
  Object.assign(result.report.performance,{functionTimings:stages,offlinePureParse:offlineParse,
    timingNote:'Research-process wrappers only, restored after analysis; nested timing totals are not additive. Capture parseMs includes integrity hashing; offlinePureParse isolates JSON.parse.'});
  Object.assign(result.report,{productionCodeDigests:Object.fromEntries(['src/services/weather.ts','src/services/sevenDayHourlyWeather.ts',
    'src/domain/weatherIntervals.ts','src/domain/soilSampling.ts','src/domain/sevenDayConditions.ts','src/domain/mushroomWeather.ts','src/domain/heatmap/assessment.ts']
    .map(path=>[path,require('node:crypto').createHash('sha256').update(readFileSync(path)).digest('hex')]))});
  if(process.argv.includes('--save')){
    writeFileSync(prefix+'.report.json',JSON.stringify(result.report,null,2)+'\n');
    writeFileSync(prefix+'.daily.json',JSON.stringify(result.dailyDifferences)+'\n');
    writeFileSync(prefix+'.diagnostics.geojson',JSON.stringify(result.geometry)+'\n');
  }
  console.log(JSON.stringify({weather:result.report.weatherScoreImpact,candidates:result.report.candidateCellImpact,
    variables:result.report.variableSummary,factors:result.report.factorSummary,rawInputEquality:result.report.rawInputEquality,
    soilInstantsEqual:result.report.soilInstantEquality,boundaryMismatches:result.report.dailyBoundaryMismatches,
    performance:result.report.performance,
    sizes:Object.fromEntries(Object.entries(result).map(([key,value])=>{const text=JSON.stringify(value,key==='report'?null:undefined,key==='report'?2:undefined)+'\n';return[key,{jsonBytes:Buffer.byteLength(text),gzipBytes:gzipSync(text).length}];}))},null,2));
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>undo.reverse().forEach(fn=>fn()));
