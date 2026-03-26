const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { container } = require('webpack');

const { ModuleFederationPlugin } = container;

module.exports = {
  entry: './src/main.tsx',
  output: {
    filename: '[name].[contenthash].js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: 'auto',
    clean: true
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
    alias: {
      '@toolbox/sdk': path.resolve(__dirname, 'packages/sdk/src')
    }
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'toolboxHost',
      filename: 'remoteEntry.js',
      exposes: {},
      remotes: {},
      shared: {
        react: {
          singleton: true,
          eager: true,
          requiredVersion: false
        },
        'react-dom': {
          singleton: true,
          eager: true,
          requiredVersion: false
        },
        '@toolbox/sdk': {
          singleton: true,
          eager: true,
          requiredVersion: false
        }
      }
    }),
    new HtmlWebpackPlugin({
      template: './public/index.html'
    })
  ],
  devServer: {
    port: 3000,
    hot: true,
    historyApiFallback: true
  }
};
