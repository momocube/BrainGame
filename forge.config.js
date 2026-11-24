export default {
  packagerConfig: {
    asar: true,
    extraResource: ['runtime/touch-service', 'docs/704-operation-manual.md'],
    executableName: '704-Brain-Game',
    appBundleId: 'tw.704.braingame',
    ignore: [
      /^\/docs(?:\/|$)/,
      /^\/tests(?:\/|$)/,
      /^\/tmp(?:\/|$)/,
      /^\/data(?:\/|$)/,
      /^\/scripts(?:\/|$)/,
      /^\/runtime(?:\/|$)/,
      /^\/README\.md$/
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'sevenzerofourbraingame',
        authors: '704 Brain Game',
        description: '704 Brain Game Interactive Experience'
      }
    },
    { name: '@electron-forge/maker-zip', platforms: ['win32'] }
  ]
};
