"use strict";


/* global  __SCRIPT_URI_SPEC__  */
/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "(startup|shutdown|install|uninstall)" }]*/

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "CloudStorageProviders",
  "resource://cloudstorage/CloudStorageProviders.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Services",
  "resource://gre/modules/Services.jsm");

/* Shield */
const CONFIGPATH = `${__SCRIPT_URI_SPEC__}/../Config.jsm`;
const { config } = Cu.import(CONFIGPATH, {});
const studyConfig = config.study;
const log = createLog(studyConfig.studyName, config.log.bootstrap.level);  // defined below.

const STUDYUTILSPATH = `${__SCRIPT_URI_SPEC__}/../${studyConfig.studyUtilsPath}`;
const { studyUtils } = Cu.import(STUDYUTILSPATH, {});


function install() {}
function uninstall() {}

async function startup(addonData, reason) {
  // addonData: Array [ "id", "version", "installPath", "resourceURI", "instanceID", "webExtension" ]  bootstrap.js:48
  log.debug("startup", REASONS[reason] || reason);

  studyUtils.setup({
    study: {
      studyName: studyConfig.studyName,
      endings: studyConfig.endings,
      telemetry: studyConfig.telemetry,
    },
    log: config.log,
    addon: {id: addonData.id, version: addonData.version},
  });
  studyUtils.setLoggingLevel(config.log.studyUtils.level);
  const variation = await chooseVariation();
  studyUtils.setVariation(variation);

  // Always set cloud.services.shieldstudy.expire pref if it's not set.
  // This is needed till opt-out expiration is supported in StudyUtils
  if (!Services.prefs.getCharPref(studyConfig.studyExpiredPref, "")) {
    const today = new Date();
    const expireDate = new Date(today.setDate(today.getDate() + studyConfig.studyDuration)).toString();
    Services.prefs.setCharPref(studyConfig.studyExpiredPref, expireDate);
  }

  if ((REASONS[reason]) === "ADDON_INSTALL") {
    studyUtils.firstSeen();  // sends telemetry "enter"
    const eligible = await config.isEligible(); // addon-specific
    if (!eligible) {
      // uses config.endings.ineligible.url if any,
      // sends UT for "ineligible"
      // then uninstalls addon
      await studyUtils.endStudy({reason: "ineligible"});
      return;
    }
  }
  await studyUtils.startup({reason});

  const expirationDate = new Date(Services.prefs.getCharPref(studyConfig.studyExpiredPref, ""));
  if (new Date() > expirationDate) {
    await studyUtils.endStudy({ reason: "expired" });
    return;
  }

  log.debug(`info ${JSON.stringify(studyUtils.info())}`);

  // Exit CloudStorageProviders.init() after
  // recording providers found on user desktop
  Services.prefs.setBoolPref("cloud.services.api.enabled", true);
  await CloudStorageProviders.init(studyUtils);
}

async function shutdown(addonData, reason) {
  log.debug("shutdown", REASONS[reason] || reason);
  // Services.obs.removeObserver(observe, "cloudstorage-prompt-notification");
  // are we uninstalling?
  // if so, user or automatic?
  if (reason === REASONS.ADDON_UNINSTALL || reason === REASONS.ADDON_DISABLE) {
    log.debug("uninstall or disable");
    Services.prefs.clearUserPref("cloud.services.api.enabled");
    if (!studyUtils._isEnding) {
      // we are the first requestors, must be user action.
      log.debug("user requested shutdown");
      studyUtils.endStudy({reason: "user-disable"});
    }
  }
}

/** CONSTANTS and other bootstrap.js utilities */

// addon state change reasons
const REASONS = {
  APP_STARTUP: 1,      // The application is starting up.
  APP_SHUTDOWN: 2,     // The application is shutting down.
  ADDON_ENABLE: 3,     // The add-on is being enabled.
  ADDON_DISABLE: 4,    // The add-on is being disabled. (Also sent during uninstallation)
  ADDON_INSTALL: 5,    // The add-on is being installed.
  ADDON_UNINSTALL: 6,  // The add-on is being uninstalled.
  ADDON_UPGRADE: 7,    // The add-on is being upgraded.
  ADDON_DOWNGRADE: 8,  // The add-on is being downgraded.
};
for (const r in REASONS) { REASONS[REASONS[r]] = r; }

// logging
function createLog(name, levelWord) {
  Cu.import("resource://gre/modules/Log.jsm");
  var L = Log.repository.getLogger(name);
  L.addAppender(new Log.ConsoleAppender(new Log.BasicFormatter()));
  L.level = Log.Level[levelWord] || Log.Level.Debug; // should be a config / pref
  return L;
}

async function chooseVariation() {
  let toSet, source;
  const sample = studyUtils.sample;
  if (studyConfig.variation) {
    source = "startup-config";
    toSet = studyConfig.variation;
  } else {
    source = "weightedVariation";
    // this is the standard arm choosing method
    const clientId = await studyUtils.getTelemetryId();
    const hashFraction = await sample.hashFraction(studyConfig.studyName + clientId, 12);
    toSet = sample.chooseWeighted(studyConfig.weightedVariations, hashFraction);
  }
  log.debug(`variation: ${toSet} source:${source}`);
  return toSet;
}
