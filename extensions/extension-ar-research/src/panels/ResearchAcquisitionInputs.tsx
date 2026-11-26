import React, { useEffect, useState, useRef } from 'react';
import { loadResearchReadAnthropometrics, saveResearchReadAnthropometrics } from '../utils/researchContext';
import { acquisitionFields, acquisitionInputStrings, buildAcquisitionOverrideRequest } from '../utils/researchAcquisitionInputs';

// OHIF's global form-control background can be white even in the dark viewer.
// Set both foreground and background explicitly on these local controls.
const acquisitionInputStyle: React.CSSProperties = {
  color: '#111827',
  backgroundColor: '#ffffff',
  caretColor: '#111827',
  WebkitTextFillColor: '#111827',
};

export default function ResearchAcquisitionInputs({reviewKey, readOnly, disabled, onBusy, onNotify}: {
  reviewKey: string; readOnly: boolean; disabled: boolean; onBusy: (busy: boolean) => void; onNotify?: (message: string) => void;
}) {
  const [snapshot,setSnapshot] = useState<any>(null);
  const [inputs,setInputs] = useState<Record<string,string>>({});
  const [reason,setReason] = useState('');
  const [verified,setVerified] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    void load();
    return () => { pending.current?.abort(); pending.current = null; onBusy(false); };
  }, [reviewKey]);
  function apply(next: any) {
    if (!Number.isSafeInteger(next?.revision) || !next?.baseline?.values || !next?.effective)
      throw new Error('Invalid acquisition response.');
    setSnapshot(next); setInputs(acquisitionInputStrings(next.effective));
    setVerified(next.acquisitionVerified === true); setReason('');
  }
  async function load() {
    if (pending.current) return;
    const request = new AbortController(); pending.current = request;
    setBusy(true); onBusy(true); setError(''); setNotice(''); setSnapshot(null);
    try {
      const next = await loadResearchReadAnthropometrics(reviewKey,request.signal);
      if (!request.signal.aborted) apply(next);
    } catch {
      if (!request.signal.aborted) setError('Acquisition inputs unavailable or access not permitted.');
    } finally {
      if (!request.signal.aborted) { pending.current=null; setBusy(false); onBusy(false); }
    }
  }
  async function save() {
    if (pending.current || readOnly || disabled) return;
    const body = buildAcquisitionOverrideRequest(snapshot,inputs,reason,verified);
    if (!body) {setError('Enter valid acquisition values. A reason is required only when correcting values.');return;}
    const request = new AbortController(); pending.current=request;
    setBusy(true); onBusy(true); setError(''); setNotice('');
    try {
      const next = await saveResearchReadAnthropometrics(reviewKey,body,request.signal);
      if (request.signal.aborted) return;
      if (next?.revision !== body.expectedRevision+1) throw new Error('Unverified revision');
      apply(next); setNotice('Acquisition inputs saved to this Read.'); onNotify?.('Acquisition inputs saved to this Read.');
    } catch {
      if (!request.signal.aborted) {setSnapshot(null);setError('Unable to verify saved inputs. Reload before editing.');}
    } finally {
      if (!request.signal.aborted) {pending.current=null;setBusy(false);onBusy(false);}
    }
  }
  const locked = readOnly || disabled || busy || !snapshot?.editable;
  return <div className="my-2 rounded border border-gray-700 p-3 text-xs text-gray-200"
    onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <div className="font-semibold">Acquisition measurements</div>
    <p className="mt-1 text-gray-400">DICOM defaults and verified manager corrections. Changes affect only this Read. Z-scores are not calculated yet.</p>
    <button type="button" disabled={busy || disabled} onClick={() => void load()} className="mt-2 rounded border border-gray-500 px-2 py-1 disabled:opacity-50">
      {snapshot ? 'Reload inputs' : 'Load acquisition inputs'}
    </button>
    {busy ? <p role="status">Loading or saving acquisition inputs…</p> : null}
    {snapshot && locked ? <p role="status">{readOnly ? 'This Read is read-only.' : !snapshot.editable ? 'The server has locked editing for this Read.' : 'Another operation is in progress.'}</p> : null}
    {snapshot ? <div className="mt-2 space-y-2">
      {acquisitionFields.map(({key,label}) => <label key={key} className="block">
        {label}
        <input className="mt-1 block w-full rounded border border-gray-600 p-1" style={acquisitionInputStyle} type="text" inputMode="decimal"
          value={inputs[key] || ''} disabled={locked} onChange={event => {setInputs(old=>({...old,[key]:event.target.value}));setVerified(false);setNotice('');}} />
        <span className="block text-gray-400">DICOM: {snapshot.baseline.dicom?.[key] ?? 'Unavailable'} · baseline: {snapshot.baseline.values[key] ?? 'Unavailable'}</span>
      </label>)}
      {!locked ? <>
        <button type="button" className="rounded border border-gray-500 px-2 py-1" onClick={()=>{setInputs(acquisitionInputStrings(snapshot.baseline.values));setVerified(false);setReason('');setError('');setNotice('Baseline restored locally. Save acquisition inputs to persist the change.');onNotify?.('Baseline restored locally. Save to persist.');}}>Restore baseline</button>
        <label className="block">Reason for correction (only required for changed values)
          <textarea className="block w-full rounded border border-gray-600 p-1" style={acquisitionInputStyle} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} />
        </label>
        <label className="block"><input type="checkbox" checked={verified} onChange={event=>{setVerified(event.target.checked);setError('');}} /> I verified these acquisition values.</label>
        <button type="button" className="rounded bg-blue-700 px-2 py-1 text-white" onClick={()=>void save()}>Save acquisition inputs</button>
      </> : null}
    </div> : null}
    {error ? <p role="alert" className="mt-2 text-red-300">{error}</p> : null}
    {notice ? <p role="status" className="mt-2 text-green-300">{notice}</p> : null}
  </div>;
}
