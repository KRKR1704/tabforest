// D-8: asks for the optional "tabGroups" permission the first time the user clicks a Restore button.
// Chrome only shows the prompt for a click, and the service worker has no click, so this runs in the Grove page.
// The click is held back until the question is answered, then repeated, so the first restore is already grouped.
// If nobody answers within WAIT_MS (a prompt that never shows, an automated browser), the click goes through anyway:
// the button must never stay dead. A late "yes" applies to the next restore.
(function () {
  var pattern = /\brestore\b/i;
  var permission = { permissions: ['tabGroups'] };
  var replaying = false;
  var decided = false;
  var WAIT_MS = 15000;
  if (!(typeof chrome !== 'undefined' && chrome.permissions)) return;
  document.addEventListener('click', function (event) {
    if (replaying || decided || !event.isTrusted) return;
    var target = event.target instanceof Element ? event.target.closest('button, [role="button"], a') : null;
    if (!target || !pattern.test(target.textContent || '')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    var replay = function () {
      replaying = true;
      try { target.click(); } finally { replaying = false; }
    };
    var answer = chrome.permissions.contains(permission).then(function (has) {
      if (has) return true;
      return chrome.permissions.request(permission);
    }).catch(function () { return false; });
    var giveUp = new Promise(function (resolve) { setTimeout(function () { resolve(false); }, WAIT_MS); });
    Promise.race([answer, giveUp]).then(function () {
      decided = true; // ask once per page load; a "no" means plain tabs
      replay();
    });
  }, true);
})();
