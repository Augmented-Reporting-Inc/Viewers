import React, { useEffect, useRef, useState } from 'react';
import { attestResearchReadZScore, loadResearchReadZScores } from '../utils/researchContext';
import { getVisibleResearchZScore, matchesZScoreResponse } from '../utils/researchReadZScore';

const checks = [
  ['applicability', 'I confirmed that the patient and acquisition meet the configured PHN reference population and model eligibility criteria.'],
  ['technique', 'I reviewed the saved measurement and confirmed the anatomical landmark, imaging plane, timing and measurement convention.'],
  ['calibration', 'I checked the saved source frame and confirmed that the physical length calibration and units are correct.'],
] as const;
const unchecked = () => ({applicability:false,technique:false,calibration:false});

export default function ResearchReadZScore({reviewKey, field, savedAt, acquisitionRevision,
  readOnly, disabled, visibility, completed, onBusy, automatic=false}: {
  reviewKey:string; field:any; savedAt:unknown; acquisitionRevision:number;
  readOnly:boolean; disabled:boolean; visibility:string; completed:boolean; automatic?:boolean;
  onBusy:(busy:boolean)=>void;
}) {
  const [snapshot,setSnapshot] = useState<any>(null);
  const [confirmations,setConfirmations] = useState(unchecked);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const pending = useRef<AbortController | null>(null);

  function apply(next:any) {
    if (!matchesZScoreResponse(next,savedAt,acquisitionRevision) ||
        (automatic && next.verificationMode !== 'automatic_calibrated'))
      throw new Error('Saved evidence has changed. Reopen or save the Read and reload acquisition inputs.');
    setSnapshot(next);
    setConfirmations(unchecked());
  }
  async function load() {
    if (pending.current) return;
    const request = new AbortController(); pending.current = request;
    setBusy(true); onBusy(true); setSnapshot(null); setError('');
    try {
      const next = await loadResearchReadZScores(reviewKey,request.signal);
      if (!request.signal.aborted) apply(next);
    } catch {
      if (!request.signal.aborted) setError('Unable to verify saved Z-score evidence. Reload the Read or check access.');
    } finally {
      if (!request.signal.aborted) {pending.current=null;setBusy(false);onBusy(false);}
    }
  }
  useEffect(() => {
    void load();
    return () => {pending.current?.abort();pending.current=null;onBusy(false);};
  }, [reviewKey,field.componentKey,savedAt,acquisitionRevision]);

  const matches = Array.isArray(snapshot?.questions) ? snapshot.questions.filter(q =>
    q?.componentKey === field.componentKey) : [];
  const question = matches.length === 1 ? matches[0] : null;
  const canAttest = !automatic && snapshot?.verificationMode !== 'automatic_calibrated' && !readOnly && !disabled && !busy && snapshot?.editable === true &&
    question?.status === 'ready_for_verification' && /^[a-f0-9]{64}$/.test(question.evidenceDigest || '');
  async function attest() {
    if (!canAttest || pending.current || !Object.values(confirmations).every(v => v === true)) return;
    const request = new AbortController(); pending.current=request;
    setBusy(true);onBusy(true);setError('');setSnapshot(null);
    try {
      const next=await attestResearchReadZScore(reviewKey,{
        componentKey:field.componentKey,evidenceDigest:question.evidenceDigest,confirmations,
      },request.signal);
      if (!request.signal.aborted) apply(next);
    } catch {
      if (!request.signal.aborted) setError('Verification was not confirmed. Reload saved evidence before retrying.');
    } finally {
      if (!request.signal.aborted) {pending.current=null;setBusy(false);onBusy(false);}
    }
  }

  // The server is authoritative; the assigned policy is an additional local
  // guard, never a way to recover values the server did not return.
  const score = visibility === 'during_read' || (visibility === 'after_completion' && completed)
    ? getVisibleResearchZScore(snapshot,field) : null;
  return <div className="mt-2 rounded border border-gray-700 p-3 text-xs text-gray-200"
    onKeyDown={event=>event.stopPropagation()} onKeyUp={event=>event.stopPropagation()}>
    <div className="font-semibold">Saved measurement Z-score</div>
    {busy ? <p role="status">Checking saved evidence…</p> : null}
    {score ? <div className="mt-2 grid grid-cols-2 gap-2">
      <div><div className="text-gray-400">Z-score</div>
        <div className="text-xl font-semibold">{score.zScore > 0 ? '+' : ''}{score.zScore.toFixed(2)}</div></div>
      <div><div className="text-gray-400">BSA</div>
        <div className="text-lg font-semibold">{score.bsaM2.toFixed(3)} m²</div></div>
      <div className="col-span-2 text-gray-400">PHN 2017 · Haycock BSA</div>
      {Math.abs(score.zScore)>=5 ? <div role="status" className="col-span-2 text-amber-200">Extreme Z-score — review measurement and acquisition inputs. This is a review flag, not a diagnostic threshold.</div> : null}
    </div> : null}
    {question?.status === 'verified' && !score ? <p className="mt-1 text-gray-400">Verification recorded. Score visibility is restricted by the study policy.</p> : null}
    {question?.status === 'unavailable' ? <p className="mt-1 text-amber-200">{question.reason === 'automatic_calibration_unavailable' ? 'Z-score unavailable: automatic source calibration could not be corroborated. Check the saved measurement and source frame.' : question.reason === 'model_eligibility_unconfirmed' ? 'Confirm reference model eligibility with the acquisition inputs.' : 'Z-score unavailable: saved measurement or acquisition evidence is not eligible.'}</p> : null}
    {question?.status === 'unverified' ? <p className="mt-1 text-gray-400">No verified result is available for this saved measurement.</p> : null}
    {canAttest ? <div className="mt-2 space-y-2">
      {checks.map(([key,label]) => <label key={key} className="flex items-start gap-2">
        <input type="checkbox" checked={confirmations[key]} onChange={event =>
          setConfirmations(old=>({...old,[key]:event.target.checked}))}/><span>{label}</span>
      </label>)}
      <button type="button" disabled={!Object.values(confirmations).every(v=>v===true)}
        className="rounded bg-blue-700 px-2 py-1 text-white disabled:opacity-50" onClick={()=>void attest()}>
        Verify and calculate Z-score
      </button>
    </div> : null}
    {error ? <p role="alert" className="mt-2 text-red-300">{error}</p> : null}
    {(error || (automatic && question?.status === 'unavailable')) && !busy ? <button type="button" disabled={disabled} onClick={()=>void load()}
      className="mt-2 rounded border border-gray-500 px-2 py-1 disabled:opacity-50">Reload saved evidence</button> : null}
  </div>;
}
