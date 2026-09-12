import type {VideoCut} from './visual-rush';

/** The same source/evidence rules are used by saving and Ollama's preflight.
 * Report every invalid field together so a caller can repair one proposal once.
 * Never clamp cuts, drop evidence or manufacture inspected timestamps.
 */
export function validateVideoCutRanges(shots: VideoCut['shots'], sourceDuration: number | undefined, inspectedTimes?: readonly number[], knownTimes = inspectedTimes) {
  const inspected = inspectedTimes ? [...inspectedTimes].sort((a, b) => a - b) : undefined;
  const wasInspected = (time: number) => {
    if(!inspected) return true;
    let low = 0; let high = inspected.length;
    while(low < high) {const middle = Math.floor((low + high) / 2); if(inspected[middle] < time) low = middle + 1; else high = middle;}
    return Math.abs(inspected[low] - time) < .001 || Math.abs(inspected[low - 1] - time) < .001;
  };
  const issues: Record<string, unknown>[] = [];
  shots.forEach((shot, index) => {
    const location = {shotIndex: index, shotId: shot.id, ...(knownTimes ? {inspectedEvidenceInsideShot: knownTimes.filter(time => time >= shot.start && time < shot.end), inspectedOriginalCitations: shot.evidence.filter(time => knownTimes.some(known => Math.abs(known - time) < .001))} : {})};
    if(shot.end <= shot.start) issues.push({...location, path: `shots[${index}].end`, start: shot.start, end: shot.end, evidence: shot.evidence, rule: 'end must be strictly greater than start.', repair: 'Choose the intended SOURCE interval containing the evidence. Do not copy the previous shot end as this source start: proposal order determines timeline placement independently. Swapping start/end alone may still exclude the evidence.'});
    if(sourceDuration !== undefined && shot.start >= sourceDuration) issues.push({...location, path: `shots[${index}].start`, value: shot.start, rule: `start must be less than sourceDuration (${sourceDuration}).`});
    // Keep the established 1 ms metadata tolerance; evidence still uses [start,end).
    if(sourceDuration !== undefined && shot.end > sourceDuration + .001) issues.push({...location, path: `shots[${index}].end`, value: shot.end, maximum: sourceDuration, rule: `end must not exceed sourceDuration (${sourceDuration}).`});
    const outside = shot.evidence.flatMap((time, evidenceIndex) => time < shot.start || time >= shot.end ? [{path: `shots[${index}].evidence[${evidenceIndex}]`, value: time}] : []);
    if(outside.length) issues.push({...location, rule: 'start <= evidence < end. The end timestamp is EXCLUDED, even when it was inspected.', start: shot.start, end: shot.end, invalidEvidence: outside, existingEvidenceInsideShot: shot.evidence.filter(time => time >= shot.start && time < shot.end), repair: 'Choose evidence inside the intended shot, or deliberately adjust its boundaries to include the cited frames within the source. Do not change descriptions instead of the invalid timestamps.'});
    const unseen = shot.evidence.flatMap((time, evidenceIndex) => wasInspected(time) ? [] : [{path: `shots[${index}].evidence[${evidenceIndex}]`, value: time}]);
    if(unseen.length) issues.push({...location, rule: 'Evidence must come from inspect_video for this report.', uninspectedEvidence: unseen, repair: 'Inspect the cited source frames with inspect_video before saving a cut, or cite already inspected frames inside this shot. Do not invent or round evidence timestamps.'});
  });
  if(issues.length) throw new Error(JSON.stringify({error: 'Invalid video cut ranges or evidence', sourceDuration, units: 'source seconds', rule: '0 <= start < end <= sourceDuration; start <= evidence < end', issues, instruction: 'Correct ALL listed fields and resubmit save_video_cut. The proposal was not saved. Valid shots, descriptions and previously inspected frames do not need to be regenerated.'}));
}
