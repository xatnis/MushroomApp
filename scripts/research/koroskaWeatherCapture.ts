/** Opt-in bounded public-weather acquisition, reusing production URL plan/cache/dedupe. */
import { performance } from 'node:perf_hooks';
import { cachedFetch } from '../../src/services/weather';
import { weatherLocalDate } from '../../src/domain/weatherSeries';
import { sevenDayHourlyRequestPlan } from '../../src/services/sevenDayHourlyWeather';
import type { UtcHourlyWeather } from '../../src/domain/weatherIntervals';
import { digest, selectPilot, type FrozenBatch } from './koroskaRegionalPrototype';
import { memoryDb } from './koroskaWeatherFixture';

export async function capturePublicWeather() {
  const weather=selectPilot().weather, baseLocalDate=weatherLocalDate(), database=memoryDb();
  let realHttpRequests=0;const timings:Array<{endpoint:string;stage:string;elapsedMs:number}>=[];
  const started=performance.now();
  const requests=sevenDayHourlyRequestPlan(weather[0].latitude,weather[0].longitude,baseLocalDate).map(plan=>{
    const url=new URL(plan.url);url.searchParams.set('latitude',weather.map(p=>p.latitude).join(','));
    url.searchParams.set('longitude',weather.map(p=>p.longitude).join(','));
    const key=`research-only-koroska-v1:${digest(url.toString())}`;
    return {endpoint:plan.endpoint,key,url:url.toString()};
  });
  const get=()=>Promise.allSettled(requests.map(request=>cachedFetch<UtcHourlyWeather | UtcHourlyWeather[]>(database,request.key,request.url,true,18000,stage=>{
    if(stage==='start' && ++realHttpRequests>2)throw new Error('Research hard cap: two HTTP requests');
    timings.push({endpoint:request.endpoint,stage,elapsedMs:performance.now()-started});
  })));
  const sources=await get(), received=performance.now(), before=realHttpRequests;
  if(sources.every(source=>source.status==='fulfilled'))await get();
  const warmMs=sources.every(source=>source.status==='fulfilled')?performance.now()-received:null;
  if(realHttpRequests!==before)throw new Error('Warm acquisition unexpectedly requested weather again');
  const batch:FrozenBatch={baseLocalDate,evidence:'frozen-public-weather',sourceContract:'captured-open-meteo-utc-hourly-v1',
    locations:weather.map((definition,index)=>({definition,sources:sources.map(source=>{
      if(source.status==='rejected')return {status:'rejected' as const,reason:String(source.reason)};
      const list=Array.isArray(source.value.data)?source.value.data:[source.value.data];
      const numbered=list.filter(row=>row.location_id===index), unnumbered=list.filter(row=>row.location_id==null);
      const allUnnumbered=list.length===weather.length&&unnumbered.length===list.length;
      const defaultZero=index===0&&list.length===weather.length&&unnumbered.length===1
        && list.filter(row=>row.location_id!=null).length===weather.length-1
        && new Set(list.flatMap(row=>row.location_id==null?[]:[row.location_id])).size===weather.length-1
        && list.every(row=>row.location_id==null||(Number.isInteger(row.location_id)&&row.location_id>0&&row.location_id<weather.length));
      const data=numbered.length===1?numbered[0]:allUnnumbered?list[index]:defaultZero?unnumbered[0]:undefined;
      return data?{status:'fulfilled' as const,value:{...source.value,data}}:{status:'rejected' as const,reason:'Ambiguous public batch location identity'};
    })}))};
  return {batch,metrics:{realHttpRequests,warmAdditionalRequests:realHttpRequests-before,warmMs,
    coldAcquisitionIncludingDecodeMs:received-started,timings,
    decodedBytesByEndpoint:sources.map(source=>source.status==='fulfilled'?Buffer.byteLength(JSON.stringify(source.value.data)):0),
    returnedLocations:sources.map(source=>source.status==='fulfilled'?(Array.isArray(source.value.data)?source.value.data:[source.value.data]).map(row=>{
      const metadata=row as UtcHourlyWeather & {latitude?:number;longitude?:number;elevation?:number};
      return {latitude:metadata.latitude,longitude:metadata.longitude,elevation:metadata.elevation};}):[])}};
}
