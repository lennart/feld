const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')

config = require('./webpack.config')

config.plugins.push(new HtmlWebpackPlugin({
  templateParameters: {
    apiUrl: 'https://127.0.0.1:5000',
    progressionId: 1
  }
}))
config.output.filename = "index.js"

config.devServer = {
  contentBase: path.resolve(__dirname),
  host: '0.0.0.0',
  https: true
}

module.exports = config
