
var path = require('path');

var config = module.exports = {
  debug: true,
  entry: ['./lib/index.js'],
  output: {
    path: __dirname,
    filename: 'index.js',
  },
  module: {
    preLoaders: [
      {
        test: /\.js$/,
        loader: 'eslint-loader',
      },
    ],
    loaders: [
      {
        test: /\.js$/,
        loader: 'babel-loader',
      },
    ],
  },
};
