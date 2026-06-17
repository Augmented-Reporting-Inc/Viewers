export const LV_TRACE_LABELS = [
  { value: 'LV-A4C-ED', label: 'LV A4C – End diastole' },
  { value: 'LV-A4C-ES', label: 'LV A4C – End systole' },
  { value: 'LV-A2C-ED', label: 'LV A2C – End diastole' },
  { value: 'LV-A2C-ES', label: 'LV A2C – End systole' },
];

export const LV_TRACE_LABEL_MAP = {
  'LV-A4C-ED': { view: 'A4C', phase: 'ED', slot: 'A4C_ED' },
  'LV-A4C-ES': { view: 'A4C', phase: 'ES', slot: 'A4C_ES' },
  'LV-A2C-ED': { view: 'A2C', phase: 'ED', slot: 'A2C_ED' },
  'LV-A2C-ES': { view: 'A2C', phase: 'ES', slot: 'A2C_ES' },
};

export const LV_TRACE_MEASUREMENT_LABELS_CONFIG = {
  id: 'measurementLabels',

  // Keep false for now so SplineROI creation does not always force the popup.
  // The user explicitly opens the popup with "Set LV Slot".
  labelOnMeasure: false,

  // Only allow one LV slot label per trace.
  exclusive: true,

  items: LV_TRACE_LABELS,
};
