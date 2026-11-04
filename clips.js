// Recorded serves waiting to go to Google Drive, and the reference videos added on the phone. Both are
// kept in IndexedDB so a crashed or reloaded tab loses nothing; a clip is deleted only after Drive says
// it is saved, and the references are what lets the app work with no PC around.

const STORES = { clips: "name", refs: "id" };   // store -> key path
let db = null;
function tx(store, mode, fn) {
  db ??= new Promise((res, rej) => {
    const r = indexedDB.open("serve-angle", 2);
    r.onupgradeneeded = () => {
      for (const [name, keyPath] of Object.entries(STORES))
        if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name, { keyPath });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return db.then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode), q = fn(t.objectStore(store));
    t.oncomplete = () => res(q?.result);
    t.onerror = () => rej(t.error);
  }));
}

export const addClip = clip => tx("clips", "readwrite", s => s.put(clip));
export const allClips = () => tx("clips", "readonly", s => s.getAll());
export const dropClip = c => tx("clips", "readwrite", s => s.delete(c.name));
// A reference added on the phone, with the video file it was estimated from (kept so the review can
// show it side by side).
export const putRef = (ref, video) => tx("refs", "readwrite", s => s.put({ ...ref, video }));
export const allRefs = () => tx("refs", "readonly", s => s.getAll());
export const dropRef = id => tx("refs", "readwrite", s => s.delete(id));
export const setFav = (name, fav) => tx("clips", "readwrite", s => { s.get(name).onsuccess = e => e.target.result && s.put({ ...e.target.result, fav }); });
// A favourite gets "_fav" in the Drive file name, so the PC can find it among the clips.
export const favName = name => name.replace(/(\.\w+)$/, "_fav$1");
