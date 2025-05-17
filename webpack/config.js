const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");
const webpack = require("webpack");
const Dotenv = require('dotenv-webpack');

module.exports = {
    mode: "development",
    devtool: "eval-source-map",
    entry: "./src/index.js",
    output: {
        path: path.resolve(process.cwd(), 'dist'),
        filename: "bundle.min.js"
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: "babel-loader"
                }
            },
            {
                test: [/\.vert$/, /\.frag$/],
                use: "raw-loader"
            },
            {
                test: /\.(gif|png|jpe?g|svg|xml|glsl)$/i,
                use: "file-loader"
            }
        ]
    },
    plugins: [
        new CleanWebpackPlugin({
            cleanOnceBeforeBuildPatterns: [path.join(__dirname, "dist/**/*")]
        }),
        new Dotenv({
            path: './.env', // Path to .env file
            safe: true, // Ensure all variables in .env.example are defined in .env
            systemvars: true, // Load system variables as well
        }),
        new webpack.DefinePlugin({
            "typeof CANVAS_RENDERER": JSON.stringify(true),
            "typeof WEBGL_RENDERER": JSON.stringify(true),
            "typeof WEBGL_DEBUG": JSON.stringify(true),
            "typeof EXPERIMENTAL": JSON.stringify(true),
            "typeof PLUGIN_3D": JSON.stringify(false),
            "typeof PLUGIN_CAMERA3D": JSON.stringify(false),
            "typeof PLUGIN_FBINSTANT": JSON.stringify(false),
            "typeof FEATURE_SOUND": JSON.stringify(true)
        }),
        new HtmlWebpackPlugin({
            template: "./index.html"
        })
    ]
};