import { calculateLVSimpson, buildClinicalLVSimpsonReportFieldUpdates } from './lvSimpson';
import { calculateLAVolume, buildCseLAVolumeReportFieldUpdatesFromResult } from './laVolume';
import {
  calculateRAAreaFromMeasurements,
  calculateRVFACFromMeasurements,
  buildClinicalRAAreaReportFieldUpdates,
  buildClinicalRVFACReportFieldUpdates,
} from './echoAreaMeasurements';
import {
  calculateIVCFromMeasurements,
  buildClinicalIVCReportFieldUpdates,
} from './rightHeartMeasurements';

/**
 * The single clinical save-boundary adapter for derived Echo report fields.
 * Derive from the *canonical annotations being persisted*, not a UI snapshot
 * or a caller-supplied scalar. An incomplete or ambiguous measurement produces
 * no report field updates and never clears an established report value.
 *
 * Do not invoke for education attempts or virtual-coaching reviews.
 */
export function buildClinicalEchoDerivedReportFieldUpdates(annotations: any[] = []) {
  if (!Array.isArray(annotations) || annotations.length === 0) return {};

  const lv = calculateLVSimpson(annotations);
  const la = calculateLAVolume(annotations);
  const ra = calculateRAAreaFromMeasurements(annotations);
  const rv = calculateRVFACFromMeasurements(annotations);
  const ivc = calculateIVCFromMeasurements(annotations);

  return {
    ...buildClinicalLVSimpsonReportFieldUpdates(lv),
    ...buildCseLAVolumeReportFieldUpdatesFromResult(la),
    ...buildClinicalRAAreaReportFieldUpdates(ra),
    ...buildClinicalRVFACReportFieldUpdates(rv),
    ...buildClinicalIVCReportFieldUpdates(ivc),
  };
}
