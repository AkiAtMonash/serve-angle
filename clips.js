// Serves recorded in continuous mode, waiting to go to Google Drive. Kept in IndexedDB so a crashed or
// reloaded tab loses nothing; a clip is deleted only after you say the sent ones reached Drive.

// Android Chrome shares at most 10 files and 50 MB per navigator.share call
// (MAX_SHARED_FILE_COUNT / MAX_SHARED_FILE_BYTES in Chromium's ShareServiceImpl.java).
export const SHARE = { files: 10, bytes: 50 * 1024 * 1024 };

// The first clips that fit in one share. A single clip over the byte limit still goes alone
// (the share then fails and app.js falls back to a download).
export function nextBatch(clips, lim = SHARE) {
  const out = [];
  let bytes = 0;
  for (const c of clips) {
    if (out.length && (out.length >= lim.files || bytes + c.blob.size > lim.bytes)) break;
    out.push(c); bytes += c.blob.size;
  }
  return out;
}

let db = null;
function tx(mode, fn) {
  db ??= new Promise((res, rej) => {
    const r = indexedDB.open("serve-angle", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("clips", { keyPath: "name" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return db.then(d => new Promise((res, rej) => {
    const t = d.transaction("clips", mode), q = fn(t.objectStore("clips"));
    t.oncomplete = () => res(q?.result);
    t.onerror = () => rej(t.error);
  }));
}

export const addClip = clip => tx("readwrite", s => s.put(clip));
export const allClips = () => tx("readonly", s => s.getAll());
export const markSent = clips => tx("readwrite", s => clips.forEach(c => s.put({ ...c, sent: true })));
export const dropSent = clips => tx("readwrite", s => clips.forEach(c => s.delete(c.name)));
