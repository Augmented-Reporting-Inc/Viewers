/**
 * Protocol-configured measurement tool has precedence. The default for a
 * millimetre-valued Echo measurement is the calibrated viewer Length tool.
 * Do not infer Length from centimetres (e.g. spectral VTI), percentages,
 * or pressure units. Non-Echo and non-measurement fields are not affected.
 */
export function getResearchMeasurementToolForField(field: any, domain: string): string {
  if (String(domain || '').toLowerCase() !== 'echo' ||
      !['measurement', 'continuous', 'number', 'numeric'].includes(
        String(field?.kind || '').toLowerCase()
      )) return '';
  const configured = String(
    field?.config?.viewerMeasurementTool || field?.config?.measurementTool || ''
  ).trim();
  if (configured) return configured === 'Length' ? 'Length' : '';
  if (String(field?.config?.unit || '').trim().toLowerCase() !== 'mm') return '';
  if (field?.config?.calculation || field?.config?.options?.length) return '';
  return 'Length';
}
