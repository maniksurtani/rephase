import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { createInitialData, DEFAULT_PREFERENCES } from './lib/defaults';
import { clearData, loadData, loadLastAccount, loadSyncPaused, loadSyncSnapshot, saveData, saveLastAccount, saveSyncPaused, saveSyncSnapshot, saveSyncState, type SyncSnapshot } from './lib/store';
import { foldInFlightEdits, hasContentChanges, reconcileSync, sameData } from './lib/sync';
import { ApiError, deleteCloudState, getAccount, getCloudState, getConfig, logout, mountGoogleButton, putCloudState, type AuthConfig } from './lib/auth';
import type { Account, AppData } from './lib/types';
import './root.css';
import './fonts.css';

const emptyData = (): AppData => ({schemaVersion:1,preferences:{...DEFAULT_PREFERENCES},trips:[],selectedTripId:null});
const message = (error: unknown) => error instanceof Error ? error.message : 'The operation could not be completed.';
type Model = {account:Account|null;data:AppData};
type Snapshot = SyncSnapshot;

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
  const editGeneration = useRef(0);
  const saveGeneration = useRef(0);
  const [config,setConfig] = useState<AuthConfig>({googleClientId:null,syncAvailable:false});
  const [storageError,setStorageError] = useState<string|null>(null);
  const blockedStorage = useRef(new Set<string>());
  const [syncStatus,setSyncStatus] = useState('Opening your device copy…');
  const baseline = useRef<Snapshot|null>(null);
  const syncPaused = useRef(false);
  const [googleOpen,setGoogleOpen] = useState(false);
  type Choice = {accountId:string;guest:AppData;accountLocal:AppData|null;cloud:Snapshot};
  type Conflict = {accountId:string;cloud:Snapshot;reasons:string[]};
  const [choice,setChoice] = useState<Choice|null>(null);
  const choiceRef = useRef<Choice|null>(null);
  const [conflict,setConflict] = useState<Conflict|null>(null);
  const conflictRef = useRef<Conflict|null>(null);
  const [busy,setBusy] = useState(false);
  const operation = useRef(false);
  const autoPending = useRef(false);
  const autoAllowedAt = useRef(0);
  const syncRef = useRef<(explicit?:boolean)=>Promise<void>>(async()=>{});
  const showChoice = (value:Choice|null) => {choiceRef.current=value;setChoice(value);};
  const showConflict = (value:Conflict|null) => {conflictRef.current=value;setConflict(value);};
  const beginOperation = () => {
    if(operation.current)return false;
    operation.current=true;setBusy(true);return true;
  };
  const endOperation = () => {
    operation.current=false;setBusy(false);
    if(autoPending.current && Date.now()>=autoAllowedAt.current) {
      autoPending.current=false;
      window.setTimeout(()=>void syncRef.current(false),1500);
    }
  };
  const closeGoogle = useCallback(()=>{setGoogleOpen(false);operation.current=false;setBusy(false);},[]);
  const closeChoice = useCallback(()=>{
    if(operation.current)return;
    choiceRef.current=null;setChoice(null);syncPaused.current=true;
    const id=modelRef.current?.account?.id;if(id)void saveSyncPaused(id,true).catch(()=>{});
  },[]);
  const closeConflict = useCallback(()=>{
    if(operation.current)return;
    conflictRef.current=null;setConflict(null);syncPaused.current=true;
    const id=modelRef.current?.account?.id;if(id)void saveSyncPaused(id,true).catch(()=>{});
  },[]);
  const replaceModel = useCallback((next:Model) => {modelRef.current=next;setModel(next);},[]);
  const storageFailure = (error:unknown) => setStorageError(`Device saving failed: ${message(error)}. Changes remain in this tab; export a backup before closing it.`);
  const loadHistory = async(accountId:string) => {
    try {
      const [snapshot,paused] = await Promise.all([loadSyncSnapshot(accountId),loadSyncPaused(accountId)]);
      return {snapshot,paused};
    } catch(error) {storageFailure(error);return {snapshot:null,paused:true};}
  };

  useEffect(() => {
    let active = true;
    void (async()=> {
      let guest:AppData;
      try {guest=await loadData(null) ?? createInitialData();}
      catch(error) {guest=createInitialData();blockedStorage.current.add('guest');if(active)storageFailure(error);}
      let cachedAccount:Account|null=null;
      try {cachedAccount=await loadLastAccount();} catch { /* Display metadata is optional. */ }
      let local:AppData|null=null;
      if(cachedAccount)try {local=await loadData(cachedAccount.id);}
      catch(error) {blockedStorage.current.add(cachedAccount.id);if(active)storageFailure(error);}
      if(cachedAccount && !local && !blockedStorage.current.has(cachedAccount.id)) {
        try {if(await loadSyncPaused(cachedAccount.id))local=emptyData();} catch { /* Preserve the guest copy if local metadata is unavailable. */ }
      }
      if(!active)return;
      // Render the saved namespace before any network request. Its cached
      // identity is display metadata and never authorizes a state request.
      if(cachedAccount && local) {
        replaceModel({account:cachedAccount,data:local});
        setSyncStatus('Device account copy · checking your session…');
        const history=await loadHistory(cachedAccount.id);
        if(!active)return;
        baseline.current=history.snapshot;syncPaused.current=history.paused;
      } else {
        replaceModel({account:null,data:guest});
        setSyncStatus('Saved on this device');
      }
      const generation=editGeneration.current;
      const settings=await getConfig();
      if(!active)return;
      setConfig(settings);
      if(!settings.syncAvailable) {setSyncStatus(modelRef.current?.account?'Offline account copy · sign in when connected':'Saved on this device');return;}
      try {
        const account=await getAccount();
        if(!active)return;
        const current=modelRef.current;
        if(!account) {setSyncStatus(current?.account?'Device account copy · sign in again to sync':'Saved on this device');return;}
        if(current?.account?.id===account.id) {
          await saveLastAccount(account).catch(storageFailure);
          if(active)setSyncStatus(syncPaused.current?'Automatic sync paused · sync explicitly or edit to resume':'Signed in · device copy ready to sync');
          return;
        }
        // A delayed response must not move edits into another account or
        // replace guest edits. Explicit Google sign-in offers that choice.
        if(current?.account || editGeneration.current!==generation) {
          setSyncStatus('Your current device copy is preserved. Sign in to choose account data.');return;
        }
        let accountData:AppData|null=null;
        try {accountData=await loadData(account.id);} catch(error) {blockedStorage.current.add(account.id);storageFailure(error);}
        const history=await loadHistory(account.id);
        let cloud:Snapshot|null=null;
        if(!accountData) {
          if(history.paused)accountData=emptyData();
          else {cloud=await getCloudState(account.id);accountData=cloud.data ?? emptyData();}
        }
        if(!active || editGeneration.current!==generation || modelRef.current?.account)return;
        baseline.current=cloud ?? history.snapshot;syncPaused.current=history.paused;
        replaceModel({account,data:accountData});
        await saveLastAccount(account).catch(storageFailure);
        if(cloud)await saveSyncSnapshot(account.id,cloud).catch(storageFailure);
        if(active)setSyncStatus(syncPaused.current?'Automatic sync paused · sync explicitly or edit to resume':'Signed in · device copy ready to sync');
      } catch(error) {if(active)setSyncStatus(`Offline · saved device copy is available. ${message(error)}`);}
    })().catch(error=>{if(active)setSyncStatus(message(error));});
    return () => {active=false;};
  },[replaceModel]);

  useEffect(()=> {
    if(!model)return;
    const id=model.account?.id ?? 'guest', ticket=++saveGeneration.current;
    if(blockedStorage.current.has(id))return;
    void saveData(model.account?.id ?? null,model.data).then(()=> {
      if(ticket!==saveGeneration.current || modelRef.current?.data!==model.data)return;
      setSyncStatus(status=>status==='Saving on this device…'
        ? model.account?syncPaused.current?'Saved on this device · automatic sync paused':'Changes saved on this device · sync to upload':'Saved on this device' : status);
    }).catch(storageFailure);
  },[model]);

  const changeData = (data:AppData) => {
    const current=modelRef.current;if(!current)return;
    editGeneration.current++;
    const changed=hasContentChanges(current.data,data);
    if(changed) {
      syncPaused.current=false;
      if(current.account)void saveSyncPaused(current.account.id,false).catch(storageFailure);
    }
    replaceModel({...current,data});
    setSyncStatus('Saving on this device…');
  };
  const signedIn = useCallback((account:Account) => {
    setGoogleOpen(false);operation.current=true;setBusy(true);
    const current=modelRef.current;
    let guest=current?.account ? null : current?.data;
    void (async()=> {
      let local:AppData|null=null;
      try {local=await loadData(account.id);} catch(error) {blockedStorage.current.add(account.id);storageFailure(error);}
      const history=await loadHistory(account.id);
      baseline.current=history.snapshot;syncPaused.current=history.paused;
      const latest=modelRef.current;
      if(latest?.account?.id===account.id)local=latest.data;
      if(!latest?.account && guest)guest=latest?.data ?? guest;
      replaceModel({account,data:local ?? emptyData()});
      await saveLastAccount(account).catch(storageFailure);
      try {
        const cloud=await getCloudState(account.id);
        showChoice({accountId:account.id,guest:guest ?? await loadData(null) ?? emptyData(),accountLocal:local,cloud});
        setSyncStatus('Signed in · choose your starting data');
      } catch(error) {setSyncStatus(`Signed in · local copy preserved. ${message(error)}`);}
    })().catch(error=>setSyncStatus(message(error))).finally(()=>{operation.current=false;setBusy(false);});
  },[replaceModel]);
  const signIn = async() => {
    if(!config.googleClientId) {setSyncStatus('Google sign-in needs an OAuth client ID and the local Worker. You can keep using this device.');return;}
    if(beginOperation())setGoogleOpen(true);
  };
  const signOut = async() => {
    if(!beginOperation())return;
    try {
      await logout();
      await saveLastAccount(null).catch(error=>setStorageError(`Signed out, but device account metadata could not be cleared: ${message(error)}`));
      let guest:AppData;
      try {guest=await loadData(null) ?? createInitialData();}
      catch(error) {guest=createInitialData();blockedStorage.current.add('guest');storageFailure(error);}
      baseline.current=null;syncPaused.current=false;showChoice(null);showConflict(null);
      replaceModel({account:null,data:guest});setSyncStatus('Signed out · guest data on this device');
    } catch(error) {setSyncStatus(`Sign-out could not complete: ${message(error)}`);}finally{endOperation();}
  };
  const sync = async(explicit=true) => {
    const current=modelRef.current;
    if(!current?.account || !config.syncAvailable)return;
    if(blockedStorage.current.has(current.account.id)) {setSyncStatus('Clear the unsupported device record before syncing. Its original contents are preserved.');return;}
    if(choiceRef.current || conflictRef.current || googleOpen)return;
    if(!explicit && (!current.data.preferences.autoSync || syncPaused.current || Date.now()<autoAllowedAt.current))return;
    if(operation.current) {if(!explicit)autoPending.current=true;return;}
    if(!beginOperation())return;
    const accountId=current.account.id;
    if(explicit) {
      syncPaused.current=false;
      await saveSyncPaused(accountId,false).catch(storageFailure);
    }
    setSyncStatus('Syncing…');
    try {
      const verified=await getAccount();
      if(verified?.id!==accountId)throw new ApiError('Sign in again to sync this account. Its local copy is preserved.',401);
      const result=await reconcileSync(current.data,baseline.current,{
        get:()=>getCloudState(accountId),put:(data,revision)=>putCloudState(data,revision,accountId),
      },explicit);
      if(modelRef.current?.account?.id!==accountId)return;
      if(result.kind==='conflict') {
        showConflict({accountId,cloud:result.cloud,reasons:result.conflicts});
        setSyncStatus('Overlapping changes need your choice');return;
      }
      if(result.kind==='deleted') {
        syncPaused.current=true;
        await saveSyncSnapshot(accountId,result.snapshot,true);baseline.current=structuredClone(result.snapshot);
        setSyncStatus('Cloud data was deleted · device copy preserved; automatic sync paused');return;
      }
      const latest=modelRef.current;
      if(!latest || latest.account?.id!==accountId)return;
      // Fold in edits made during auth/fetch/upload using the sent local
      // document as their baseline. Never replace those edits with an old PUT.
      const after=foldInFlightEdits(current.data,latest.data,result.data);
      if(after.conflicts.length) {
        showConflict({accountId,cloud:result.snapshot,reasons:after.conflicts});
        setSyncStatus('Cloud saved · newer device edits need review');return;
      }
      const accepted=sameData(after.data,latest.data)?latest.data:after.data;
      if(accepted!==latest.data)replaceModel({...latest,data:accepted});
      await saveSyncState(accountId,accepted,result.snapshot);
      baseline.current=structuredClone(result.snapshot);
      autoAllowedAt.current=0;
      const live=modelRef.current;
      if(live?.account?.id!==accountId)return;
      const changed=result.snapshot.data===null || hasContentChanges(live.data,result.snapshot.data);
      setSyncStatus(changed?'Cloud saved · newer device edits are waiting to sync':'Synced · preferences and trips saved to your account');
      if(changed && live.data.preferences.autoSync)autoPending.current=true;
    } catch(error) {
      autoAllowedAt.current=Date.now()+30_000;autoPending.current=false;
      setSyncStatus(`Sync failed: ${message(error)}. Local changes are preserved.`);
    } finally {endOperation();}
  };
  syncRef.current=sync;
  useEffect(()=> {
    if(!model?.account || !model.data.preferences.autoSync || !config.syncAvailable)return;
    const timer=window.setTimeout(()=>void syncRef.current(false),1500);
    const resume=()=>void syncRef.current(false);
    window.addEventListener('online',resume);window.addEventListener('focus',resume);
    const poll=window.setInterval(resume,5*60_000);
    return ()=>{window.clearTimeout(timer);window.clearInterval(poll);window.removeEventListener('online',resume);window.removeEventListener('focus',resume);};
  },[model?.account?.id,model?.data,config.syncAvailable]);

  const deleteCloud = async() => {
    const current=modelRef.current;if(!current?.account || !beginOperation())return;
    try {
      const verified=await getAccount();
      if(verified?.id!==current.account.id)throw new ApiError('Sign in again to delete saved cloud data.',401);
      const result=await deleteCloudState(current.account.id);
      syncPaused.current=true;autoPending.current=false;
      const snapshot={data:null,revision:result.revision};
      await saveSyncSnapshot(current.account.id,snapshot,true);baseline.current=snapshot;
      setSyncStatus('Cloud data deleted · device copy remains; automatic sync paused until you edit or sync');
    } catch(error) {setSyncStatus(message(error));}finally{endOperation();}
  };
  const clearLocal = async() => {
    const current=modelRef.current;if(!current || !beginOperation())return;
    try {
      await clearData(current.account?.id ?? null);
      blockedStorage.current.delete(current.account?.id ?? 'guest');setStorageError(null);
      baseline.current=null;syncPaused.current=true;autoPending.current=false;
      const latest=modelRef.current;
      if(latest && latest.account?.id===current.account?.id && latest.data!==current.data) {
        await saveData(current.account?.id ?? null,latest.data);
        setSyncStatus('Earlier device copy cleared · newer edits kept locally; automatic sync paused');
      } else {replaceModel({...current,data:emptyData()});setSyncStatus('Device data cleared · cloud unchanged; automatic sync paused until you edit or sync');}
    } catch(error) {storageFailure(error);}finally{endOperation();}
  };
  const chooseData = async(source:'cloud'|'guest'|'local') => {
    const current=modelRef.current,selectedChoice=choiceRef.current;
    if(!selectedChoice || current?.account?.id!==selectedChoice.accountId || !beginOperation())return;
    try {
      if(blockedStorage.current.has(selectedChoice.accountId))throw new Error('Clear the unsupported device record before selecting new saved data.');
      const selected=source==='cloud'?selectedChoice.cloud.data ?? emptyData():source==='guest'?selectedChoice.guest:current.data;
      if(source==='local')baseline.current=await loadSyncSnapshot(selectedChoice.accountId);
      const latest=modelRef.current;
      if(!latest || latest.account?.id!==selectedChoice.accountId)return;
      const data=structuredClone(source==='local'?latest.data:selected);
      replaceModel({...latest,data});
      if(source==='local')await saveData(selectedChoice.accountId,data);
      else {await saveSyncState(selectedChoice.accountId,data,selectedChoice.cloud);baseline.current=structuredClone(selectedChoice.cloud);}
      syncPaused.current=false;await saveSyncPaused(selectedChoice.accountId,false).catch(storageFailure);
      showChoice(null);
      setSyncStatus(modelRef.current?.data!==data?'Chosen data saved · newer device edits are waiting to sync':source==='cloud'?'Cloud copy loaded on this device':'Device copy selected · sync to upload');
    } catch(error) {storageFailure(error);}finally{endOperation();}
  };
  const resolveConflict = async(source:'cloud'|'local') => {
    const current=modelRef.current,selectedConflict=conflictRef.current;
    if(!selectedConflict || current?.account?.id!==selectedConflict.accountId || !beginOperation())return;
    try {
      const verified=await getAccount();
      if(verified?.id!==current.account.id)throw new ApiError('Sign in again to resolve this account’s conflict. Local data is preserved.',401);
      if(source==='cloud') {
        const fresh=await getCloudState(current.account.id);
        const latest=modelRef.current;
        if(!latest || latest.account?.id!==current.account.id)return;
        if(!sameData(latest.data,current.data)) {
          showConflict({...selectedConflict,cloud:fresh,reasons:['Device edits changed while loading cloud data; review your choice again']});
          setSyncStatus('Newer device edits preserved · review the cloud choice again');return;
        }
        const data=fresh.data ?? emptyData();
        replaceModel({...current,data});await saveSyncState(current.account.id,data,fresh);baseline.current=structuredClone(fresh);
        showConflict(null);setSyncStatus(modelRef.current?.data===data?'Cloud copy loaded on this device':'Cloud copy loaded · newer device edits are waiting to sync');return;
      }
      const result=await putCloudState(current.data,selectedConflict.cloud.revision,current.account.id);
      const latest=modelRef.current;
      const snapshot={data:current.data,revision:result.revision};
      await saveSyncState(current.account.id,latest?.account?.id===current.account.id?latest.data:current.data,snapshot);
      baseline.current=structuredClone(snapshot);
      showConflict(null);
      const live=modelRef.current;
      setSyncStatus(live?.data===current.data?'Synced · device copy replaced the cloud copy':'Cloud saved · newer device edits are waiting to sync');
      if(live && live.data!==current.data && live.data.preferences.autoSync)autoPending.current=true;
    } catch(error) {
      if(error instanceof ApiError && error.status===409) {
        try {showConflict({...selectedConflict,cloud:await getCloudState(current.account.id)});setSyncStatus('Cloud changed again. Review your choice before replacing it.');}
        catch(fetchError) {setSyncStatus(message(fetchError));}
      } else setSyncStatus(message(error));
    } finally {endOperation();}
  };

  if(!model)return <div className="startup"><strong>Rephase</strong><span>Opening your saved rhythm…</span></div>;
  return <>
    <App data={model.data} onChange={changeData} account={model.account} authConfig={config} syncStatus={syncStatus} storageError={storageError} onSignIn={signIn} onSignOut={signOut} onSync={()=>sync(true)} onDeleteCloud={deleteCloud} onClearLocal={clearLocal}/>
    {googleOpen && config.googleClientId && <GoogleDialog clientId={config.googleClientId} onSuccess={signedIn} onClose={closeGoogle}/>}
    {choice && <Dialog title="Choose your starting data" onClose={closeChoice}>
      <p>Your guest data stays separate. Load your account’s cloud copy, keep its device copy, or explicitly copy guest preferences and trips into this account.</p>
      <button className="primary" disabled={busy} onClick={()=>void chooseData('cloud')}>{choice.cloud.data?'Use saved cloud data':'Start an empty account'}</button>
      {choice.accountLocal && <button disabled={busy} onClick={()=>void chooseData('local')}>Keep this account’s device copy</button>}
      <button disabled={busy} onClick={()=>void chooseData('guest')}>Copy this device’s guest data</button>
      <button disabled={busy} onClick={closeChoice}>Decide later</button>
    </Dialog>}
    {conflict && <Dialog title="Two copies, one choice" onClose={closeConflict}>
      <p>Changes affecting the same information need a choice. Both copies are preserved until you decide. Loading cloud data replaces this device’s copy; keeping this device’s copy replaces cloud data.</p>
      <p className="small-copy">{conflict.reasons.slice(0,4).join('; ')}</p>
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
