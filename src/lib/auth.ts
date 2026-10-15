import type { Account, AppData, FlightLookupResult } from './types';
import { isAppData } from './store';

export interface AuthConfig { googleClientId: string | null; syncAvailable: boolean; flightLookupAvailable?: boolean; flightProvider?: 'aerodatabox' }
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const signal=options?.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(18000)]) : AbortSignal.timeout(18000);
  const response = await fetch(path, { credentials:'same-origin', ...options, signal,
    headers: { ...(options?.body ? {'Content-Type':'application/json'} : {}), ...options?.headers } });
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new ApiError('Account services are unavailable. Check your connection and try again.',response.status); }
  if (!response.ok) throw new ApiError((payload as {error?:string})?.error ?? 'The request could not be completed.',response.status);
  return payload as T;
}
export async function getConfig(): Promise<AuthConfig> {
  try { return await api<AuthConfig>('/api/config'); } catch { return {googleClientId:null,syncAvailable:false}; }
}
export async function getAccount(): Promise<Account | null> {
  try { return await api<Account>('/api/me'); } catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error; }
}
export async function getCloudState(accountId:string): Promise<{data:AppData|null;revision:number}> {
  const result = await api<{data:unknown;revision:number}>('/api/state',{headers:{'X-Rephase-Account':accountId}});
  if (result.data !== null && !isAppData(result.data)) throw new Error('Cloud data has an unsupported format. The local copy has been preserved.');
  return result as {data:AppData|null;revision:number};
}
export const putCloudState = (data:AppData,revision:number,accountId:string) => api<{revision:number}>('/api/state',{method:'PUT',headers:{'X-Rephase-Account':accountId},body:JSON.stringify({data,revision})});
export const deleteCloudState = (accountId:string) => api<{revision:number}>('/api/state',{method:'DELETE',headers:{'X-Rephase-Account':accountId}});
export const logout = () => api('/api/auth/logout',{method:'POST'});
export function lookupFlight(accountId:string,flightNumber:string,date:string,departureAirport?:string,signal?:AbortSignal) {
  const query=new URLSearchParams({flightNumber,date});
  if(departureAirport)query.set('departureAirport',departureAirport);
  return api<FlightLookupResult>(`/api/flights?${query}`,{headers:{'X-Rephase-Account':accountId},signal});
}

interface GoogleResponse { credential:string }
interface GoogleApi {
  accounts: { id: {
    initialize: (options:{client_id:string;nonce:string;callback:(response:GoogleResponse)=>void;auto_select:boolean;ux_mode:'popup';use_fedcm_for_button:boolean;button_auto_select:boolean})=>void;
    renderButton: (container:HTMLElement,options:{type:'standard'|'icon';theme:string;size:string;shape:string;text:string;width?:string;click_listener:()=>void})=>void;
    disableAutoSelect: ()=>void;
  } };
}
declare global { interface Window { google?:GoogleApi } }
let googlePromise: Promise<void> | null = null;
async function loadGoogle() {
  if (window.google) return;
  if (!googlePromise) googlePromise = new Promise<void>((resolve,reject) => {
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client';
    const failed=()=> {clearTimeout(timer);googlePromise=null;script.remove();reject(new Error('Google sign-in could not load. Check your internet connection and try again.'));};
    const timer=setTimeout(failed,15000);
    script.async = true; script.onload = () => {if (!window.google) {failed();return;}clearTimeout(timer);resolve();};
    script.onerror = failed;
    document.head.append(script);
  });
  await googlePromise;
}
type GoogleButton = { clientId:string; compact:boolean; onSuccess:(account:Account)=>void; onError:(error:Error)=>void };
const googleButtons = new Map<HTMLElement,GoogleButton>();
let googleSetup:Promise<void>|null = null;
let googleClient:string|null = null;
let googlePreparedAt = 0;
let googleRefresh:number|undefined;
let googleExchange = false;
let googlePopupUntil = 0;

