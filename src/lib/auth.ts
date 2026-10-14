import type { Account, AppData } from './types';
import { isAppData } from './store';

export interface AuthConfig { googleClientId: string | null; syncAvailable: boolean }
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials:'same-origin', ...options,
    headers: { ...(options?.body ? {'Content-Type':'application/json'} : {}), ...options?.headers } });
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new ApiError('The local API is unavailable. Start the Worker to use Google sign-in and sync.',response.status); }
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

interface GoogleResponse { credential:string }
interface GoogleApi {
  accounts: { id: {
    initialize: (options:{client_id:string;nonce:string;callback:(response:GoogleResponse)=>void;auto_select:boolean;use_fedcm_for_prompt:boolean})=>void;
    renderButton: (container:HTMLElement,options:{theme:string;size:string;shape:string;text:string;width:number})=>void;
    disableAutoSelect: ()=>void;
  } };
}
declare global { interface Window { google?:GoogleApi } }
let googlePromise: Promise<void> | null = null;
async function loadGoogle() {
  if (window.google) return;
  if (!googlePromise) googlePromise = new Promise<void>((resolve,reject) => {
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client';
    script.async = true; script.onload = () => resolve();
    script.onerror = () => { googlePromise = null; script.remove(); reject(new Error('Google sign-in could not load. Check your internet connection.')); };
    document.head.append(script);
  });
  await googlePromise;
}
export async function mountGoogleButton(container: HTMLElement, clientId: string, onSuccess:(account:Account)=>void, onError:(error:Error)=>void): Promise<()=>void> {
  let cancelled = false;
  const [{nonce}] = await Promise.all([api<{nonce:string}>('/api/auth/challenge'),loadGoogle()]);
  const identity = window.google?.accounts.id;
  if (!identity) throw new Error('Google sign-in is unavailable.');
  identity.initialize({client_id:clientId,nonce,auto_select:false,use_fedcm_for_prompt:true,callback:response => {
    if (cancelled) return;
    void api<Account>('/api/auth/google',{method:'POST',body:JSON.stringify({credential:response.credential})})
      .then(account => { if (!cancelled) onSuccess(account); }).catch(error => { if (!cancelled) onError(error as Error); });
  }});
  if (container.isConnected) identity.renderButton(container,{theme:'filled_black',size:'large',shape:'pill',text:'continue_with',width:280});
  return () => { cancelled = true; identity.disableAutoSelect(); container.replaceChildren(); };
}
