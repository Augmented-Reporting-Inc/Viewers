import React from 'react';

function normalizeText(value) {
  return String(value || '').trim();
}

function getMeasurementKind(value) {
  return normalizeText(value?.measurementKind || value?.measurements?.measurementKind);
}

function getDisplayText(value) {
  const candidates = [
    value?.displayText,
    value?.measurements?.displayText,
    value?.data?.arSavedMeasurementDisplayText,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const lines = candidate.map(normalizeText).filter(Boolean);
      if (lines.length) {
        return lines.join(' Â· ');
      }
    }

    const text = normalizeText(candidate);
    if (text) {
      return text;
    }
  }

  return '';
}

function getLengthSummary(value) {
  const rawValue =
    value?.value ??
    value?.length ??
    value?.measurements?.value ??
    value?.measurements?.length;
  const numericValue = Number(rawValue);

  if (Number.isFinite(numericValue)) {
    const unit = normalizeText(
      value?.unit ||
        value?.lengthUnit ||
        value?.measurements?.unit ||
        value?.measurements?.lengthUnit ||
        'mm'
    );

    return `${numericValue.toFixed(1).replace(/\.0$/, '')} ${unit}`;
  }

  return getDisplayText(value);
}

function getAnnotationPresentation(annotation) {
  const toolName = normalizeText(annotation?.toolName);
  const measurementKind = getMeasurementKind(annotation);
  const label = normalizeText(
    annotation?.label || annotation?.measurementRole || annotation?.role
  );

  if (toolName === 'ArrowAnnotate') {
    const text = normalizeText(
      annotation?.text ||
        annotation?.measurements?.text ||
        annotation?.data?.text ||
        label
    );

    return {
      title: 'Annotation',
      detail: text,
    };
  }

  if (measurementKind === 'bowelCurvedLength') {
    const length = getLengthSummary(annotation);
    return {
      title: 'Curved Length',
      detail: [label, length].filter(Boolean).join(' - '),
    };
  }

  return {
    title: label || toolName || 'Viewer annotation',
    detail: getDisplayText(annotation),
  };
}

export default function ViewerAnnotations({
  annotations = [],
  measurementService,
  commandsManager,
  onRemove,
  readOnly = false,
}) {
  if (!annotations.length) {
    return null;
  }

  function jumpToAnnotation(annotation) {
    const annotationId = normalizeText(
      annotation?.uid ||
        annotation?.annotationId ||
        annotation?.annotationUID ||
        annotation?.id
    );

    if (!annotationId) {
      return;
    }

    const liveMeasurement = measurementService?.getMeasurement?.(annotationId);
    if (liveMeasurement) {
      measurementService.jumpToMeasurement?.(null, annotationId);
      return;
    }

    commandsManager?.runCommand?.('jumpToSavedViewerAnnotation', { annotation });
  }

  return (
    <div className="border-b border-gray-700 px-3 py-2">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Viewer annotations
      </div>

      <div className="space-y-1.5">
        {annotations.map(annotation => {
          const annotationId = normalizeText(
            annotation?.uid ||
              annotation?.annotationId ||
              annotation?.annotationUID ||
              annotation?.id
          );
          const presentation = getAnnotationPresentation(annotation);

          const isNavigable =
            !!annotationId &&
            !!(
              measurementService?.getMeasurement?.(annotationId) ||
              annotation?.referencedImageId
            );

          return (
            <div
              key={annotationId || `${presentation.title}-${presentation.detail}`}
              className="flex items-start justify-between gap-2 rounded border border-gray-700 bg-gray-800/60 px-2 py-1.5"
            >
              <div
                className={[
                  'min-w-0',
                  isNavigable ? 'cursor-pointer hover:text-primary-light' : '',
                ].join(' ')}
                title={isNavigable ? 'Click to jump to annotation' : ''}
                onClick={() => isNavigable && jumpToAnnotation(annotation)}
              >
                <div className="text-xs font-medium text-gray-200">{presentation.title}</div>
                {presentation.detail ? (
                  <div className="mt-0.5 break-words text-[11px] text-gray-400">
                    {presentation.detail}
                  </div>
                ) : null}
              </div>

              {!readOnly && annotationId && typeof onRemove === 'function' ? (
                <button
                  type="button"
                  className="shrink-0 text-[11px] text-gray-500 hover:text-red-400"
                  onClick={() => onRemove(annotation)}
                  title="Remove annotation"
                >
                  Remove
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}