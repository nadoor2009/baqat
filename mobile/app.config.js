const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const iosFile = process.env.GOOGLE_SERVICE_INFO_PLIST || './GoogleService-Info.plist';
  const androidFile = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
  const iosReady = fs.existsSync(path.resolve(__dirname, iosFile));
  const androidReady = fs.existsSync(path.resolve(__dirname, androidFile));
  return {
    ...config,
    ios: { ...config.ios, ...(iosReady ? { googleServicesFile: iosFile } : {}) },
    android: { ...config.android, ...(androidReady ? { googleServicesFile: androidFile } : {}) },
    plugins: [
      ...(config.plugins || []),
      ['expo-build-properties', { ios: { useFrameworks: 'dynamic' } }],
      ...(iosReady || androidReady ? ['@react-native-firebase/app'] : []),
      ...(iosReady ? ['@react-native-firebase/auth'] : []),
    ],
  };
};
