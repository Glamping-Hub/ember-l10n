'use strict';

const fs = require('fs');
const path = require('path');

const MetaPlaceholder = '__ember-l10n__LocaleAssetMapPlaceholder__';
const fastbootAssetMapModulePath = 'assets/fastboot-locale-asset-map.js';

module.exports = {
  name: require('./package').name,

  includedCommands() {
    return {
      'l10n:install': require('./lib/commands/install'),
      'l10n:extract': require('./lib/commands/extract'),
      'l10n:convert': require('./lib/commands/convert'),
      'l10n:sync': require('./lib/commands/sync')
    };
  },

  treeForFastBoot(tree) {
    this._isFastBoot = true;

    return tree;
  },

  /**
   * By default, during runtime the l10n service reads the asset map
   * information from a meta tag on the index.html. As we do not have access to
   * global `document` when running in FastBoot, we need to implement a
   * different way to access this asset-map information. See
   * `get-locale-asset-map` where we require the `asset-map` module that is
   * generated in the postBuild() below.
   */
  updateFastBootManifest(manifest) {
    manifest.vendorFiles.push(fastbootAssetMapModulePath);

    return manifest;
  },

  contentFor(type, config) {
    if (type !== 'head' || config._emberL10nContentForInvoked) {
      return;
    }

    // To prevent the tag of being included multiple times, e.g. when used in engines
    config._emberL10nContentForInvoked = true;
    return `<meta name="ember-l10n:localeAssetMap" content="${MetaPlaceholder}">`;
  },

  postBuild(build) {
    this._super.postBuild.apply(this, arguments);

    let env = process.env.EMBER_ENV;
    let l10nConfig = this.project.config(env)['ember-l10n'] || {};

    let fingerprintPrepend = '/';

    let localeAssetDirectoryPath = l10nConfig.jsonPath || 'assets/locales';

    let dirPath = path.join(build.directory, localeAssetDirectoryPath);
    let files = fs.readdirSync(dirPath);

    // Prepend the URL of the asset with the location defined in fingerprint options.
    let fingerprintOptions =
      this.app && this.app.options && this.app.options.fingerprint;

    if (
      fingerprintOptions &&
      fingerprintOptions.enabled &&
      fingerprintOptions.prepend
    ) {
      fingerprintPrepend = this.app.options.fingerprint.prepend;
    }

    if (
      fingerprintOptions &&
      fingerprintOptions.enabled &&
      (!fingerprintOptions.extensions ||
        !fingerprintOptions.extensions.includes('json'))
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        `
You need to ensure that .json files are fingerprinted for ember-l10n to work.
To make this work, add something like this to your ember-cli-build.js:

fingerprint: {
  extensions: ['js', 'css', 'png', 'jpg', 'gif', 'map', 'svg', 'json']
}
`
      );
    }

    let fullFilePaths = files.map((assetFileName) => {
      return [fingerprintPrepend, localeAssetDirectoryPath, assetFileName]
        .map((pathPart) => {
          // Remove trailing slashes to avoid double slashes when joining
          return pathPart.replace(/\/$/, '');
        })
        .join('/');
    });

    let assetMap = {};
    fullFilePaths.forEach((assetFilePath) => {
      let fileName = path.basename(assetFilePath, '.json');

      // Extract locale without fingerprint
      // This works e.g. for 'en', as well as for 'en-XXXXXXXXXXX'
      let [localeName] = fileName.split('-');

      assetMap[localeName] = assetFilePath;
    });

    let indexFilePath = path.join(build.directory, 'index.html');
    let testsIndexFilePath = path.join(build.directory, 'tests', 'index.html');

    replacePlaceholder(indexFilePath, assetMap);
    replacePlaceholder(testsIndexFilePath, assetMap);

    // For FastBoot, we embed all the locales right away
    // As we cannot use XMLHttpRequest there to fetch them
    if (this._isFastBoot) {
      let assetModulePath = `${build.directory}/${fastbootAssetMapModulePath}`;

      let localeData = {};
      Object.keys(assetMap).forEach((locale) => {
        let filePath = path.join(build.directory, assetMap[locale]);
        let localeContent = fs.readFileSync(filePath, 'utf-8');
        localeData[locale] = localeContent;
      });

      fs.writeFileSync(
        assetModulePath,
        `define('ember-l10n/fastboot-locale-asset-map', [], function () {
          return {
            'default': ${JSON.stringify(localeData)},
            __esModule: true,
          };
        });`
      );
    }
  }
};

function replacePlaceholder(filePath, assetMap) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  let assetMapString = encodeURIComponent(JSON.stringify(assetMap));
  let fileBody = fs.readFileSync(filePath, { encoding: 'utf-8' });
  fs.writeFileSync(filePath, fileBody.replace(MetaPlaceholder, assetMapString));
}
