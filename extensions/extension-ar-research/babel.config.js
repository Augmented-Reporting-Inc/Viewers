module.exports = {
  plugins: [
    ['@babel/plugin-transform-class-properties', { loose: true }],
    '@babel/plugin-transform-typescript',
    ['@babel/plugin-transform-private-property-in-object', { loose: true }],
    ['@babel/plugin-transform-private-methods', { loose: true }],
  ],
  env: {
    test: {
      presets: [
        ['@babel/preset-env', { modules: 'commonjs', targets: { node: 'current' } }],
        '@babel/preset-react',
        '@babel/preset-typescript',
      ],
    },
    production: {
      presets: [
        ['@babel/preset-env', { modules: false }],
        '@babel/preset-react',
        '@babel/preset-typescript',
      ],
    },
    development: {
      presets: [
        ['@babel/preset-env', { modules: false }],
        '@babel/preset-react',
        '@babel/preset-typescript',
      ],
    },
  },
};
