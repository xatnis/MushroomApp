/** Research-only authentic transport observer/replay. Never reconstructs daily provider values. */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { getHeatmapWeatherBatch } from '../../src/services/weather';
import { weatherLocalDate } from '../../src/domain/weatherSeries';
import { capturePublicWeather } from './koroskaWeatherCapture';
import { memoryDb } from './koroskaWeatherFixture';
import { digest, selectPilot, type FrozenBatch } from './koroskaRegionalPrototype';
import type { HeatmapWeatherBatch } from '../../src/domain/heatmap/types';

export interface ProviderRecord {
  path:'daily'|'hourly'; endpoint:'archive'|'forecast'; url:string; startedAt:string;
  receivedAt?:string; decodedAt?:string; fetchedAt?:string; httpStatus?:number;
  headers?:Record<string,string|null>; rawBodySha256?:string; payloadDigest?:string;
  bodyBytes?:number; bodyReadMs?:number; parseMs?:number; responseMs?:number;
  payload?:unknown; error?:string;
}
export interface ContractCapture {
  schema:'koroska-authentic-contract-capture-v1'; researchOnly:true; evidence:'authentic-provider-responses';
  baseLocalDate:string; startedAt:string; completedAt:string; hostTimezone:string;
  records:ProviderRecord[]; hourlyBatch:FrozenBatch;
  legacyCache:Array<{key:string;payloadDigest:string;fetchedAt:string;expiresAt:string}>;
  legacyOutcome:{status:'fulfilled'|'rejected';error?:string};
  measurement:{httpRequests:number;dailyHttp:number;hourlyHttp:number;wholeCaptureMs:number;
    dailyColdAdapterMs:number;dailyWarmMs:number|null;dailyWarmAdditionalHttp:number|null;hourly:unknown};
  cachedEvidenceInspection:{file:string;fetchedAt:string[];pairedDailyAvailable:false;reused:false;reason:string};
  attribution:string;
}
export function providerRows(payload:unknown):Record<string,any>[] {
  return (Array.isArray(payload)?payload:[payload]).filter(row=>row&&typeof row==='object'&&!Array.isArray(row));
}
/** Strict batch identity, including Open-Meteo's omitted default location_id=0. */
export function providerRow(payload:unknown,index:number,count:number) {
  const rows=providerRows(payload),numbers=rows.filter(r=>r.location_id!=null),unnumbered=rows.filter(r=>r.location_id==null);
  const matches=rows.filter(r=>r.location_id===index);
  if(rows.length!==count)return undefined;
  if(numbers.length===0)return rows[index];
  if(numbers.length===count&&new Set(numbers.map(r=>r.location_id)).size===count
    && numbers.every(r=>Number.isInteger(r.location_id)&&r.location_id>=0&&r.location_id<count))return matches[0];
  if(unnumbered.length===1&&numbers.length===count-1&&new Set(numbers.map(r=>r.location_id)).size===count-1
    &&numbers.every(r=>Number.isInteger(r.location_id)&&r.location_id>0&&r.location_id<count))return index===0?unnumbered[0]:matches[0];
  return undefined;
}
export async function captureContracts(cachedEvidence:FrozenBatch):Promise<ContractCapture> {
  const pilot=selectPilot(),baseLocalDate=weatherLocalDate(),startedAt=new Date().toISOString(),start=performance.now();
  const records:ProviderRecord[]=[],legacyCache:ContractCapture['legacyCache']=[];
  const original=globalThis.fetch,database=memoryDb(),write=database.runAsync.bind(database);
  database.runAsync=(async (...args:unknown[])=>{
    const [sql,key,payload,fetchedAt,expiresAt]=args as string[];
    legacyCache.push({key,payloadDigest:digest(JSON.parse(payload)),fetchedAt,expiresAt});
    return write(sql,key,payload,fetchedAt,expiresAt);
  }) as typeof database.runAsync;
  let requests=0;
  globalThis.fetch=(async(input:RequestInfo|URL,options?:RequestInit)=>{
    const url=new URL(String(input));
    if(!['api.open-meteo.com','archive-api.open-meteo.com'].includes(url.hostname)
      ||url.searchParams.has('apikey')||url.searchParams.has('api_key')
      ||url.searchParams.get('latitude')!==pilot.weather.map(p=>p.latitude).join(',')
      ||url.searchParams.get('longitude')!==pilot.weather.map(p=>p.longitude).join(','))throw new Error('Unexpected/private weather request blocked');
    const path=url.searchParams.has('daily')?'daily':'hourly',endpoint=url.hostname.startsWith('archive')?'archive':'forecast';
    if(++requests>4||records.some(r=>r.path===path&&r.endpoint===endpoint))throw new Error('Four-request research cap; no retry');
    const record:ProviderRecord={path,endpoint,url:url.toString(),startedAt:new Date().toISOString()};records.push(record);
    const begin=performance.now();
    try{
      const response=await original(input,options);record.receivedAt=new Date().toISOString();record.responseMs=performance.now()-begin;
      record.httpStatus=response.status;record.headers=Object.fromEntries(['date','age','etag','last-modified','cache-control'].map(key=>[key,response.headers.get(key)]));
      // Read and parse authentic response unchanged; isolate body transfer from synchronous JSON.parse.
      const bodyStart=performance.now(),text=await response.text();record.bodyReadMs=performance.now()-bodyStart;
      record.bodyBytes=Buffer.byteLength(text);record.rawBodySha256=createHash('sha256').update(text).digest('hex');
      const parseStart=performance.now(); // Captured parseMs includes the integrity digest, not pure parse CPU.
      try{record.payload=JSON.parse(text);record.payloadDigest=digest(record.payload);}catch(error){record.error=`Invalid provider JSON: ${String(error)}`;}
      record.parseMs=performance.now()-parseStart;record.decodedAt=new Date().toISOString();
      return {ok:response.ok,status:response.status,json:async()=>{
        if(record.error)throw new Error(record.error);return record.payload;
      }} as Response;
    }catch(error){record.error=String(error);throw error;}
  }) as typeof fetch;
  try{
    const dailyStart=performance.now();let dailyColdAdapterMs=0;
    const dailyTask=getHeatmapWeatherBatch(database,pilot.weather,baseLocalDate).finally(()=>{dailyColdAdapterMs=performance.now()-dailyStart;});
    const [daily,hourly]=await Promise.allSettled([dailyTask,capturePublicWeather()]);
    const hourlyBatch:FrozenBatch=hourly.status==='fulfilled'?hourly.value.batch:{baseLocalDate,evidence:'frozen-public-weather',
      sourceContract:'failed-authentic-capture',locations:pilot.weather.map(definition=>({definition,
        sources:[{status:'rejected',reason:String(hourly.reason)},{status:'rejected',reason:String(hourly.reason)}]}))};
    // Preserve raw failures; analysis rejects a cross-midnight identity rather than inventing replacements.
    if(hourlyBatch.baseLocalDate!==baseLocalDate||weatherLocalDate()!==baseLocalDate){
      hourlyBatch.sourceContract='cross-midnight-capture-unusable';
      hourlyBatch.locations.forEach(row=>{row.sources=[{status:'rejected',reason:'Local midnight during capture'},{status:'rejected',reason:'Local midnight during capture'}];});
      hourlyBatch.baseLocalDate=baseLocalDate;
    }
    let dailyWarmMs:number|null=null,dailyWarmAdditionalHttp:number|null=null;
    if(daily.status==='fulfilled'&&records.filter(r=>r.path==='daily').every(r=>r.httpStatus===200&&!r.error)){
      const before=requests,warm=performance.now();await getHeatmapWeatherBatch(database,pilot.weather,baseLocalDate);
      dailyWarmMs=performance.now()-warm;dailyWarmAdditionalHttp=requests-before;
    }
    for(const record of records){
      if(record.path==='daily')record.fetchedAt=legacyCache.find(row=>row.payloadDigest===record.payloadDigest)?.fetchedAt;
      else {const source=hourlyBatch.locations.map(row=>row.sources[record.endpoint==='archive'?0:1]).find(s=>s.status==='fulfilled');
        if(source?.status==='fulfilled')record.fetchedAt=source.value.fetchedAt;}
    }
    // Keep both authentic response envelopes and the actual adapter-ready hourly snapshot for replay integrity checks.
    const result:ContractCapture={schema:'koroska-authentic-contract-capture-v1',researchOnly:true,evidence:'authentic-provider-responses',
      baseLocalDate,startedAt,completedAt:new Date().toISOString(),hostTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
      records,hourlyBatch,legacyCache,
      legacyOutcome:daily.status==='fulfilled'?{status:'fulfilled'}:{status:'rejected',error:String(daily.reason)},
      measurement:{httpRequests:requests,dailyHttp:records.filter(r=>r.path==='daily').length,hourlyHttp:records.filter(r=>r.path==='hourly').length,
        wholeCaptureMs:performance.now()-start,dailyColdAdapterMs,dailyWarmMs,dailyWarmAdditionalHttp,
        hourly:hourly.status==='fulfilled'?hourly.value.metrics:{error:String(hourly.reason)}},
      cachedEvidenceInspection:{file:'docs/research/koroska-regional-week-v1.sources.json',fetchedAt:cachedEvidence.locations[0].sources.flatMap(s=>s.status==='fulfilled'?[s.value.fetchedAt]:[]),
        pairedDailyAvailable:false,reused:false,reason:'No contemporaneous paired daily provider product is retained; acquire a four-response comparison rather than assume an old hourly response shares its model vintage.'},
      attribution:'Open-Meteo.com https://open-meteo.com/ CC BY 4.0; public regional coordinates only; modified into research comparisons, not mushroom probabilities.'};
    return result;
  }finally{globalThis.fetch=original;}
}

