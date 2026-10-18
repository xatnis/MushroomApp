/** Authentic daily-vs-hourly research analysis. No production imports point back to this file. */
import { performance } from 'node:perf_hooks';
import { buildPrototype, digest, distribution, PROFILES, selectPilot } from './koroskaRegionalPrototype';
import { providerRow, replayDaily, type ContractCapture } from './koroskaContractCapture';
import { assessHeatmapWeather, buildHeatmapWeatherSummary } from '../../src/domain/heatmap/assessment';
import { habitatStateFor } from '../../src/domain/heatmap/pilot';
import { SEVEN_DAY_REQUIREMENTS } from '../../src/domain/sevenDayConditions';
import { calculateMushroomWeatherScore } from '../../src/domain/mushroomWeather';
import { civilDailyPeriod, providerDailyPeriod, providerInstant, sampleNativeSoil, type NativeSoilResponse } from '../../src/domain/soilSampling';
import { shiftLocalDate } from '../../src/services/weather';
import { HOURLY_INTERVAL_CONTRACT, indexHourlySource } from '../../src/domain/weatherIntervals';
import type { MushroomWeatherSummary } from '../../src/domain/types';

const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const n=(value:unknown)=>finite(value)?value:null;
export function variablePair(legacy:unknown,hourly:unknown,unit:string) {
  const a=n(legacy),b=n(hourly),delta=a!=null&&b!=null?b-a:null;
  return {legacy:a,hourly:b,unit,delta,exact:a!=null&&b!=null?a===b:null,
    arithmeticNearEqual:delta!=null?Math.abs(delta)<=1e-9:null}; // Diagnostic only, never a score/parity override.
}
type Pair=ReturnType<typeof variablePair>;
export function scoreStats(rows:Array<{legacyScore:number|null;hourlyScore:number|null;categoryChanged:boolean|null;delta:number|null}>) {
  const ds=rows.flatMap(r=>r.delta==null?[]:[r.delta]);
  return {cases:rows.length,comparable:ds.length,unchanged:ds.filter(d=>d===0).length,changed:ds.filter(d=>d!==0).length,
    legacyNumeric:rows.filter(r=>r.legacyScore!=null).length,hourlyNumeric:rows.filter(r=>r.hourlyScore!=null).length,
    availabilityChanges:rows.filter(r=>(r.legacyScore==null)!==(r.hourlyScore==null)).length,
    categoryChanges:rows.filter(r=>r.categoryChanged===true&&r.delta!=null).length,absoluteDelta:distribution(ds.map(Math.abs)),signedDelta:distribution(ds),
    histogram:Object.fromEntries([...new Set(ds)].sort((a,b)=>a-b).map(d=>[d,ds.filter(v=>v===d).length]))};
}
const metricUnits:Record<string,string>={rain7dMm:'mm',rain14dMm:'mm',rain26dMm:'mm',rain30dMm:'mm',rain60dMm:'mm',
  avgTemp14dC:'°C',avgTemp20dC:'°C',evapotranspiration7dMm:'mm'};
