/** Explicitly opt-in. Four public HTTP requests maximum, no paid credentials or private SQLite. */
import { readFileSync,writeFileSync } from 'node:fs';
import { captureContracts } from './koroskaContractCapture';
if(!process.argv.includes('--live'))throw new Error('Use --live to authorize a new <=4-request capture');
void captureContracts(JSON.parse(readFileSync('docs/research/koroska-regional-week-v1.sources.json','utf8'))).then(capture=>{
  writeFileSync('docs/research/koroska-contract-validation-v1.capture.json',JSON.stringify(capture)+'\n');
  console.log(JSON.stringify({baseLocalDate:capture.baseLocalDate,measurement:capture.measurement,legacyOutcome:capture.legacyOutcome},null,2));
}).catch(error=>{console.error(error);process.exitCode=1;});
