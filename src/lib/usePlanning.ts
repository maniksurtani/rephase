import { useEffect, useState } from 'react';
import type { Plan, Preferences, Trip } from './types';
import type { PlannerResponse } from './planner-worker';

/** A fresh worker cancels obsolete searches and keeps itinerary editing responsive. */
export function usePlanning(trip:Trip|null,preferences:Preferences) {
  const [result,setResult]=useState<{plan:Plan|null;error:string|null;loading:boolean}>({plan:null,error:null,loading:Boolean(trip)});
  // Lounge membership changes do not alter circadian inputs or restart a model run.
  const { loungeMemberships: _memberships, loungePriority: _priority, ...planningInputs } = preferences;
  const planningKey = JSON.stringify(planningInputs);
  useEffect(()=> {
    const planningPreferences: Preferences = JSON.parse(planningKey);
    if(!trip){setResult({plan:null,error:null,loading:false});return;}
    setResult({plan:null,error:null,loading:true});
    let ended=false;
    const id=crypto.randomUUID();
    let worker:Worker|undefined;
    try {
      worker=new Worker(new URL('./planner-worker.ts',import.meta.url),{type:'module'});
      worker.onmessage=(event:MessageEvent<PlannerResponse>)=> {
        if(ended || event.data.id!==id)return;
        setResult('plan' in event.data?{plan:event.data.plan,error:null,loading:false}:{plan:null,error:event.data.error,loading:false});
      };
      worker.onerror=()=> {if(!ended)setResult({plan:null,error:'Planning could not finish. Reload the app and review your itinerary.',loading:false});};
      worker.postMessage({id,trip,preferences:planningPreferences,now:Date.now()});
    } catch {
      void import('./plan').then(({generatePlan})=> {
        if(ended)return;
        try {setResult({plan:generatePlan(trip,planningPreferences),error:null,loading:false});}
        catch(error){setResult({plan:null,error:error instanceof Error?error.message:'Planning failed.',loading:false});}
      });
    }
    return()=>{ended=true;worker?.terminate();};
  },[trip,planningKey]);
  return result;
}