function recordFor(c:ContractCapture,path:'daily'|'hourly',endpoint:'archive'|'forecast') {return c.records.find(r=>r.path===path&&r.endpoint===endpoint);}
function metadata(c:ContractCapture,path:'daily'|'hourly',endpoint:'archive'|'forecast',index:number) {
  const record=recordFor(c,path,endpoint),row=providerRow(record?.payload,index,selectPilot().weather.length);
  const url=record?new URL(record.url):undefined;
  return {endpoint:url?url.origin+url.pathname:null,requestParameters:url?Object.fromEntries(url.searchParams):null,
    requestedCoordinates:selectPilot().weather[index],returnedCoordinates:row?{latitude:row.latitude,longitude:row.longitude,elevation:row.elevation}:null,
    timezone:row?.timezone??null,offsetSeconds:row?.utc_offset_seconds??null,units:{daily:row?.daily_units??null,hourly:row?.hourly_units??null,current:row?.current_units??null},
    providerCurrent:row?.current??null,firstDaily:row?.daily?.time?.[0]??null,lastDaily:row?.daily?.time?.at(-1)??null,
    firstHourly:row?.hourly?.time?.[0]??null,lastHourly:row?.hourly?.time?.at(-1)??null,
    retrievedAt:record?.fetchedAt??null,decodedAt:record?.decodedAt??null,httpDate:record?.headers?.date??null,
    requestedModel:url?.searchParams.get('models')??null,returnedModelId:row?.model??row?.model_id??null,
    verifiedModelRunTime:null,payloadDigest:record?.payloadDigest??null,validBatchIdentity:!!row};
}
function sumHourly(indexed:ReturnType<typeof indexHourlySource>,date:string,variable:'precipitation'|'et0_fao_evapotranspiration',startStamped:boolean) {
  const p=civilDailyPeriod(date),start=Date.parse(p.startUtc!),end=Date.parse(p.endUtc!),xs:number[]=[];
  for(let t=start+(startStamped?0:3600000);t<(startStamped?end:end+3600000);t+=3600000) {
    const match=indexed.indices.get(t);if(match?.length!==1)return null;
    const value=indexed.source.data.hourly?.[variable]?.[match[0]];if(!finite(value)||value<0)return null;xs.push(value);
  }
  return xs.length===(end-start)/3600000?xs.reduce((a,b)=>a+b,0):null;
}
export async function validateContracts(capture:ContractCapture,options:{controlLabel?:string}={}) {
  if(capture.schema!=='koroska-authentic-contract-capture-v1'||capture.evidence!=='authentic-provider-responses'
    ||capture.hourlyBatch.baseLocalDate!==capture.baseLocalDate||capture.hourlyBatch.evidence!=='frozen-public-weather')throw new Error('Not an authentic matched-date capture');
  const pilot=selectPilot(),start=performance.now(),dailyStart=performance.now();
  if(capture.records.length>4||new Set(capture.records.map(r=>`${r.path}:${r.endpoint}`)).size!==capture.records.length)throw new Error('Duplicated/unbounded captured products');
  for(const record of capture.records){const url=new URL(record.url);
    if(url.searchParams.get('latitude')!==pilot.weather.map(p=>p.latitude).join(',')||url.searchParams.get('longitude')!==pilot.weather.map(p=>p.longitude).join(','))throw new Error('Captured request coordinate mismatch');
    if(record.payloadDigest&&digest(record.payload)!==record.payloadDigest)throw new Error('Authentic payload integrity mismatch');
    if(record.path==='hourly'&&record.httpStatus===200&&!record.error)for(const [index,row] of capture.hourlyBatch.locations.entries()){
      const source=row.sources[record.endpoint==='archive'?0:1],raw=providerRow(record.payload,index,pilot.weather.length);
      if(source.status==='fulfilled'&&(!raw||digest(source.value.data)!==digest(raw)||source.value.fetchedAt!==record.fetchedAt))throw new Error('Hourly adapter input differs from authentic captured product');
    }
  }
  const legacy=await replayDaily(capture),legacyReplayMs=performance.now()-dailyStart;
  const built=await buildPrototype(capture.hourlyBatch,'unchanged-production-scorers; input-only comparison');
  const weatherDates=pilot.weather.flatMap((definition,weatherIndex)=>Array.from({length:2},(_,day)=>{
    const source=legacy.batch?.cells[definition.id],snapshot=built.snapshots[weatherIndex],target=built.data.dates[day];
    if(source&&(source.latitude!==definition.latitude||source.longitude!==definition.longitude||source.baseLocalDate!==capture.baseLocalDate))throw new Error('Legacy point/date mismatch');
    const summary=source?buildHeatmapWeatherSummary(source,day?'tomorrow':'today').summary:undefined;
    const input=built.data.inputs[weatherIndex*7+day],forecastRecord=recordFor(capture,'daily','forecast');
    const forecast=providerRow(forecastRecord?.payload,weatherIndex,pilot.weather.length);
    const archive=providerRow(recordFor(capture,'daily','archive')?.payload,weatherIndex,pilot.weather.length);
    const identityVerified=!!forecast&&!!archive;
    const unitsVerified=[archive,forecast].every(row=>row?.daily_units?.precipitation_sum==='mm'&&row?.daily_units?.temperature_2m_mean==='°C'
      &&row?.daily_units?.et0_fao_evapotranspiration==='mm')&&forecast?.hourly_units?.soil_moisture_0_to_7cm==='m³/m³'&&forecast?.hourly_units?.soil_moisture_7_to_28cm==='m³/m³';
    const oldSoil=day?source?.tomorrowMorningSoil:source?.currentSoil;
    const oldInstant=oldSoil?providerInstant(oldSoil.time,forecast?.utc_offset_seconds):undefined;
    const sameSource=sampleNativeSoil(forecast as NativeSoilResponse,target,day?{kind:'morning'}:{kind:'current',providerReference:forecast?.current?.time??''},forecastRecord?.fetchedAt??null);
    const variables=Object.fromEntries(Object.entries(metricUnits).map(([key,unit])=>[key,variablePair(
      (summary?.historical as Record<string,unknown>|undefined)?.[key],(input.historical as Record<string,unknown>|undefined)?.[key],unit)]));
    const rain=variables.rain7dMm,et=variables.evapotranspiration7dMm;
    variables.dryingDeficitMm=variablePair(rain.legacy!=null&&et.legacy!=null?Math.max(et.legacy-rain.legacy,0):null,
      rain.hourly!=null&&et.hourly!=null?Math.max(et.hourly-rain.hourly,0):null,'mm');
    variables.soil0To7=variablePair(oldSoil?.soilMoisture0To7Cm,input.soil?.soilMoisture0To7Cm,'m³/m³');
    variables.soil7To28=variablePair(oldSoil?.soilMoisture7To28Cm,input.soil?.soilMoisture7To28Cm,'m³/m³');
    return {weatherIndex,weatherId:definition.id,targetLocalDate:target,variables,identityVerified,unitsVerified,
      soil:{legacy:oldSoil??null,hourly:input.soil??null,legacyInstantUtc:oldInstant==null?null:new Date(oldInstant).toISOString(),
        hourlyMetadata:input.soilSampling??null,instantEqual:oldInstant!=null&&input.soilSampling?oldInstant===Date.parse(input.soilSampling.instantUtc):null,
        legacySelectedArrayIndex:oldSoil?forecast?.hourly?.time?.indexOf(oldSoil.time)??null:null,
        legacyRawUnits:forecast?.hourly_units??null,sameDailySourceCanonicalSample:sameSource},
      sourceMetadata:{dailyForecast:metadata(capture,'daily','forecast',weatherIndex),hourlyForecast:metadata(capture,'hourly','forecast',weatherIndex)},
      sourceSummary:summary,snapshotInput:built.results[weatherIndex][day].inputs};
  }));
  let controlScorerCalls=0;
  const cases=pilot.weather.flatMap((definition,weatherIndex)=>PROFILES.flatMap((profile,profileIndex)=>Array.from({length:2},(_,day)=>{
    const source=legacy.batch?.cells[definition.id],actual=source?assessHeatmapWeather(source,profile,day?'tomorrow':'today'):undefined;
    const next=built.results[weatherIndex][profileIndex*7+day],context=weatherDates[weatherIndex*2+day];
    const oldScore=actual?.dataQuality==='insufficient'?null:n(actual?.score.score),newScore=next.score;
    const required=SEVEN_DAY_REQUIREMENTS[profile],keys=[...new Set([...required.rain.map(d=>`rain${d}dMm`),`avgTemp${required.temperature}dC`,'rain7dMm','evapotranspiration7dMm','soil0To7','soil7To28'])];
    const pairs=keys.map(key=>context.variables[key]);
    const identityAndUnitsComparable=context.identityVerified&&context.unitsVerified;
    const equivalentRequiredCoverage=pairs.every(p=>p?.legacy!=null&&p?.hourly!=null);
    const full=actual?.dataQuality==='complete'&&newScore!=null&&identityAndUnitsComparable&&equivalentRequiredCoverage;
    const replaceSoil=(summary:MushroomWeatherSummary,soil:typeof next.targetSoil)=>({...summary,current:{...summary.current,
      time:soil?.time,soilMoisture0To7Cm:soil?.soilMoisture0To7Cm,soilMoisture7To28Cm:soil?.soilMoisture7To28Cm}});
    const historyOnly=full?calculateMushroomWeatherScore({...actual.summary,historical:next.inputs.historical},profile):undefined;
    const policyOnly=full&&context.soil.sameDailySourceCanonicalSample.missing.length===0
      ?calculateMushroomWeatherScore(replaceSoil(actual.summary,context.soil.sameDailySourceCanonicalSample.point),profile):undefined;
    if(historyOnly)controlScorerCalls++;if(policyOnly)controlScorerCalls++;
    const factors=[...new Set([...(actual?.score.components??[]).map(c=>c.key),...next.canonical.components.map(c=>c.key)])].map(key=>{
      const a=actual?.score.components.find(c=>c.key===key),b=next.canonical.components.find(c=>c.key===key),h=historyOnly?.components.find(c=>c.key===key),p=policyOnly?.components.find(c=>c.key===key);
      return {key,legacy:a??null,hourly:b??null,delta:a&&b?b.weightedPoints-a.weightedPoints:null,
        historicalInputDelta:a&&h?h.weightedPoints-a.weightedPoints:null,
        remainingSoilProductDelta:h&&b?b.weightedPoints-h.weightedPoints:null,
        sameDailySourceSamplingPolicyDelta:a&&p?p.weightedPoints-a.weightedPoints:null};
    });
    return {weatherIndex,weatherId:definition.id,profileId:profile,targetLocalDate:next.targetLocalDate,weatherDateRef:weatherIndex*2+day,
      legacyScore:oldScore,hourlyScore:newScore,identityAndUnitsComparable,delta:identityAndUnitsComparable&&oldScore!=null&&newScore!=null?newScore-oldScore:null,
      legacyLabel:oldScore!=null?actual!.score.label:null,hourlyLabel:next.label,
      categoryChanged:oldScore!=null&&newScore!=null?actual!.score.label!==next.label:null,
      legacyQuality:actual?.dataQuality??'unavailable',hourlyStatus:next.status,hourlyMissing:next.missing,
      fullyComparable:full,equivalentRequiredCoverage,requiredInputs:keys,
      exactRawInputEquality:identityAndUnitsComparable&&pairs.every(p=>p?.exact===true)&&context.soil.instantEqual===true,
      sameValuesWithinArithmeticTolerance:pairs.every(p=>p?.arithmeticNearEqual===true),
      factors,historyOnlyScore:historyOnly?.score??null,sameDailySourcePolicyOnlyScore:policyOnly?.score??null,
      componentPointSums:{legacy:actual?.score.components.reduce((sum,c)=>sum+c.weightedPoints,0)??null,
        hourly:next.canonical.components.reduce((sum,c)=>sum+c.weightedPoints,0)},
      attribution:'Observational product comparison. History/soil replacement controls isolate formula response, not a unique weather-model cause.'};
  })));
  const candidateCases=pilot.cells.flatMap(cell=>cases.filter(c=>c.weatherId===cell.properties.weatherCellId&&habitatStateFor(cell,c.profileId)==='candidate'));
  const allCellCases=pilot.cells.flatMap(cell=>cases.filter(c=>c.weatherId===cell.properties.weatherCellId));
  const cellDiagnostics=pilot.cells.map(cell=>{
    const rows=cases.filter(c=>c.weatherId===cell.properties.weatherCellId&&habitatStateFor(cell,c.profileId)==='candidate');
    return {cellId:cell.properties.id,weatherId:cell.properties.weatherCellId,center:[cell.properties.centerLongitude,cell.properties.centerLatitude],
      habitat:PROFILES.map(p=>habitatStateFor(cell,p)),...scoreStats(rows)};
  });
  const dailyDifferences=pilot.weather.flatMap((definition,weatherIndex)=>{
    const source=legacy.batch?.cells[definition.id],snapshot=built.snapshots[weatherIndex];
    const indices=capture.hourlyBatch.locations[weatherIndex].sources.map((hourly,index)=>hourly.status==='fulfilled'
      ?indexHourlySource({...hourly.value,source:index===0?'archive':'forecast',contract:HOURLY_INTERVAL_CONTRACT}):undefined);
    return Array.from({length:61},(_,i)=>shiftLocalDate(capture.baseLocalDate,i-60)).map(date=>{
      const older=date<shiftLocalDate(capture.baseLocalDate,-7),endpoint=older?'archive':'forecast';
      const a=source?.days.find(d=>d.date===date),b=snapshot.daily.find(e=>e.day.date===date);
      const record=recordFor(capture,'daily',endpoint),raw=providerRow(record?.payload,weatherIndex,pilot.weather.length);
      const indexed=indices[older?0:1];
      const period=civilDailyPeriod(date),fixed=providerDailyPeriod(date,raw?.utc_offset_seconds);
      return {weatherId:definition.id,date,source:older?'archive':date<capture.baseLocalDate?'recentForecastHistory':'forecast',
        rain:variablePair(a?.precipitationMm,b?.day.precipitationMm,'mm'),temperature:variablePair(a?.temperatureMeanC,b?.day.temperatureMeanC,'°C'),
        et0:variablePair(a?.evapotranspirationMm,b?.day.evapotranspirationMm,'mm'),
        civilPeriod:period,providerFixedPeriod:fixed,matchingDailyBoundaries:fixed.compatible,
        hourlyCoverage:snapshot.intervalCoverage?.[date]??null,
        startStampedAlternative:indexed?{rain:sumHourly(indexed,date,'precipitation',true),et0:sumHourly(indexed,date,'et0_fao_evapotranspiration',true)}:null};
    });
  });
  const summarizeVariable=(key:string)=>{
    const pairs=weatherDates.map(row=>row.variables[key]);
    return {unit:pairs[0]?.unit??null,count:pairs.length,available:pairs.filter(p=>p.delta!=null).length,
      exact:pairs.filter(p=>p.exact).length,within1e9:pairs.filter(p=>p.arithmeticNearEqual).length,
      absoluteDelta:distribution(pairs.flatMap(p=>p.delta==null?[]:[Math.abs(p.delta)])),
      signedDelta:distribution(pairs.flatMap(p=>p.delta==null?[]:[p.delta]))};
  };
  const publicDateInputs=weatherDates.map(({sourceSummary,snapshotInput,...row})=>row);
  const lattice=(path:'daily'|'hourly',field:string,step:number)=>{
    const values=capture.records.filter(r=>r.path===path).flatMap(r=>(Array.isArray(r.payload)?r.payload:[r.payload]).flatMap((row:any)=>row?.[path]?.[field]??[])).filter(finite);
    return {values:values.length,allOnLattice:values.length>0&&values.every(v=>Math.abs(v/step-Math.round(v/step))<1e-8),step};
  };
  const report={schema:'koroska-authentic-contract-impact-v1',researchOnly:true,
    evidence:options.controlLabel?'controlled-response-mutation':'observational-authentic-products',controlLabel:options.controlLabel??null,captureId:digest(capture),
    baseLocalDate:capture.baseLocalDate,dates:built.data.dates.slice(0,2),profiles:PROFILES,geometryFingerprint:built.data.geometryFingerprint,
    assessmentAsOf:capture.completedAt,validAtCaptureOnly:true,snapshotValidity:built.data.snapshotValidity,
    contracts:{legacy:legacy.batch?.policyVersion??'pilot-weather-v1',experimental:built.data.inputVersion,formulasUnchanged:true},
    comparability:{requestedCoordinatesEqual:true,targetDatesEqual:true,profileAndFormulaEqual:true,providerRunEqualityVerified:false,
      reason:'No verified model/run identifiers returned; best-match policy implicit. Retrieval simultaneity and matching grids are not model-vintage proof.'},
    legacyReplay:{error:legacy.error,httpRequests:legacy.httpRequests},
    metadata:pilot.weather.map((definition,index)=>({weatherId:definition.id,dailyArchive:metadata(capture,'daily','archive',index),
      hourlyArchive:metadata(capture,'hourly','archive',index),dailyForecast:metadata(capture,'daily','forecast',index),hourlyForecast:metadata(capture,'hourly','forecast',index)})),
    weatherScoreImpact:scoreStats(cases),candidateCellImpact:scoreStats(candidateCases),allCellWeatherImpact:scoreStats(allCellCases),
    rawInputEquality:cases.filter(c=>c.exactRawInputEquality).length,fullQualityCases:cases.filter(c=>c.fullyComparable).length,
    soilInstantEquality:weatherDates.filter(r=>r.soil.instantEqual===true).length,
    variableSummary:Object.fromEntries(Object.keys(weatherDates[0].variables).map(key=>[key,summarizeVariable(key)])),
    factorSummary:Object.fromEntries([...new Set(cases.flatMap(c=>c.factors.map(f=>f.key)))].map(key=>{
      const fs=cases.flatMap(c=>c.factors.filter(f=>f.key===key));return [key,{cases:fs.length,
        rawChanged:fs.filter(f=>f.delta!=null&&f.delta!==0).length,changedBeyondArithmetic:fs.filter(f=>f.delta!=null&&Math.abs(f.delta)>1e-9).length,
        maxAbsDelta:Math.max(0,...fs.flatMap(f=>f.delta==null?[]:[Math.abs(f.delta)])),
        totalHistoricalDelta:fs.reduce((sum,f)=>sum+(f.historicalInputDelta??0),0),
        totalRemainingSoilDelta:fs.reduce((sum,f)=>sum+(f.remainingSoilProductDelta??0),0),
        maxSameSourceSamplingPolicyDelta:Math.max(0,...fs.flatMap(f=>f.sameDailySourceSamplingPolicyDelta==null?[]:[Math.abs(f.sameDailySourceSamplingPolicyDelta)]))}];})),
    byProfileDate:PROFILES.flatMap(profile=>built.data.dates.slice(0,2).map(date=>({profile,date,weather:scoreStats(cases.filter(c=>c.profileId===profile&&c.targetLocalDate===date)),
      candidateCells:scoreStats(candidateCases.filter(c=>c.profileId===profile&&c.targetLocalDate===date))}))),
    byWeather:pilot.weather.map(definition=>({definition,weather:scoreStats(cases.filter(c=>c.weatherId===definition.id)),
      candidateCells:scoreStats(candidateCases.filter(c=>c.weatherId===definition.id))})),
    dailyBoundaryMismatches:dailyDifferences.filter(row=>!row.matchingDailyBoundaries).length,
    dailyPrecisionDiagnostics:{
      note:'Secondary observational diagnostics, NOT a reconstruction of the primary daily inputs and NOT unique proof of provider model/rounding implementation.',
      days:dailyDifferences.length,
      temperatureRoundedHourlyMeanMatchesDaily:dailyDifferences.filter(r=>r.temperature.legacy!=null&&r.temperature.hourly!=null
        &&Math.abs(Math.round(r.temperature.hourly*10)/10-r.temperature.legacy)<1e-9).length,
      precipitationBeyondArithmetic:dailyDifferences.filter(r=>r.rain.delta!=null&&Math.abs(r.rain.delta)>1e-9).length,
      et0BeyondArithmetic:dailyDifferences.filter(r=>r.et0.delta!=null&&Math.abs(r.et0.delta)>1e-9).length,
      maxAbsDailyTemperature:Math.max(0,...dailyDifferences.flatMap(r=>r.temperature.delta==null?[]:[Math.abs(r.temperature.delta)])),
      maxAbsDailyEt0:Math.max(0,...dailyDifferences.flatMap(r=>r.et0.delta==null?[]:[Math.abs(r.et0.delta)]))},
    observedQuantization:{dailyTemperature:lattice('daily','temperature_2m_mean',.1),hourlyTemperature:lattice('hourly','temperature_2m',.1),
      dailyEt0:lattice('daily','et0_fao_evapotranspiration',.01),hourlyEt0:lattice('hourly','et0_fao_evapotranspiration',.01),
      interpretation:'Returned-value lattice and bounded differences are consistent with separate product quantization/aggregation. They do not prove common model runs or uniquely identify provider internals.'},
    legacyLimitedCases:cases.filter(c=>c.legacyQuality==='limited').length,
    outliers:[...cases].filter(c=>c.delta!=null).sort((a,b)=>Math.abs(b.delta!)-Math.abs(a.delta!)).slice(0,12),
    cellDiagnostics,weatherDates:publicDateInputs,cases,
    performance:{environment:`${process.platform} Node ${process.version}; NOT Android`,legacyReplayMs,experimental:built.metrics,
      controlScorerCalls,primaryLegacyScorerCalls:cases.length,totalScorerCalls:built.metrics.scoreEvaluations+cases.length+controlScorerCalls,
      wholeAnalysisMs:performance.now()-start,peakProcessRssBytes:process.resourceUsage().maxRSS*1024,
      note:'No per-cell scoring; 308 weekly weather results reused. Controls invoke the same unchanged production formula.'},
    attribution:capture.attribution};
  const geometry={type:'FeatureCollection',researchOnly:true,evidence:report.evidence,features:pilot.cells.map((cell,i)=>({...cell,
    properties:{id:cell.properties.id,weatherId:cell.properties.weatherCellId,numericChanges:cellDiagnostics[i].changed,
      maxAbsDelta:cellDiagnostics[i].absoluteDelta.max,categoryChanges:cellDiagnostics[i].categoryChanges,habitat:cellDiagnostics[i].habitat}}))};
  return {report,dailyDifferences,geometry};
}
