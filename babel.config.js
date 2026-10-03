// babel-preset-expo already adds the react-native-worklets plugin. Adding it
// again breaks the worklets ExecuTorch uses to load models off the JS thread.
module.exports = {
  presets: ["babel-preset-expo"],
};
