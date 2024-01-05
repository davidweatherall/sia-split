//webpack.config.js
const path = require('path');

module.exports = {
  mode: "development",
  devtool: "inline-source-map",
  target: 'electron-renderer',
  entry: {
    main: "./src/index.tsx",
  },
  output: {
    path: path.resolve(__dirname, './assets'),
    filename: "app.js" // <--- Will be compiled to this single file
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".css"],
  },
  module: {
    rules: [
      { 
        test: /\.tsx?$/,
        loader: "ts-loader",
        // exclude the output directory
        exclude: path.resolve(__dirname, 'output'),
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ],
  }
};