import { calculateLVSimpsonContourVolumeForAnnotationData } from '../../../extension-ar-measurements/src/utils/lvSimpson';
import { getVerifiedEFGoldContourViewportLines, getVerifiedEFLearnerContourViewportLines } from './quizEchoAreaCalibration';

/** One EF viewport formatter for live, restored and scored-review contours.
 * Generic cached ROI statistics are never the source of EF contour volumes. */
export function getLVSimpsonContourViewportLines(raw: any): string[] | null {
  const data = raw?.annotation?.data || raw?.data || raw;
  const gold = getVerifiedEFGoldContourViewportLines(data?.arVerifiedQuizEFGoldContour);
  if (gold) return gold;
  const learner = getVerifiedEFLearnerContourViewportLines(data?.arVerifiedQuizEFLearnerContour);
  if (learner) return learner;
  const slot = String(data?.lvSimpson?.slot || '');
  if (!['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'].includes(slot)) return null;
  const volume = calculateLVSimpsonContourVolumeForAnnotationData(data);
  return [slot.replace('_', ' ') + ' single-view LV volume: ' +
    (volume !== null ? volume.toFixed(2) + ' mL' : 'unavailable')];
}
