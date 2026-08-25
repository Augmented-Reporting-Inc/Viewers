/**
 * Commands registered by extension-iuscan.
 *
 * iUSCAN owns bowel-specific labels and the bowel-report field mapping.
 * Generic annotation persistence and generic AR Series payload persistence
 * are provided by extension-cornerstone commands.
 */

import { MEASUREMENT_LABELS } from './utils/labelMap';
import {
  buildReportPayload,
  getLegacyIuscanMeasurementPlaceholders,
} from './utils/reportBuilder';
import { getIuscanRepeatedAnnotationId, isIuscanRepeatedMeasurement } from './utils/repeatedMeasurements';
import { saveActiveResearchReviewResults } from './utils/researchProtocol';

const IUSCAN_MEASUREMENT_LABELS_CONFIG = {
  id: 'iuscanRepeatedMeasurementLabels',
  domain: 'iuscan',
  dialogTitle: 'Bowel Annotation',
  annotationTitle: 'Bowel Annotation',
  labelOnMeasure: true,
  exclusive: false,
  items: MEASUREMENT_LABELS,
};

export default function getCommandsModule({ servicesManager, commandsManager }) {
  const { measurementService, uiNotificationService } = servicesManager.services;

  return {
    defaultContext: 'ACTIVE_VIEWPORT::CORNERSTONE',

    definitions: {
      setIUScanMeasurementLabel: {
        commandFn: async ({ uid } = {}) => {
          if (!uid) {
            return null;
          }

          return commandsManager.runCommand('setMeasurementLabel', {
            uid,
            title: IUSCAN_MEASUREMENT_LABELS_CONFIG.dialogTitle,
            placeholder: 'Choose bowel measurement',
            labelConfigOverride: IUSCAN_MEASUREMENT_LABELS_CONFIG,
          });
        },
      },

      exportIUScanReport: {
        commandFn: async ({ observationsBySite = {}, removedAnnotationIds = [] } = {}) => {
          try {
            const liveMeasurements = measurementService.getMeasurements?.() || [];

            // Persist canonical viewer annotations through the shared Cornerstone path.
            // Observation-only saves do not need to invoke annotation persistence.
            const repeatedMeasurementIds = liveMeasurements
              .filter(isIuscanRepeatedMeasurement)
              .map(measurement => String(measurement?.uid || '').trim())
              .filter(Boolean);

            if (repeatedMeasurementIds.length > 0 || removedAnnotationIds.length > 0) {
              await commandsManager.runCommand('saveViewerMeasurementsForActiveStudy', {
                domain: 'iuscan',
                deleteAnnotationIds: removedAnnotationIds,
                measurementIds: repeatedMeasurementIds,
                suppressSuccessNotification: true,
              });
            }

            // Re-read the canonical repeated annotations after the save. Initial
            // hydration is intentionally panel-only, so the persisted snapshots
            // are the authoritative source for rows that are not currently live.
            const persisted = await commandsManager.runCommand(
              'getViewerMeasurementAnnotationsForActiveStudy',
              {
                domain: 'iuscan',
                workflows: ['viewerMeasurements'],
                includeRepeated: true,
              }
            );

            const persistedRepeated = (persisted?.annotations || []).filter(
              annotation => annotation?.mode === 'repeated' || annotation?.repeatedMeasurement
            );
            const legacyPlaceholders = getLegacyIuscanMeasurementPlaceholders(
              persisted?.seriesDoc || {},
              persistedRepeated
            );

            const payload = buildReportPayload({
              liveMeasurements,
              savedAnnotations: [...persistedRepeated, ...legacyPlaceholders],
              observationsBySite,
            });

            if (!Object.keys(payload).length) {
              uiNotificationService.show({
                title: 'Augmented Reporting',
                message: 'No bowel measurements or observations to save.',
                type: 'warning',
                duration: 3000,
              });
              return null;
            }

            return commandsManager.runCommand('saveViewerStructuredPayloadForActiveStudy', {
              payload,
              source: 'extension-iuscan',
              notificationTitle: 'Augmented Reporting',
              successMessage: 'Measurements saved to report.',
            });
          } catch (error) {
            console.error('[iUSCAN] exportIUScanReport error:', error);
            uiNotificationService.show({
              title: 'Augmented Reporting',
              message: `Export failed: ${error?.message || error}`,
              type: 'error',
              duration: 5000,
            });
            throw error;
          }
        },
      },

      exportIUScanResearchReview: {
        commandFn: async ({
          observationsBySite = {},
          savedAnnotations = [],
          removedAnnotationIds = [],
        } = {}) => {
          try {
            const removedIds = new Set(
              (removedAnnotationIds || []).map(value => String(value || '').trim()).filter(Boolean)
            );
            const liveMeasurements = measurementService.getMeasurements?.() || [];
            const repeatedMeasurementIds = liveMeasurements
              .filter(isIuscanRepeatedMeasurement)
              .map(measurement => String(measurement?.uid || '').trim())
              .filter(Boolean);

            const serialized = await commandsManager.runCommand('getSerializedViewerMeasurements', {
              domain: 'iuscan',
              workflow: 'viewerMeasurements',
              measurementIds: repeatedMeasurementIds,
            });

            const merged = new Map();
            for (const annotation of savedAnnotations || []) {
              const annotationId = getIuscanRepeatedAnnotationId(annotation);
              if (annotationId && !removedIds.has(annotationId)) {
                merged.set(annotationId, annotation);
              }
            }
            for (const annotation of serialized?.annotations || []) {
              const annotationId = getIuscanRepeatedAnnotationId(annotation);
              if (annotationId && !removedIds.has(annotationId)) {
                merged.set(annotationId, annotation);
              }
            }

            const measurementAnnotations = Array.from(merged.values());
            const result = await saveActiveResearchReviewResults({
              measurementAnnotations,
              observationsBySite,
            });

            const persistedAnnotations = Array.isArray(result?.measurementAnnotations)
              ? result.measurementAnnotations
              : [];

            if (persistedAnnotations.length !== measurementAnnotations.length) {
              throw new Error(
                `Research review save verification failed: expected ${measurementAnnotations.length} measurement(s), received ${persistedAnnotations.length}.`
              );
            }

            uiNotificationService.show({
              title: 'Research Review',
              message: `Research review saved (${persistedAnnotations.length} measurement${persistedAnnotations.length === 1 ? '' : 's'}).`,
              type: 'success',
              duration: 3000,
            });

            return result;
          } catch (error) {
            console.error('[iUSCAN] exportIUScanResearchReview error:', error);
            uiNotificationService.show({
              title: 'Research Review',
              message: `Save failed: ${error?.message || error}`,
              type: 'error',
              duration: 5000,
            });
            throw error;
          }
        },
      },

      clearIUScanMeasurements: {
        commandFn: () => {
          measurementService.clearMeasurements();
          uiNotificationService.show({
            title: 'Augmented Reporting',
            message: 'Measurements cleared. Save to persist the change.',
            type: 'info',
            duration: 2500,
          });
        },
      },
    },
  };
}
