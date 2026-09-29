import { searchLocations } from '../src/services/weather';
import { isRegionalPoint } from '../src/domain/heatmap/regional';

async function main() {
  for (const query of ['Črna na Koroškem','Slovenj Gradec','Velenje','Maribor','Celje']) {
    const results = await searchLocations(query);
    const place = results.find(p => p.country === 'Slovenija' || p.country === 'Slovenia');
    if (!place) throw new Error(`No Slovenian result: ${query}`);
    console.log(JSON.stringify({ query, name:place.name, latitude:place.latitude, longitude:place.longitude,
      inside:isRegionalPoint([place.longitude,place.latitude]) }));
  }
}
void main().catch(error => { console.error(error); throw error; });
