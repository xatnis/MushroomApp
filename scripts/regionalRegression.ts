/// <reference types="node" />
import { deepStrictEqual, strictEqual } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { HEATMAP_HABITAT as pilot, HEATMAP_PROFILE_IDS, habitatStateFor, areaAssessmentFor } from '../src/domain/heatmap/pilot';
import { HEATMAP_HABITAT as regional, HEATMAP_PILOT_METADATA, buildHeatmapRenderCollection } from '../src/domain/heatmap/regional';
import { assessHeatmapWeather } from '../src/domain/heatmap/assessment';
import { shiftLocalDate } from '../src/services/weather';
import type { HeatmapWeatherCellSource } from '../src/domain/heatmap/types';

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';

const regionalPath = resolve('src/domain/heatmap/regional.ts');
const baseline = { exports: {} as typeof import('../src/domain/heatmap/regional') };
const original = execFileSync('git', ['show', '604313e:src/domain/heatmap/regional.ts'], { maxBuffer: 30 * 1024 * 1024 }).toString();
new Function('require', 'module', 'exports', ts.transpileModule(original, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText)(createRequire(regionalPath), baseline, baseline.exports);
for (const path of ['src/data/heatmapRegional/habitat.geojson.json', 'src/data/heatmapRegional/metadata.json',
  'src/data/heatmapRegional/coverage.geojson.json', 'src/data/heatmapRegional/zgs-enrichment.json', 'src/domain/heatmap/pilot.ts']) {
  strictEqual(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), execFileSync('git', ['show', '604313e:' + path], { maxBuffer: 30 * 1024 * 1024 }).toString().replace(/\r\n/g, '\n'), path);
}

const base = '6127609fb52602eb746e11c4afd68545e20dc14c';
for (const path of ['src/domain/mushroomWeather.ts','src/domain/heatmap/assessment.ts','src/domain/heatmap/config.ts','src/domain/heatmap/zgs.ts','src/services/weather.ts',
  'src/data/heatmapPilot/habitat.geojson.json','src/data/heatmapPilot/zgs-enrichment.json']) {
  const before = execFileSync('git',['show',`${base}:${path}`],{maxBuffer:30*1024*1024}).toString().replace(/\r\n/g,'\n');
  strictEqual(readFileSync(path,'utf8').replace(/\r\n/g,'\n'),before,path);
}
const date = '2026-09-27';
const source: HeatmapWeatherCellSource = { id:'fixture',latitude:46.47,longitude:14.85,baseLocalDate:date,
  days:Array.from({length:62},(_,i)=>({date:shiftLocalDate(date,i-60),kind:i<60?'historical':'forecast',precipitationMm:i<60?2:9,temperatureMeanC:14,evapotranspirationMm:1})),
  currentSoil:{time:date+'T12:00',soilMoisture0To7Cm:.24,soilMoisture7To28Cm:.26},
  tomorrowMorningSoil:{time:shiftLocalDate(date,1)+'T09:00',soilMoisture0To7Cm:.25,soilMoisture7To28Cm:.27},
  errors:{},fetchedAt:date+'T10:00:00Z',stale:false };
const oldById = new Map(pilot.features.map(f=>[f.properties.id,f]));
let retained=0;
for(const f of regional.features) if(oldById.has(f.properties.id)) {
  const old=oldById.get(f.properties.id)!; deepStrictEqual(f,old); retained++;
  for(const p of HEATMAP_PROFILE_IDS) strictEqual(habitatStateFor(f,p),habitatStateFor(old,p));
}
const timing: Record<string,number>={};
for(const day of ['today','tomorrow'] as const) for(const profile of HEATMAP_PROFILE_IDS) {
  const w=assessHeatmapWeather(source,profile,day);
  for(const f of pilot.features) {
    const a=areaAssessmentFor(f,w), b=areaAssessmentFor({...f,properties:{...f.properties,zgs:undefined}},w);
    strictEqual(a.score,b.score);deepStrictEqual(a.scoreDetails,b.scoreDetails);strictEqual(a.dataQuality,b.dataQuality);
  }
  const byCell=Object.fromEntries(HEATMAP_PILOT_METADATA.weatherCells.map(c=>[c.id,w]));
  const start=performance.now(); const render=buildHeatmapRenderCollection(byCell);
  timing[`${profile}/${day}`]=performance.now()-start;
  strictEqual(render.collection.features.length,regional.features.length);
  deepStrictEqual(render, baseline.exports.buildHeatmapRenderCollection(byCell), `Regional V2 identical: ${profile}/${day}`);
}
const coverage=regional.features.map(f=>f.properties.zgs?.zgsDataCoverageFraction??0).sort((a,b)=>a-b);
const counts=Object.fromEntries(HEATMAP_PROFILE_IDS.map(p=>[p,Object.fromEntries(['candidate','unknown','outside-model'].map(s=>[s,regional.features.filter(f=>habitatStateFor(f,p)===s).length]))]));
console.log(JSON.stringify({cells:regional.features.length,retained,weatherPoints:HEATMAP_PILOT_METADATA.weatherCellCount,
  wooded:regional.features.filter(f=>f.properties.treeCoverFraction>=.3).length,
  vegetation:regional.features.filter(f=>f.properties.treeCoverFraction+f.properties.grasslandFraction>=.2).length,
  averageCoverage:coverage.reduce((a,b)=>a+b,0)/coverage.length,medianCoverage:coverage[Math.floor(coverage.length/2)],
  noZgs:regional.features.filter(f=>!f.properties.zgs?.zgsAvailable).length,counts,renderMs:timing,
  regionalBaselineComparisons: regional.features.length*4*2, baselineWeatherComparisons:1961*4*2},null,2));
