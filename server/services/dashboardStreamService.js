const { EventEmitter } = require('events');
const { getDb } = require('./firebaseService');

const dashboardStream = new EventEmitter();
dashboardStream.setMaxListeners(0);

let initialized = false;
let lastEventId = '';

function ensureDashboardStreamListener() {
  if (initialized) return;
  initialized = true;

  const db = getDb();
  db.ref('dashboard_events/messages').on('value', (snapshot) => {
    const event = snapshot.val();
    if (!event?.id || event.id === lastEventId) return;

    lastEventId = event.id;
    dashboardStream.emit('message', event);
  });
}

function subscribeDashboardStream(handler) {
  ensureDashboardStreamListener();
  dashboardStream.on('message', handler);

  return () => {
    dashboardStream.off('message', handler);
  };
}

module.exports = {
  ensureDashboardStreamListener,
  subscribeDashboardStream,
};
