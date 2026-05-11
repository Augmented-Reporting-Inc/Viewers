/**
 * Hanging protocol for intestinal ultrasound studies.
 *
 * Accepts any US study. Displays in a 1×1 grid (single viewport).
 * No named-series matching — GI US series names are unpredictable.
 * The series panel on the left lets the clinician switch between
 * stills and clips manually.
 */
const hpIUScan = {
  id: 'hpIUScan',
  hasUpdatedPriorsInformation: false,
  name: 'GI Ultrasound',
  protocolMatchingRules: [
    {
      attribute: 'ModalitiesInStudy',
      constraint: { contains: { value: 'US' } },
    },
  ],
  displaySetSelectors: {
    firstUSDisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: { equals: { value: 'US' } },
        },
      ],
    },
  },
  stages: [
    {
      name: 'default',
      stageActivation: { enabled: { minViewportsMatched: 1 } },
      viewportStructure: {
        layoutType: 'grid',
        properties: { rows: 1, columns: 1 },
      },
      viewports: [
        {
          viewportOptions: {
            viewportType: 'stack',
            toolGroupId: 'iuscan-tool-group',
            initialImageOptions: { preset: 'first' },
            syncGroups: [],
          },
          displaySets: [
            {
              id: 'firstUSDisplaySet',
              options: {},
            },
          ],
        },
      ],
    },
  ],
  numberOfPriorsReferenced: 0,
};

export default hpIUScan;