/** ACTUAL production adapter replay, seeded with authentic cache entries at their original as-of time. */
export async function replayDaily(capture:ContractCapture):Promise<{batch:HeatmapWeatherBatch|undefined;error:string|null;httpRequests:0}> {
  const database=memoryDb(),originalFetch=globalThis.fetch,originalNow=Date.now,originalTZ=process.env.TZ;
  const originals=Object.fromEntries(capture.records.filter(r=>r.path==='daily'&&r.payloadDigest).map(r=>[r.payloadDigest!,r]));
  for(const row of capture.legacyCache){
    const record=originals[row.payloadDigest];if(!record||digest(record.payload)!==row.payloadDigest)throw new Error('Missing/changed authentic cached daily payload');
    await database.runAsync('INSERT INTO weather_cache',row.key,JSON.stringify(record.payload),row.fetchedAt,row.expiresAt);
  }
  Date.now=()=>Date.parse(capture.completedAt);
  process.env.TZ=capture.hostTimezone;
  globalThis.fetch=(async(input:RequestInfo|URL)=>{
    const record=capture.records.find(r=>r.path==='daily'&&r.url===String(input));
    if(!record)throw new Error('Offline replay blocked an unrecorded request');
    if(record.error)throw new Error(record.error);
    return {ok:record.httpStatus===200,status:record.httpStatus??503,json:async()=>structuredClone(record.payload)} as Response;
  }) as typeof fetch;
  try{return {batch:await getHeatmapWeatherBatch(database,selectPilot().weather,capture.baseLocalDate),error:null,httpRequests:0};}
  catch(error){return {batch:undefined,error:String(error),httpRequests:0};}
  finally{Date.now=originalNow;globalThis.fetch=originalFetch;if(originalTZ==null)delete process.env.TZ;else process.env.TZ=originalTZ;}
}
