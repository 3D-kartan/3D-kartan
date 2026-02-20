"use strict";

const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");

// Path to Cesium's built distribution (Workers, Assets, Widgets, ThirdParty)
const cesiumSource = "node_modules/cesium/Build/Cesium";

// Base URL for Cesium static assets inside the final /dist folder.
// This must match CESIUM_BASE_URL below.
const cesiumBaseUrl = "cesiumStatic";

module.exports = {
  // Root directory for resolving entry points
  context: __dirname,

  // Main entry point of your application
  entry: {
    app: "./src/index.js",
  },

  // Output bundle configuration
  output: {
    filename: "app.js",                         // Final JS bundle name
    path: path.resolve(__dirname, "dist"),      // Output directory
    sourcePrefix: "",                           // Required for Cesium compatibility

    // Where asset/resource files (e.g., glTF, bin) should be emitted
    assetModuleFilename: "models/[name][ext]"
  },

  // Module resolution rules
  resolve: {
    mainFiles: ["index", "Cesium"],             // Helps Cesium resolve modules
    alias: {
      "@tools": path.resolve(__dirname, "src/tools"),           // Shortcut for tools
      "@imgs":  path.resolve(__dirname, "src/config/images")    // Shortcut for images
    }
  },

  module: {
    rules: [
      // CSS loader pipeline
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },

      // Inline small images and SVGs as base64
      {
        test: /\.(png|gif|jpg|jpeg|svg|xml)$/,
        type: "asset/inline",
      },

      // GLTF/GLB/BIN models copied as separate files
      {
        test: /\.(gltf|glb|bin)$/,
        type: "asset/resource",
      },

      // JSON files imported as JSON modules
      {
        test: /\.json$/,
        type: "json",
      },
    ],
  },

  plugins: [
    // Generates index.html in /dist and injects the JS bundle
    new HtmlWebpackPlugin({
      template: "src/index.html",
    }),

    // Copies Cesium's required static assets into /dist/cesiumStatic/
    new CopyWebpackPlugin({
      patterns: [
        // Cesium core assets
        {
          from: path.join(cesiumSource, "Workers"),
          to: `${cesiumBaseUrl}/Workers`,
        },
        {
          from: path.join(cesiumSource, "ThirdParty"),
          to: `${cesiumBaseUrl}/ThirdParty`,
        },
        {
          from: path.join(cesiumSource, "Assets"),
          to: `${cesiumBaseUrl}/Assets`,
        },
        {
          from: path.join(cesiumSource, "Widgets"),
          to: `${cesiumBaseUrl}/Widgets`,
        },

        // Custom project folders
        { from: "buildings", to: "buildings" },

        // Application icons and images
        {
          from: path.resolve(__dirname, "src/config/images"),
          to: "images"
        },

        // 3D models used by the placement tool
        {
          from: path.resolve(__dirname, "src/tools/placement/models"),
          to: "models"
        },

        // Project data folder
        {
          from: path.resolve(__dirname, "projects"),
          to: "projects"
        },

        // Main configuration file
        {
          from: path.resolve(__dirname, "public/index.json"),
          to: "index.json"
        }
      ],
    }),

    // Defines the base URL Cesium uses at runtime to load its assets
    new webpack.DefinePlugin({
      CESIUM_BASE_URL: JSON.stringify(cesiumBaseUrl),
    }),
  ],
  devServer: { 
    static: { 
      directory: path.join(__dirname, "dist"), 
    }, 
    hot: false, // Cesium does NOT support HMR 
    liveReload: true, // Use live reload instead 
    open: true, watchFiles: ["src/**/*", "public/**/*"], 
  },
  // Development mode (should be changed to "production" for final builds)
  mode: "production",

  // Fast source maps for development, (change to "source-map" or false for final builds)
  devtool: false,
};
