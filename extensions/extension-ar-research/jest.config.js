const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  displayName: 'extension-ar-research',
  transformIgnorePatterns: ['/node_modules/'],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    // Resolve the actual calculated-RVSP helper without loading viewer panels.
    '^extension-ar-measurements$':
      '<rootDir>/../extension-ar-measurements/src/utils/rightHeartMeasurements.ts',
  },
};
