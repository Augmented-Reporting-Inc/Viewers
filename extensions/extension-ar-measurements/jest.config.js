const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  displayName: 'extension-ar-measurements',
  // The monorepo base config transforms all dependencies, including Jest's own
  // runtime, which crashes under newer Babel versions. Test only our TS code.
  transformIgnorePatterns: ['/node_modules/'],
};
