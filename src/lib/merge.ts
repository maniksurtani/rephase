import type { AppData } from './types';
import { isAppData } from './store';
import { validateTrip } from './plan';

export interface MergeResult { data:AppData; conflicts:string[] }
const missing=Symbol('missing');
type Value=unknown|typeof missing;
function canonical(value:Value):string {
  if(value===missing)return '__missing__';
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value && typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>`${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? '__undefined__';
}
const equal=(a:Value,b:Value)=>canonical(a)===canonical(b);
const copy=(value:Value):Value=>value===missing?missing:structuredClone(value);
const record=(value:Value):value is Record<string,unknown>=>Boolean(value && value!==missing && typeof value==='object' && !Array.isArray(value));
const flightFields=['flightNumber','departureAirport','arrivalAirport','departureDateTime','arrivalDateTime','departureTimeZone','arrivalTimeZone','departureDisambiguation','arrivalDisambiguation','takeoffDateTime','landingDateTime','taxiOutMinutes','taxiInMinutes','flightSource','flightFetchedAt','providerRecordConfirmed'];
function merge(base:Value,local:Value,remote:Value,path:string,conflicts:string[]):Value {
  if(equal(local,remote))return copy(local);
  if(equal(base,local))return copy(remote);
  if(equal(base,remote))return copy(local);
  if(path.endsWith('.updatedAt') && typeof local==='string' && typeof remote==='string')return Date.parse(local)>=Date.parse(remote)?local:remote;
  if(path==='selectedTripId')return copy(local); // Selection is a device navigation choice.
  if(Array.isArray(local) && Array.isArray(remote) && Array.isArray(base)) {
    const collections=['trips','legs','adherence'];
    if(!collections.includes(path.split('.').at(-1) ?? '')){conflicts.push(path);return copy(local);}
    const key=(value:unknown)=> {
      const r=value as Record<string,unknown>;
      return path.endsWith('.adherence') ? String(r.actionId) : String(r.id);
    };
    const maps=[base,local,remote].map(values=>new Map(values.map(value=>[key(value),value])));
    const [b,l,r]=maps;
    const original=base.map(key),left=local.map(key),right=remote.map(key);
    const retained=(ids:string[])=>ids.filter(id=>b.has(id)&&l.has(id)&&r.has(id));
    const leftReordered=!equal(retained(left),retained(original));
    const rightReordered=!equal(retained(right),retained(original));
    if(leftReordered&&rightReordered&&!equal(retained(left),retained(right)))conflicts.push(`${path}.order`);
    const order=rightReordered&&!leftReordered?[...right]:[...left];
    // Place a new record from the other device after its nearest existing anchor.
    const other=rightReordered&&!leftReordered?left:right;
    for(let i=0;i<other.length;i++) {
      const id=other[i];if(order.includes(id))continue;
      const anchor=other.slice(0,i).reverse().find(previous=>order.includes(previous));
      order.splice(anchor===undefined?0:order.indexOf(anchor)+1,0,id);
    }
    for(const id of new Set([...original,...left,...right]))if(!order.includes(id))order.push(id);
    return order.flatMap(id=> {
      const value=merge(b.get(id)??missing,l.get(id)??missing,r.get(id)??missing,`${path}.${id}`,conflicts);
      return value===missing?[]:[value];
    });
  }
  if(record(base)&&record(local)&&record(remote)) {
    const result:Record<string,unknown>={};
    const keys=new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)]);
    // Identity/timing changes on one flight are atomic. Combining independently
    // changed airports, offsets and dates can create a flight neither user entered.
    if(path.includes('.legs.') && !path.slice(path.indexOf('.legs.')+6).includes('.')) {
      const group=(object:Record<string,unknown>)=>Object.fromEntries(flightFields.filter(key=>Object.hasOwn(object,key)).map(key=>[key,object[key]]));
      const [b,l,r]=[group(base),group(local),group(remote)];
      const flight=equal(l,r)||equal(b,r)?copy(l):equal(b,l)?copy(r):copy(l);
      if(!equal(l,r)&&!equal(b,l)&&!equal(b,r))conflicts.push(`${path}.flightDetails`);
      if(record(flight))Object.assign(result,flight);
      flightFields.forEach(key=>keys.delete(key));
    }
    for(const key of keys) {
      const value=merge(Object.hasOwn(base,key)?base[key]:missing,Object.hasOwn(local,key)?local[key]:missing,Object.hasOwn(remote,key)?remote[key]:missing,path?`${path}.${key}`:key,conflicts);
      if(value!==missing)result[key]=value;
    }
    return result;
  }
  conflicts.push(path || 'account');return copy(local);
}
export function mergeAppData(base:AppData,local:AppData,remote:AppData):MergeResult {
  const conflicts:string[]=[];
  const data=merge(base,local,remote,'',conflicts) as AppData;
  if(data.selectedTripId && !data.trips.some(trip=>trip.id===data.selectedTripId))data.selectedTripId=data.trips[0]?.id ?? null;
  if(!isAppData(data))conflicts.push('Merged data has an unsupported format');
  else for(const trip of data.trips)for(const error of validateTrip(trip))conflicts.push(`${trip.name}: ${error}`);
  return {data,conflicts:[...new Set(conflicts)]};
}