function renderGoogleButton(container:HTMLElement, button:GoogleButton) {
  if (!container.isConnected || googleButtons.get(container)!==button) return;
  container.replaceChildren();
  const width=Math.max(120,Math.min(280,Math.floor(container.getBoundingClientRect().width)||280));
  const compact=button.compact || width<160;
  window.google?.accounts.id.renderButton(container,{
    type:compact?'icon':'standard',theme:'filled_black',size:'large',
    shape:compact?'circle':'pill',text:'signin',...(compact?{}:{width:String(width)}),
    click_listener:()=> {googlePopupUntil=googlePreparedAt+4*60_000+45_000;},
  });
}
function activeGoogleButton() {
  return [...googleButtons].find(([container])=>container.isConnected)?.[1];
}
function getGoogleChallenge() {
  const request=()=>api<{nonce:string}>('/api/auth/challenge');
  // Serialize first-time setup across tabs so they observe the same browser
  // cookie. The server renews an unconsumed challenge without rotating its nonce.
  return typeof navigator!=='undefined' && navigator.locks?.request
    ? navigator.locks.request('rephase-google-challenge',request) : request();
}
function scheduleGoogleRefresh(delay=4*60_000) {
  window.clearTimeout(googleRefresh);
  if (!googleButtons.size) return;
  googleRefresh=window.setTimeout(()=> {
    // Keep the same nonce while Google's window is returning its credential.
    // A canceled popup has no callback; the deadline stays within the nonce lifetime.
    if (document.visibilityState==='hidden' || googleExchange || Date.now()<googlePopupUntil) {
      scheduleGoogleRefresh(30_000);return;
    }
    void prepareGoogleSignIn(true).catch(error=>activeGoogleButton()?.onError(error as Error));
  },delay);
}
async function prepareGoogleSignIn(force=false):Promise<void> {
  if (googleSetup) return googleSetup;
  const button=activeGoogleButton();
  if (!button) return;
  if (googleClient===button.clientId && (googleExchange || Date.now()<googlePopupUntil)) return;
  if (!force && googleClient===button.clientId && Date.now()-googlePreparedAt<4*60_000) return;
  googleSetup=(async()=> {
    const preparedAt=Date.now();
    const [{nonce}]=await Promise.all([getGoogleChallenge(),loadGoogle()]);
    if (!googleButtons.size) return;
    const identity=window.google?.accounts.id;
    if (!identity) throw new Error('Google sign-in is unavailable.');
    googleClient=button.clientId;googlePreparedAt=preparedAt;
    identity.initialize({client_id:button.clientId,nonce,auto_select:false,ux_mode:'popup',use_fedcm_for_button:true,button_auto_select:false,callback:response=> {
      if (googleExchange || !activeGoogleButton()) return;
      googleExchange=true;googlePopupUntil=0;
      void api<Account>('/api/auth/google',{method:'POST',body:JSON.stringify({credential:response.credential})})
        .then(account=>activeGoogleButton()?.onSuccess(account))
        .catch(error=>activeGoogleButton()?.onError(error as Error))
        .finally(()=> {
          googleExchange=false;googlePreparedAt=0;
          // The server consumes the nonce. Any remaining sign-in buttons need a new one.
          if (activeGoogleButton()) void prepareGoogleSignIn(true).catch(error=>activeGoogleButton()?.onError(error as Error));
        });
    }});
    for (const [container, mounted] of googleButtons) renderGoogleButton(container,mounted);
    scheduleGoogleRefresh();
  })().finally(()=> {googleSetup=null;});
  return googleSetup;
}
function refreshGoogleOnFocus() {
  if (document.visibilityState!=='hidden' && !googleExchange && Date.now()>=googlePopupUntil && Date.now()-googlePreparedAt>=3*60_000) {
    void prepareGoogleSignIn(true).catch(error=>activeGoogleButton()?.onError(error as Error));
  }
}

/** Render Google's own button so a click opens Google directly, without an app dialog. */
export async function mountGoogleButton(container:HTMLElement,clientId:string,onSuccess:(account:Account)=>void,onError:(error:Error)=>void,options:{compact?:boolean}={}):Promise<()=>void> {
  const button={clientId,onSuccess,onError,compact:options.compact??false};
  let observer:ResizeObserver|undefined;
  googleButtons.set(container,button);
  if (googleButtons.size===1) {
    window.addEventListener('focus',refreshGoogleOnFocus);
    document.addEventListener('visibilitychange',refreshGoogleOnFocus);
  }
  const dispose=()=> {
    observer?.disconnect();
    if (googleButtons.get(container)!==button) return;
    googleButtons.delete(container);container.replaceChildren();
    if (!googleButtons.size) {
      window.clearTimeout(googleRefresh);
      window.removeEventListener('focus',refreshGoogleOnFocus);
      document.removeEventListener('visibilitychange',refreshGoogleOnFocus);
      window.google?.accounts.id.disableAutoSelect();
      googleClient=null;googlePreparedAt=0;googlePopupUntil=0;
    }
  };
  try {
    await prepareGoogleSignIn();
    if (googleButtons.get(container)===button && !container.childElementCount) renderGoogleButton(container,button);
    if (googleButtons.get(container)===button && typeof ResizeObserver!=='undefined') {
      let previousWidth=container.getBoundingClientRect().width;
      observer=new ResizeObserver(()=> {
        const width=container.getBoundingClientRect().width;
        if (Math.abs(width-previousWidth)<1 || googleExchange || Date.now()<googlePopupUntil) return;
        previousWidth=width;renderGoogleButton(container,button);
      });
      observer.observe(container);
    }
  } catch(error) {dispose();throw error;}
  return dispose;
}
