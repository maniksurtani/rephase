import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { createInitialData, DEFAULT_PREFERENCES } from './lib/defaults';
import { clearData, loadData, loadLastAccount, loadRevision, saveData, saveLastAccount, saveRevision } from './lib/store';
import { ApiError, deleteCloudState, getAccount, getCloudState, getConfig, logout, mountGoogleButton, putCloudState, type AuthConfig } from './lib/auth';
import type { Account, AppData } from './lib/types';
import './root.css';
import './fonts.css';

const emptyData = (): AppData => ({schemaVersion:1,preferences:{...DEFAULT_PREFERENCES},trips:[],selectedTripId:null});
const message = (error: unknown) => error instanceof Error ? error.message : 'The operation could not be completed.';
type Model = {account:Account|null;data:AppData};
type Snapshot = {data:AppData|null;revision:number};

function Dialog({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const getFocusable = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),iframe,a[href],[tabindex="0"]') ?? []);
    (getFocusable()[0] ?? panel.current)?.focus();
    const listener = (event:KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const elements = getFocusable(), first = elements[0], last = elements.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown',listener);
    return () => { document.removeEventListener('keydown',listener); previous?.focus(); };
  },[onClose]);
  return <div className="root-backdrop" onClick={onClose}><div ref={panel} tabIndex={-1} className="root-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={event=>event.stopPropagation()}><h2>{title}</h2>{children}</div></div>;
}
function GoogleDialog({clientId,onSuccess,onClose}:{clientId:string;onSuccess:(account:Account)=>void;onClose:()=>void}) {
  const container = useRef<HTMLDivElement>(null);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);
  useEffect(() => {
    let dispose: (()=>void) | undefined, ended = false;
    if (container.current) void mountGoogleButton(container.current,clientId,onSuccess,e=>setError(e.message))
      .then(cleanup=> { if (ended) cleanup(); else {dispose=cleanup;setLoading(false);} })
      .catch(e=> { if (!ended) {setError(message(e));setLoading(false);} });
    return () => {ended=true;dispose?.();};
  },[clientId,onSuccess]);
  return <Dialog title="Your rhythm, on every device" onClose={onClose}>
    <p>Sign in with Google to save your preferences and trips. You’ll choose which data to use before syncing.</p>
    {loading && <p role="status">Loading Google sign-in…</p>}
    <div ref={container} className="root-google" />
    {error && <p className="root-error" role="alert">{error}</p>}
    <button onClick={onClose}>Continue on this device</button>
  </Dialog>;
}
function Root() {
  const [model,setModel] = useState<Model|null>(null);
  const modelRef = useRef<Model|null>(null);
  const [config,setConfig] = useState<AuthConfig>({googleClientId:null,syncAvailable:false});
  const [storageError,setStorageError] = useState<string|null>(null);
  const blockedStorage = useRef(new Set<string>());
  const [syncStatus,setSyncStatus] = useState('Saved on this device');
  const revision = useRef<number|null>(null);
  const [googleOpen,setGoogleOpen] = useState(false);
  const [choice,setChoice] = useState<{guest:AppData;accountLocal:AppData|null;cloud:Snapshot}|null>(null);
  const [conflict,setConflict] = useState<Snapshot|null>(null);
  const [busy,setBusy] = useState(false);
  const operation = useRef(false);
  const beginOperation = () => {
    if(operation.current){setSyncStatus('An account operation is already in progress.');return false;}
    operation.current=true;setBusy(true);return true;
  };
  const endOperation = () => {operation.current=false;setBusy(false);};
  const closeGoogle = useCallback(()=>{setGoogleOpen(false);operation.current=false;setBusy(false);},[]);
  const closeChoice = useCallback(()=>setChoice(null),[]);
  const closeConflict = useCallback(()=>setConflict(null),[]);
  const replaceModel = useCallback((next:Model) => {modelRef.current=next;setModel(next);},[]);

  useEffect(() => {
    let active = true;
    void (async()=> {
      let guest: AppData;
      try {guest = await loadData(null) ?? createInitialData();}
      catch (error) {guest=createInitialData();blockedStorage.current.add('guest');if(active)setStorageError(message(error));}
      const settings = await getConfig();
      if (!active) return;
      setConfig(settings);
      let offlineAccount: Account|null = null;
      try {offlineAccount=await loadLastAccount();} catch { /* Device account metadata may be unavailable. */ }
      if (settings.syncAvailable) try {
        const account = await getAccount();
        if (account) {
          let local: AppData|null = null;
          try {local=await loadData(account.id);revision.current=await loadRevision(account.id);}
          catch(error) {blockedStorage.current.add(account.id);setStorageError(message(error));}
          if (!local) {
            const cloud = await getCloudState(account.id);
            local=cloud.data ?? emptyData();revision.current=cloud.revision;
            await saveRevision(account.id,cloud.revision).catch(error=>setStorageError(message(error)));
          }
          await saveLastAccount(account).catch(error=>setStorageError(message(error)));
          if(active) {replaceModel({account,data:local});setSyncStatus('Signed in · sync when you’re ready');} return;
        }
        offlineAccount=null;
        await saveLastAccount(null).catch(()=>{});
      } catch { if(active)setSyncStatus('Offline · saved on this device'); }
      if(offlineAccount) {
        try {
          const local=await loadData(offlineAccount.id);
          if(local && active) {
            revision.current=await loadRevision(offlineAccount.id);
            replaceModel({account:offlineAccount,data:local});
            setSyncStatus('Offline account copy · reconnect to verify your session and sync');return;
          }
        } catch(error){blockedStorage.current.add(offlineAccount.id);if(active)setStorageError(message(error));}
      }
      if(active)replaceModel({account:null,data:guest});
    })();
    return () => {active=false;};
  },[replaceModel]);

  useEffect(()=> {
    if (!model) return;
    const id = model.account?.id ?? 'guest';
    if (blockedStorage.current.has(id)) return;
    void saveData(model.account?.id ?? null,model.data).catch(error=>setStorageError(`Device saving failed: ${message(error)}. Your changes remain in this tab; export a backup before closing it.`));
  },[model]);

  const changeData = (data:AppData) => {
    if (!modelRef.current) return;
    replaceModel({...modelRef.current,data});
    setSyncStatus(modelRef.current.account ? 'Changes saved on this device · sync to upload' : 'Saved on this device');
  };
  const rememberRevision = async(accountId:string,value:number) => {
    if(modelRef.current?.account?.id===accountId)revision.current=value;
    try {await saveRevision(accountId,value);} catch(error) {setStorageError(message(error));}
  };
  const signedIn = useCallback((account:Account) => {
    setGoogleOpen(false);operation.current=true;setBusy(true);
    const guest=modelRef.current?.data ?? emptyData();
    void (async()=> {
      let local:AppData|null = null;
      try {local=await loadData(account.id);} catch(error) {blockedStorage.current.add(account.id);setStorageError(message(error));}
      replaceModel({account,data:local ?? emptyData()});
      await saveLastAccount(account).catch(error=>setStorageError(message(error)));
      revision.current=await loadRevision(account.id).catch(()=>null);
      try {
        const cloud=await getCloudState(account.id);
        setChoice({guest,accountLocal:local,cloud});
        setSyncStatus('Signed in · choose your starting data');
      } catch(error) {setSyncStatus(message(error));}
    })().catch(error=>setSyncStatus(message(error))).finally(()=>{operation.current=false;setBusy(false);});
  },[replaceModel]);
  const signIn = async() => {
    if (!config.googleClientId) {setSyncStatus('Google sign-in needs an OAuth client ID and the local Worker. You can keep using this device.');return;}
    if(beginOperation())setGoogleOpen(true);
  };
  const signOut = async() => {
    if(!beginOperation())return;
    try {
      await logout();
      await saveLastAccount(null).catch(error=>setStorageError(`Signed out, but device account metadata could not be cleared: ${message(error)}`));
      let guest:AppData;
      try {guest=await loadData(null) ?? createInitialData();}
      catch(error){guest=createInitialData();blockedStorage.current.add('guest');setStorageError(message(error));}
      replaceModel({account:null,data:guest});revision.current=null;setChoice(null);setConflict(null);setSyncStatus('Signed out · guest data on this device');
    } catch(error) {setSyncStatus(`Sign-out could not complete: ${message(error)}`);}finally{endOperation();}
  };
  const sync = async() => {
    const current=modelRef.current;
    if(!current?.account) return;
    if(!beginOperation())return;
    setSyncStatus('Syncing…');
    try {
      const verified=await getAccount();
      if(verified?.id!==current.account.id)throw new ApiError('Sign in again to sync this account. Its local copy is preserved.',401);
      if(revision.current === null) {
        const cloud=await getCloudState(current.account.id);
        if(cloud.data) {setConflict(cloud);setSyncStatus('Choose which copy to keep');return;}
        revision.current=cloud.revision;
      }
      const result=await putCloudState(current.data,revision.current,current.account.id);
      await rememberRevision(current.account.id,result.revision);
      if(modelRef.current?.account?.id===current.account.id)setSyncStatus(modelRef.current.data===current.data
        ? 'Synced · preferences and trips saved to your account'
        : 'Cloud saved the earlier copy · newer device edits need another sync');
    } catch(error) {
      if(error instanceof ApiError && error.status===409) {
        try {setConflict(await getCloudState(current.account.id));setSyncStatus('Another device changed your cloud copy');} catch(fetchError){setSyncStatus(message(fetchError));}
      } else setSyncStatus(`Sync failed: ${message(error)}. Local changes are preserved.`);
    } finally {endOperation();}
  };
  const deleteCloud = async() => {
    const current=modelRef.current;
    if(!current?.account || !beginOperation())return;
    try {
      const verified=await getAccount();
      if(verified?.id!==current.account.id)throw new ApiError('Sign in again to delete saved cloud data.',401);
      const result=await deleteCloudState(current.account.id);await rememberRevision(current.account.id,result.revision);setSyncStatus('Cloud data deleted · the device copy remains');
    }
    catch(error){setSyncStatus(message(error));}finally{endOperation();}
  };
  const clearLocal = async() => {
    const current=modelRef.current;if(!current)return;
    if(!beginOperation())return;
    try {
      await clearData(current.account?.id ?? null);blockedStorage.current.delete(current.account?.id ?? 'guest');
      setStorageError(null);revision.current=null;replaceModel({...current,data:emptyData()});
      setSyncStatus('Device data cleared · cloud data unchanged');
    } catch(error){setStorageError(message(error));}finally{endOperation();}
  };
  const chooseData = async(source:'cloud'|'guest'|'local') => {
    const current=modelRef.current;if(!choice || !current?.account)return;
    if(!beginOperation())return;
    try {
    const selected=source==='cloud' ? choice.cloud.data ?? emptyData() : source==='guest' ? choice.guest : choice.accountLocal ?? emptyData();
    replaceModel({...current,data:structuredClone(selected)});
    if(source!=='local')await rememberRevision(current.account.id,choice.cloud.revision);
    setChoice(null);setSyncStatus(source==='cloud'?'Cloud copy loaded on this device':'Device copy selected · sync to upload');
    }finally{endOperation();}
  };
  const resolveConflict = async(source:'cloud'|'local') => {
    const current=modelRef.current;if(!conflict || !current?.account)return;
    if(!beginOperation())return;
    if(source==='cloud') {
      replaceModel({...current,data:conflict.data ?? emptyData()});await rememberRevision(current.account.id,conflict.revision);
      setConflict(null);setSyncStatus('Cloud copy loaded on this device');endOperation();return;
    }
    try {
      const result=await putCloudState(current.data,conflict.revision,current.account.id);await rememberRevision(current.account.id,result.revision);
      setConflict(null);setSyncStatus('Synced · device copy replaced the cloud copy');
    } catch(error) {
      if(error instanceof ApiError && error.status===409) {setConflict(await getCloudState(current.account.id));setSyncStatus('Cloud changed again. Review your choice before replacing it.');}
      else setSyncStatus(message(error));
    } finally {endOperation();}
  };

  if(!model)return <div className="startup"><strong>Rephase</strong><span>Finding your rhythm…</span></div>;
  return <>
    <App data={model.data} onChange={changeData} account={model.account} authConfig={config} syncStatus={syncStatus} storageError={storageError} onSignIn={signIn} onSignOut={signOut} onSync={sync} onDeleteCloud={deleteCloud} onClearLocal={clearLocal}/>
    {googleOpen && config.googleClientId && <GoogleDialog clientId={config.googleClientId} onSuccess={signedIn} onClose={closeGoogle}/>}
    {choice && <Dialog title="Choose your starting data" onClose={closeChoice}>
      <p>Your guest data stays separate. Load your account’s cloud copy, or copy this device’s guest preferences and trips into the account. Copying guest data will replace cloud data the next time you sync.</p>
      <button className="primary" onClick={()=>void chooseData('cloud')}>{choice.cloud.data?'Use saved cloud data':'Start an empty account'}</button>
      {choice.accountLocal && <button onClick={()=>void chooseData('local')}>Keep this account’s device copy</button>}
      <button onClick={()=>void chooseData('guest')}>Copy this device’s guest data</button>
      <button onClick={closeChoice}>Decide later</button>
    </Dialog>}
    {conflict && <Dialog title="Two copies, one choice" onClose={closeConflict}>
      <p>Your cloud data changed since this device last synced. Both copies are preserved until you choose. Loading the cloud copy replaces this device’s current preferences and trips; keeping this device’s copy replaces the cloud state.</p>
      <button className="primary" disabled={busy} onClick={()=>void resolveConflict('cloud')}>Use cloud copy</button>
      <button disabled={busy} onClick={()=>void resolveConflict('local')}>Replace cloud with this device’s copy</button>
      <button disabled={busy} onClick={closeConflict}>Keep working locally</button>
    </Dialog>}
  </>;
}
createRoot(document.getElementById('root')!).render(<Root/>);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load',()=> {void navigator.serviceWorker.register('/sw.js').catch(()=> {/* App remains usable without offline cache. */});});
}
