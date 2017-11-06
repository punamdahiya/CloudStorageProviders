/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var {classes: Cc, interfaces: Ci, utils: Cu} = Components;

this.EXPORTED_SYMBOLS = [ "CloudStorageProviders" ];

Cu.importGlobalProperties(["fetch"]);
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "CloudStorage",
                                  "resource://gre/modules/CloudStorage.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "FileUtils",
                                  "resource://gre/modules/FileUtils.jsm");

/**
 * The external API exported by this module.
 */
var CloudStorageProviders = {
  studyUtils: null,                // Reference to shield StudyUtils.jsm
  /**
    * Init method to initialize cloud storage view and studyUtils property
    */
  async init(studyUtils) {
    try {
      if (!studyUtils) {
        Cu.reportError("CloudStorageView: Failed to initialize studyUtils");
        return;
      }
      this.studyUtils = studyUtils;

      // Get number of providers on user desktop and send data to telemetry.
      // Invoke getDownloadFolder on CloudStorage API to ensure API is initialized
      // This is workaround to force initialize API for first time enter to
      // ensure getStorageProviders call returns successfully.
      await CloudStorage.getDownloadFolder();
      let providers = await CloudStorage.getStorageProviders();
      let keys = [];
      if (providers.size > 0) {
        providers.forEach(async (value, key) => {
          if (key === "Dropbox") {
            await this._logProviderInfo(key, value);
          }
          keys.push(key);
        });
      }
      await this.studyUtils.telemetry({
        message: "addon_init",
        provider_count: providers.size.toString(),
        provider_keys: keys.join(","),
      });
    } catch (err) {
      Cu.reportError(err);
    }
  },

  async _logProviderInfo(key, value) {
    if (!value.discoveryPath) {
      return false;
    }

    let file = null;
    try {
      file = new FileUtils.File(value.discoveryPath);
    } catch (ex) {
      return false;
    }

    let data = await this._downloadJSON(Services.io.newFileURI(file).spec);

    if (!data) {
      return false;
    }

    // Check if user has basic or premium dropbox type in accounts available
    let type = data && data.personal && data.personal.subscription_type;
    if (type) {
      await this.studyUtils.telemetry({
        message: "subscription_type_1",
        value: data.personal.subscription_type,
      });
    }

    type = data && data.business && data.business.subscription_type;
    if (type) {
      await this.studyUtils.telemetry({
        message: "subscription_type_2",
        value: data.business.subscription_type,
      });
    }
  },

  async _downloadJSON(uri) {
    let json = null;
    try {
      let response = await fetch(uri);
      if (response.ok) {
        json = await response.json();
      }
    } catch (e) {
      Cu.reportError("Fetching " + uri + " results in error: " + e);
    }
    return json;
  },

};
