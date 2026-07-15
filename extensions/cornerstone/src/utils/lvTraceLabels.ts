export const LV_TRACE_LABELS = [
  { value: 'LV-A4C-ED', label: 'LV A4C – End diastole', view: 'A4C', phase: 'ED' },
  { value: 'LV-A4C-ES', label: 'LV A4C – End systole', view: 'A4C', phase: 'ES' },
  { value: 'LV-A2C-ED', label: 'LV A2C – End diastole', view: 'A2C', phase: 'ED' },
  { value: 'LV-A2C-ES', label: 'LV A2C – End systole', view: 'A2C', phase: 'ES' },
] as const;

export const LV_TRACE_REQUIRED_SLOTS = ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'];

export const LV_TRACE_LABEL_RE = /^LV-(A[24]C)-(ED|ES)$/i;

export const LV_SIMPSON_MEASUREMENT_KIND = 'lvSimpsonSlot';

export const LV_TRACE_MEASUREMENT_LABELS_CONFIG = {
  id: 'lvTraceMeasurementLabels',
  labelOnMeasure: false,

  // Only allow one LV slot label per trace.
  exclusive: true,

  items: LV_TRACE_LABELS,
};

function normalizeLVTraceLabelText(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[–—-]/g, ' ')
    .replace(/\s+/g, ' ');
}

const LV_TRACE_LABEL_BY_VALUE = LV_TRACE_LABELS.reduce((acc, item) => {
  acc[item.value] = item;
  return acc;
}, {});

const LV_TRACE_VALUE_BY_NORMALIZED_LABEL = LV_TRACE_LABELS.reduce((acc, item) => {
  acc[normalizeLVTraceLabelText(item.label)] = item.value;
  return acc;
}, {});

export function normalizeLVTraceSelection(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  if (LV_TRACE_LABEL_BY_VALUE[raw]) {
    return raw;
  }

  return LV_TRACE_VALUE_BY_NORMALIZED_LABEL[normalizeLVTraceLabelText(raw)] || raw;
}

export function parseLVTraceLabel(label) {
  const raw = String(label || '').trim();
  const value = normalizeLVTraceSelection(raw);
  const valueMatch = value.match(LV_TRACE_LABEL_RE);

  if (!valueMatch) {
    return null;
  }

  const view = valueMatch[1].toUpperCase();
  const phase = valueMatch[2].toUpperCase();

  return {
    label: value,
    view,
    phase,
    slot: `${view}_${phase}`,
  };
}

export function getLVTraceLabelForSlot(slot = '') {
  const normalizedSlot = String(slot || '').trim();
  return LV_TRACE_LABELS.find(item => `${item.view}_${item.phase}` === normalizedSlot)?.value || '';
}

export function getMissingLVTraceSlots(traces = []) {
  const present = new Set(traces.map(trace => trace?.slot).filter(Boolean));
  return LV_TRACE_REQUIRED_SLOTS.filter(slot => !present.has(slot));
}
