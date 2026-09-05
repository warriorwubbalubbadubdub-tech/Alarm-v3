// Alarm PWA Service Worker
const CACHE_NAME = 'alarm-app-v3';
const STATE_CACHE_NAME = 'alarm-app-state-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './alarm.mp3'
];

let alarmTimeoutId = null;
let scheduledFireAt = null;

async function persistScheduledFireAt(fireAt){
  try{
    const cache = await caches.open(STATE_CACHE_NAME);
    if(fireAt === null){
      await cache.delete('/__alarm_state__');
    }else{
      await cache.put('/__alarm_state__', new Response(JSON.stringify({fireAt})));
    }
  }catch(e){}
}

async function readPersistedFireAt(){
  try{
    const cache = await caches.open(STATE_CACHE_NAME);
    const res = await cache.match('/__alarm_state__');
    if(!res) return null;
    const data = await res.json();
    return typeof data.fireAt === 'number' ? data.fireAt : null;
  }catch(e){
    return null;
  }
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(ASSETS).catch(() => {})
    )
  );
});

self.addEventListener('activate', event => {
  const keep = [CACHE_NAME, STATE_CACHE_NAME];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).catch(() => cached)
    )
  );
});

function clearScheduledAlarm(){
  if(alarmTimeoutId !== null){
    clearTimeout(alarmTimeoutId);
    alarmTimeoutId = null;
  }
  scheduledFireAt = null;
  persistScheduledFireAt(null);

  self.registration.getNotifications({tag:'alarm-armed'}).then(notifs => {
    notifs.forEach(n => n.close());
  });
}

function scheduleAlarm(fireAt){
  clearScheduledAlarm();
  scheduledFireAt = fireAt;
  persistScheduledFireAt(fireAt);

  const delay = fireAt - Date.now();
  if(delay <= 0){
    fireAlarmNow();
    return;
  }

  alarmTimeoutId = setTimeout(fireAlarmNow, delay);

  const target = new Date(fireAt);
  const timeStr = target.toLocaleTimeString([], {
    hour:'numeric',
    minute:'2-digit'
  });

  self.registration.showNotification('Alarm armed', {
    body:'Set for ' + timeStr + '. Keep the app open in the background for the most reliable ring.',
    tag:'alarm-armed',
    silent:true,
    requireInteraction:false
  });
}

function fireAlarmNow(){
  alarmTimeoutId = null;
  scheduledFireAt = null;
  persistScheduledFireAt(null);

  self.registration.getNotifications({tag:'alarm-armed'}).then(notifs => {
    notifs.forEach(n => n.close());
  });

  self.clients.matchAll({
    includeUncontrolled:true,
    type:'window'
  }).then(clients => {
    clients.forEach(client => {
      client.postMessage({type:'ALARM_FIRED'});
    });

    self.registration.showNotification('Alarm', {
      body:'Your alarm is ringing — tap to open.',
      tag:'alarm-ring',
      requireInteraction:true,
      silent:false,
      vibrate:[500,300,500,300,500]
    });
  });
}

self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({
      type:'window',
      includeUncontrolled:true
    }).then(clientList => {
      for(const client of clientList){
        if('focus' in client){
          client.postMessage({type:'ALARM_FIRED'});
          return client.focus();
        }
      }

      if(self.clients.openWindow){
        return self.clients.openWindow('./index.html');
      }
    })
  );
});

self.addEventListener('message', event => {
  const data = event.data;
  if(!data || !data.type) return;

  if(data.type === 'SCHEDULE_ALARM' && typeof data.fireAt === 'number'){
    scheduleAlarm(data.fireAt);
  }else if(data.type === 'CANCEL_ALARM'){
    clearScheduledAlarm();
  }
});

self.addEventListener('periodicsync', event => {
  if(event.tag === 'alarm-check'){
    event.waitUntil((async () => {
      let target = scheduledFireAt;

      if(target === null){
        target = await readPersistedFireAt();
      }

      if(target !== null && Date.now() >= target){
        fireAlarmNow();
      }
    })());
  }
});
