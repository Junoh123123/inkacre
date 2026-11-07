import { readFileSync, writeFileSync } from 'node:fs';
import * as topojson from 'topojson-client';
// Builds ui/public/world-50m.json (the map view's base map) from Natural Earth (public domain) via the
// world-atlas npm package: land as one merged shape and the borders between countries, projected to
// Web Mercator on a 4096 square, as compact SVG path data.
// Usage: npm i --no-save world-atlas@2 topojson-client@3 && node scripts/build-world-map.mjs 50m 4096 ui/public/world-50m.json  (vite copies it to web/app/)
const [res, scaleArg, out] = process.argv.slice(2);
const S = Number(scaleArg);
const topo = JSON.parse(readFileSync(`node_modules/world-atlas/countries-${res}.json`, 'utf8'));
const land = topojson.merge(topo, topo.objects.countries.geometries);
const borders = topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
const MAXLAT = 85.05112878;
const project = ([lon, lat]) => { const phi = Math.max(-MAXLAT, Math.min(MAXLAT, lat)) * Math.PI / 180; return [Math.round((lon + 180) / 360 * S), Math.round((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2 * S)]; };
function ring(coords, close) {
  let d = '', prev = null, count = 0;
  for (const point of coords) {
    const [x, y] = project(point);
    if (!prev) { d += `M${x} ${y}`; prev = [x, y]; count++; continue; }
    const dx = x - prev[0], dy = y - prev[1];
    if (!dx && !dy) continue;
    d += `l${dx} ${dy}`; prev = [x, y]; count++;
  }
  return count > 2 || !close ? d + (close ? 'z' : '') : '';
}
const landPath = land.coordinates.flatMap(polygon => polygon.map(r => ring(r, true))).join('');
const borderPath = borders.coordinates.map(line => ring(line, false)).join('');
// Country labels: the centre of each country's largest shape (by projected area) and that area, so the
// map can show the larger names first and only where they fit.
const labels = [];
const shortNames = { 'United States of America': 'United States', 'Dem. Rep. Congo': 'DR Congo', 'Central African Rep.': 'Central African Republic', 'Bosnia and Herz.': 'Bosnia and Herzegovina', 'Dominican Rep.': 'Dominican Republic', 'S. Sudan': 'South Sudan', 'Eq. Guinea': 'Equatorial Guinea', 'W. Sahara': 'Western Sahara', 'Fr. S. Antarctic Lands': 'French Southern Lands', 'Solomon Is.': 'Solomon Islands', 'Falkland Is.': 'Falkland Islands' };
for (const geometry of topo.objects.countries.geometries) {
  const feature = topojson.feature(topo, geometry);
  const polygons = feature.geometry?.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry?.type === 'MultiPolygon' ? feature.geometry.coordinates : [];
  let best = null;
  for (const polygon of polygons) {
    const ring = polygon[0].map(project);
    let area = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length]; const cross = x1 * y2 - x2 * y1; area += cross; cx += (x1 + x2) * cross; cy += (y1 + y2) * cross; }
    area /= 2;
    if (!area) continue;
    const candidate = { x: Math.round(cx / (6 * area)), y: Math.round(cy / (6 * area)), area: Math.round(Math.abs(area)) };
    if (!best || candidate.area > best.area) best = candidate;
  }
  // Shapes cut by the 180° line give a wrong centre, and the United States label needs a fixed spot:
  // these few are placed by hand (longitude, latitude).
  const fixed = { Russia: [100, 62], Fiji: [178, -17.8], Kiribati: [-157.4, 1.9], 'United States of America': [-99.3, 37.8] }[geometry.properties?.name];
  if (best && fixed) { const [x, y] = project(fixed); best = { ...best, x, y }; }
  if (best && geometry.properties?.name) labels.push({ name: (shortNames[geometry.properties.name] ?? geometry.properties.name).toUpperCase(), ...best, x: ((best.x % S) + S) % S });
}
labels.sort((a, b) => b.area - a.area);
writeFileSync(out, JSON.stringify({ size: S, land: landPath, borders: borderPath, labels, source: `Natural Earth via world-atlas countries-${res}` }));
console.log(res, S, (landPath.length + borderPath.length) / 1024 | 0, 'KB');
