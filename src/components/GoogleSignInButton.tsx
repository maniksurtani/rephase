import { useEffect, useRef, useState } from 'react';
import { mountGoogleButton } from '../lib/auth';
import type { Account } from '../lib/types';

/** Google's supported button opens its account window directly from the user's click. */
export function GoogleSignInButton({clientId,onSuccess,onError,compact=false}:{clientId:string;onSuccess:(account:Account)=>void;onError:(error:Error)=>void;compact?:boolean}) {
  const container=useRef<HTMLDivElement>(null);
  const callbacks=useRef({onSuccess,onError});
  callbacks.current={onSuccess,onError};
  const [state,setState]=useState<'loading'|'ready'|'error'>('loading');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=> {
    let dispose:(()=>void)|undefined,ended=false;
    setState('loading');
    if (container.current) void mountGoogleButton(container.current,clientId,
      account=>callbacks.current.onSuccess(account),error=>callbacks.current.onError(error),{compact})
      .then(cleanup=> {if (ended) cleanup();else {dispose=cleanup;setState('ready');}})
      .catch(error=> {if (!ended) {setState('error');callbacks.current.onError(error as Error);}});
    return ()=> {ended=true;dispose?.();};
  },[clientId,compact,attempt]);
  return <div className={`google-sign-in${compact?' compact':''}`}>
    <div ref={container} aria-label="Sign in with Google"/>
    {state==='loading' && <span className="google-loading" role="status">{compact?'…':'Loading Google sign-in…'}</span>}
    {state==='error' && <button type="button" className="text-button" aria-label="Retry Google sign-in" onClick={()=>setAttempt(value=>value+1)}>{compact?'Retry':'Retry Google sign-in'}</button>}
  </div>;
}
