const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')

config = require('./webpack.config')

config.plugins.push(new HtmlWebpackPlugin({}))
config.output.filename = "index.js"

config.devServer = {
  contentBase: path.resolve(__dirname),
  host: '0.0.0.0',
  https: true
}

module.exports = config
