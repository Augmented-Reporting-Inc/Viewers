export const LA_VOLUME_LABELS = [
  {
    value: 'LA-A4C-ES',
    label: 'LA A4C – Max volume (end-systole)',
    view: 'A4C',
    phase: 'ES',
  },
  {
    value: 'LA-A2C-ES',
    label: 'LA A2C – Max volume (end-systole)',
    view: 'A2C',
    phase: 'ES',
  },
] as const;

export const LA_VOLUME_REQUIRED_SLOTS = ['A4C', 'A2C'];

export const LA_VOLUME_LABEL_RE = /^LA-(A[24]C)-ES$/i;

export const LA_VOLUME_MEASUREMENT_KIND = 'laVolumeSlot';

export const LA_VOLUME_MEASUREMENT_LABELS_CONFIG = {
  id: 'laVolumeMeasurementLabels',
  labelOnMeasure: false,
  exclusive: true,
  items: LA_VOLUME_LABELS,
};

function normalizeLAVolumeLabelText(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[–—-]/g, ' ')
    .replace(/\s+/g, ' ');
}

const LA_VOLUME_LABEL_BY_VALUE = LA_VOLUME_LABELS.reduce((acc, item) => {
  acc[item.value] = item;
  return acc;
}, {});

const LA_VOLUME_VALUE_BY_NORMALIZED_LABEL = LA_VOLUME_LABELS.reduce((acc, item) => {
  acc[normalizeLAVolumeLabelText(item.label)] = item.value;
  return acc;
}, {});

export function normalizeLAVolumeSelection(value) {
  const raw = String(value || '').trim();

  if (!raw) {
    return '';
  }

  if (LA_VOLUME_LABEL_BY_VALUE[raw]) {
    return raw;
  }

  return LA_VOLUME_VALUE_BY_NORMALIZED_LABEL[normalizeLAVolumeLabelText(raw)] || raw;
}

export function parseLAVolumeLabel(label) {
  const raw = String(label || '').trim();
  const value = normalizeLAVolumeSelection(raw);
  const valueMatch = value.match(LA_VOLUME_LABEL_RE);

  if (!valueMatch) {
    return null;
  }

  const view = valueMatch[1].toUpperCase();

  return {
    label: value,
    view,
    phase: 'ES',
    slot: view,
  };
}

export function getLAVolumeLabelForSlot(slot = '') {
  const normalizedSlot = String(slot || '')
    .trim()
    .toUpperCase();

  return LA_VOLUME_LABELS.find(item => item.view === normalizedSlot)?.value || '';
}

export function getMissingLAVolumeSlots(traces = []) {
  const present = new Set(traces.map(trace => trace?.slot).filter(Boolean));
  return LA_VOLUME_REQUIRED_SLOTS.filter(slot => !present.has(slot));
}
