// webpack
import path from 'path'
import { fileURLToPath } from 'url'
import StatsPlugin from 'stats-webpack-plugin' // バンドルサイズ解析のため
import TerserPlugin from 'terser-webpack-plugin' // サイズ縮小プラグイン

// @ts-ignore
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcPath = path.join(__dirname, 'node_modules', 'nadesiko3', 'src')
const srcCorePath = path.join(__dirname, 'node_modules', 'nadesiko3', 'core', 'src')
const releasePath = path.join(__dirname, 'release')

// @ts-ignore
process.noDeprecation = true

// [args] --mode=(production|development)
const mode_ = (process.env.NODE_ENV) ? process.env.NODE_ENV : 'development'

const commonConfig = {
  mode: mode_,
  devtool: 'source-map',

  module: {
    rules: [
      // .jsx file
      {
        test: /\.jsx$/,
        loader: 'babel-loader',
        exclude: /node_modules/,
        include: [srcPath]
      },
      // .js file
      {
        test: /\.js$/,
        loader: 'babel-loader',
        exclude: /node_modules/,
        include: [srcPath]
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.(jpg|png)$/,
        loader: 'url-loader'
      }
    ]
  },

  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin()]
  }
}

export default [
  {
    ...commonConfig,
    target: ['web'],
    entry: {
      plugin_browser: [path.join(srcPath, 'plugin_browser.mjs')],
    },
    output: {
      clean: false,
      chunkFormat: false,
      path: releasePath,
      enabledLibraryTypes: ['module'],
      module: true,
      library: {
        type: 'module'
      },
      filename: '[name].js'
    },
    plugins: [
      new StatsPlugin('stats.browser.json', { chunkModules: true }, null) // バンドルサイズ解析
    ],
    resolve: {
      extensions: ['*', '.webpack.mjs', '.webpack.js', '.web.js', '.js', '.mjs', '.jsx'],
      mainFields: ['browser', 'main', 'module']
    },
    experiments: {
      outputModule: true
    }
  },
  {
    ...commonConfig,
    target: ['webworker'],
    entry: {
      wnako3webworker: [path.join(srcPath, 'wnako3webworker.mjs')], // plugin_system+plugin_browser_in_worker含む
    },
    output: {
      clean: false,
      chunkFormat: false,
      path: releasePath,
      enabledLibraryTypes: ['module'],
      module: true,
      library: {
        type: 'module'
      },
      filename: '[name].js'
    },
    plugins: [
      new StatsPlugin('stats.webworker.json', { chunkModules: true }, null) // バンドルサイズ解析
    ],
    resolve: {
      extensions: ['*', '.webpack.mjs', '.webpack.js', '.web.js', '.js', '.mjs', '.jsx'],
      mainFields: ['browser', 'main', 'module']
    },
    experiments: {
      outputModule: true
    }
  },
  {
    ...commonConfig,
    target: ['node18'],
    entry: {
      plugin_node: [path.join(srcPath, 'plugin_node.mjs')],
    },
    output: {
      clean: false,
      chunkFormat: false,
      path: releasePath,
      enabledLibraryTypes: ['module'],
      module: true,
      library: {
        type: 'module'
      },
      filename: '[name].mjs'
    },
    plugins: [
      new StatsPlugin('stats.node.json', { chunkModules: true }, null) // バンドルサイズ解析
    ],
    resolve: {
      extensions: ['*', '.webpack.mjs', '.webpack.js', '.node.js', '.js', '.mjs', '.jsx'],
      mainFields: ['main', 'module']
    },
    experiments: {
      outputModule: true
    }
  }
]
