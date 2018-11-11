const path = require('path');
const webpack = require('webpack');

const config = {
  entry: './src/index.js',
  mode: 'development',
  output: {
    path: path.resolve(__dirname, 'public/js'),
    filename: 'index.main.js'
  },
  devtool: 'cheap-eval-source-map',
  module: {
    rules: [
      {test: /\.(js|jsx)$/, use: 'babel-loader', exclude: /node_modules/},
      {
        test: /node_modules\/vanilla-jsx\/lib\/.*\.(js|jsx)$/,
        use: 'babel-loader'
      },
      {
        test: /\.scss$/,
        use: [{
            loader: "style-loader" // creates style nodes from JS strings
        }, {
            loader: "css-loader" // translates CSS into CommonJS
        }, {
            loader: "sass-loader" // compiles Sass to CSS
        }]
    }]
  },
  node: {
    fs: 'empty'
  },
};

module.exports = config;