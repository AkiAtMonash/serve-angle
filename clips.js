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
// The memo ("what I was watching for") rides with the favourite, so it can be sent beside the clip later.
export const setFav = (name, fav, memo) => tx("readwrite", s => {
  s.get(name).onsuccess = e => e.target.result && s.put({ ...e.target.result, fav, memo });
});
// A favourite gets "_fav" in the Drive file name, so the PC can find it among the clips.
export const favName = name => name.replace(/(\.\w+)$/, "_fav$1");
// Its memo is a small .txt next to the clip in the same Drive folder.
export const memoName = name => favName(name).replace(/\.\w+$/, ".txt");
// The figure (your serve beside the pro's, at contact) is a PNG with the same _fav name.
export const figName = name => favName(name).replace(/\.\w+$/, ".png");
// Keep the figure with the clip so it travels to Drive with it.
export const setFig = (name, fig) => tx("readwrite", s => {
  s.get(name).onsuccess = e => e.target.result && s.put({ ...e.target.result, fig });
});
const pad = n => String(n).padStart(2, "0");
export const stamp = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
// One .txt per practice session: the name carries the date, so the PC can sort them.
export const notesName = (d = new Date()) => `serve_notes_${stamp(d)}.txt`;
