const path = require('path');
const base = require('../../jest.config.base.js');
const pkg = require('./package');

module.exports = {
  ...base,
  displayName: pkg.name,
  // Same workspace mapping as extensions/default/jest.config.js: @ohif/core's
  // `main` is an unbuilt UMD bundle, and @cornerstonejs 3.x exposes ESM only.
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '@ohif/(.*)': '<rootDir>/../../platform/$1/src',
    '^@cornerstonejs/(.*)$': '<rootDir>/../../node_modules/@cornerstonejs/$1/dist/esm',
  },
  // Tests only: use the monorepo root Babel config (as extensions/cornerstone
  // does). This package's own babel.config.js is kept for its build and has no
  // Node test target, which breaks transforming Jest's runtime.
  transform: {
    '^.+\\.[jt]sx?$': [
      'babel-jest',
      { configFile: path.resolve(__dirname, '../../babel.config.js') },
    ],
  },
};
