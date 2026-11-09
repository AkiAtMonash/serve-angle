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
// show it side by side). The angle it was shot from rides along, so the home screen can file it.
export const putRef = (ref, video) => tx("refs", "readwrite", s => s.put({ ...ref, video }));
export const allRefs = () => tx("refs", "readonly", s => s.getAll());
export const dropRef = id => tx("refs", "readwrite", s => s.delete(id));
// The memo ("what I was watching for") rides with the favourite, so it can be sent beside the clip later.
export const setFav = (name, fav, memo) => tx("clips", "readwrite", s => {
  s.get(name).onsuccess = e => e.target.result && s.put({ ...e.target.result, fav, memo });
});
// A favourite gets "_fav" in the Drive file name, so the PC can find it among the clips.
export const favName = name => name.replace(/(\.\w+)$/, "_fav$1");
// Its memo is a small .txt next to the clip in the same Drive folder.
export const memoName = name => favName(name).replace(/\.\w+$/, ".txt");
// The figure (your serve beside the pro's, at contact) is a PNG with the same _fav name.
export const figName = name => favName(name).replace(/\.\w+$/, ".png");
// Keep the figure with the clip so it travels to Drive with it.
export const setFig = (name, fig) => tx("clips", "readwrite", s => {
  s.get(name).onsuccess = e => e.target.result && s.put({ ...e.target.result, fig });
});
const pad = n => String(n).padStart(2, "0");
export const stamp = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
// One .txt per practice session: the name carries the date, so the PC can sort them.
export const notesName = (d = new Date()) => `serve_notes_${stamp(d)}.txt`;
