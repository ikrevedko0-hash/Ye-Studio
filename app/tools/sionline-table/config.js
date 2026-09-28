// Настройки SIOnline (как assets/config.js), но без адресов серверов: прогон идёт без сети.
var config = {
  serverDiscoveryUri: "",
  rootUri: "/",
  ads: "",
  rewriteUrl: false,
  forceHttps: false,
  registerServiceWorker: false,
  enableNoSleep: false,
  askForConsent: false,
  siStatisticsServiceUri: "",
  appRegistryServiceUri: "",
  clearUrls: false,
};
var firebaseConfig = null;
var onLoad = function () {};
