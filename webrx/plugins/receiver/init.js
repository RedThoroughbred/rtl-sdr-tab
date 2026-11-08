// Receiver plugins for Wildcat RF. OpenWebRX+ loads static/plugins/receiver/init.js on the
// receiver page; docker-compose.yml mounts this file there read-only.
//
// Local plugins only: nothing is fetched from the internet. "wildcat" is
// static/plugins/receiver/wildcat/wildcat.js (+ wildcat.css): the "Send to Radio tab" button,
// the Wildcat panel, the controls' tooltips and "?" guide, and the iPhone reload-loop fix.
// See webrx/README.md.

Plugins.load('wildcat');
