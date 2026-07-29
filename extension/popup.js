var DEFAULTS = { enabled: true, autoOpen: true, disabledHosts: [] };
var enabledEl = document.getElementById("enabled");
var autoOpenEl = document.getElementById("autoOpen");
var hostEl = document.getElementById("host");
var toggleHostBtn = document.getElementById("toggleHost");
var currentHost = null;

function render(settings) {
  enabledEl.checked = !!settings.enabled;
  autoOpenEl.checked = !!settings.autoOpen;
  var disabled = settings.disabledHosts || [];
  if (currentHost) {
    hostEl.textContent = currentHost;
    toggleHostBtn.textContent = disabled.indexOf(currentHost) !== -1 ? "Enable here" : "Disable here";
    toggleHostBtn.style.display = "";
  } else {
    hostEl.textContent = "";
    toggleHostBtn.style.display = "none";
  }
}

function load(cb) { chrome.storage.sync.get(DEFAULTS, cb); }

chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
  try {
    var url = tabs && tabs[0] && tabs[0].url;
    if (url && /^https?:/.test(url)) currentHost = new URL(url).hostname;
  } catch (e) {}
  load(render);
});

enabledEl.addEventListener("change", function () {
  chrome.storage.sync.set({ enabled: enabledEl.checked });
});
autoOpenEl.addEventListener("change", function () {
  chrome.storage.sync.set({ autoOpen: autoOpenEl.checked });
});
toggleHostBtn.addEventListener("click", function () {
  if (!currentHost) return;
  load(function (settings) {
    var disabled = settings.disabledHosts || [];
    var idx = disabled.indexOf(currentHost);
    if (idx === -1) disabled.push(currentHost); else disabled.splice(idx, 1);
    chrome.storage.sync.set({ disabledHosts: disabled }, function () { load(render); });
  });
});
