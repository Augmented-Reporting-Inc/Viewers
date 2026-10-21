const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  displayName: 'extension-ar-learning',
  // Test local TS helpers without transforming Jest runtime dependencies.
  transformIgnorePatterns: ['/node_modules/'],
};
