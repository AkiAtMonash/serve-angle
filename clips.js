// Recorded serves waiting to go to Google Drive. Kept in IndexedDB so a crashed or reloaded tab or
// a dead connection loses nothing; a clip is deleted only after Drive says it is saved.

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
export const dropClip = c => tx("readwrite", s => s.delete(c.name));
