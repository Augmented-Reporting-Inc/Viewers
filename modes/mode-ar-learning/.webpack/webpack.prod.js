const path = require('path');
const pkg = require('../package.json');

const outputFile = 'index.umd.js';
const rootDir = path.resolve(__dirname, '../');
const outputFolder = path.join(__dirname, `../dist/umd/${pkg.name}/`);

// Todo: add ESM build for the mode in addition to umd build
const config = {
  mode: 'production',
  entry: rootDir + '/' + pkg.module,
  devtool: 'source-map',
  output: {
    path: outputFolder,
    filename: outputFile,
    library: pkg.name,
    libraryTarget: 'umd',
    chunkFilename: '[name].chunk.js',
    umdNamedDefine: true,
    globalObject: "typeof self !== 'undefined' ? self : this",
  },
  externals: [
    {
      react: {
        root: 'React',
        commonjs2: 'react',
        commonjs: 'react',
        amd: 'react',
      },
      '@ohif/core': {
        commonjs2: '@ohif/core',
        commonjs: '@ohif/core',
        amd: '@ohif/core',
        root: '@ohif/core',
      },
      '@ohif/ui': {
        commonjs2: '@ohif/ui',
        commonjs: '@ohif/ui',
        amd: '@ohif/ui',
        root: '@ohif/ui',
      },
      // Align with the longitudinal mode: keep OHIF's shared browser runtime
      // responsible for these libraries instead of bundling duplicate instances.
      // In particular, Cornerstone event targets and annotation state must be singletons.
      'i18next': {
        commonjs2: 'i18next',
        commonjs: 'i18next',
        amd: 'i18next',
        root: 'i18next',
      },
      '@cornerstonejs/core': {
        commonjs2: '@cornerstonejs/core',
        commonjs: '@cornerstonejs/core',
        amd: '@cornerstonejs/core',
        root: '@cornerstonejs/core',
      },
      '@cornerstonejs/tools': {
        commonjs2: '@cornerstonejs/tools',
        commonjs: '@cornerstonejs/tools',
        amd: '@cornerstonejs/tools',
        root: '@cornerstonejs/tools',
      },
      '@ohif/mode-longitudinal': {
        commonjs2: '@ohif/mode-longitudinal',
        commonjs: '@ohif/mode-longitudinal',
        amd: '@ohif/mode-longitudinal',
        root: '@ohif/mode-longitudinal',
      }
    },
  ],
  module: {
    rules: [
      {
        test: /\.svg?$/,
        oneOf: [
          {
            use: [
              {
                loader: '@svgr/webpack',
                options: {
                  svgoConfig: {
                    plugins: [
                      {
                        name: 'preset-default',
                        params: {
                          overrides: {
                            removeViewBox: false
                          },
                        },
                      },
                    ]
                  },
                  prettier: false,
                  svgo: true,
                  titleProp: true,
                },
              },
            ],
            issuer: {
              and: [/\.(ts|tsx|js|jsx|md|mdx)$/],
            },
          },
        ],
      },
      {
        test: /(\.jsx|\.js|\.tsx|\.ts)$/,
        loader: 'babel-loader',
        exclude: /(node_modules|bower_components)/,
        resolve: {
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      },
    ],
  },
  resolve: {
    modules: [path.resolve('./node_modules'), path.resolve('./src')],
    extensions: ['.json', '.js', '.jsx', '.tsx', '.ts'],
  },
};

module.exports = config;
