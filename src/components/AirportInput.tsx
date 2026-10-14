import { useId, useMemo } from 'react';
import { AIRPORTS } from '../lib/airports';

export function AirportInput({value,onChange,placeholder}:{value:string;onChange:(value:string)=>void;placeholder:string}) {
  const id=useId();
  const options=useMemo(()=>AIRPORTS.filter(airport=>value?airport.code.startsWith(value.toUpperCase()):['SFO','LAX','JFK','LHR','CDG','DXB','SIN','HND','SYD'].includes(airport.code)).slice(0,30),[value]);
  return <><input list={id} value={value} onChange={event=>onChange(event.target.value)} placeholder={placeholder} maxLength={4} required autoComplete="off"/><datalist id={id}>{options.map(airport=><option key={airport.code} value={airport.code}>{airport.city} · {airport.name}</option>)}</datalist></>;
}
