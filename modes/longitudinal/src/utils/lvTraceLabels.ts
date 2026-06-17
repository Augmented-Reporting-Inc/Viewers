export const LV_TRACE_LABELS = [
  { value: 'LV-A4C-ED', label: 'LV A4C – End diastole' },
  { value: 'LV-A4C-ES', label: 'LV A4C – End systole' },
  { value: 'LV-A2C-ED', label: 'LV A2C – End diastole' },
  { value: 'LV-A2C-ES', label: 'LV A2C – End systole' },
];

export const LV_TRACE_LABEL_MAP = {
  'LV-A4C-ED': { view: 'A4C', phase: 'ED' },
  'LV-A4C-ES': { view: 'A4C', phase: 'ES' },
  'LV-A2C-ED': { view: 'A2C', phase: 'ED' },
  'LV-A2C-ES': { view: 'A2C', phase: 'ES' },
};

export const LV_TRACE_MEASUREMENT_LABELS_CONFIG = {
  id: 'measurementLabels',
  labelOnMeasure: true,
  exclusive: true,
  items: LV_TRACE_LABELS,
};
