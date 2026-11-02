// Pose on every frame of a video file.
// The browser stops decoding a video while the page is hidden (screen off, another app in front), so a
// seek stays pending until the screen comes back. Say that instead of leaving the progress frozen, and
// re-issue a seek the browser swallowed so one lost frame cannot end the whole run.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hiddenNow = () => globalThis.document?.hidden ?? false;

// detect(frameSource) -> pose or null. Returns one entry per sampled frame, null where nothing was seen.
export async function poseFrames(video, detect, { fps = 30, onProgress = () => {}, onWait = () => {}, hidden = hiddenNow, step = 100, wait = 3000 } = {}) {
  const n = Math.floor(video.duration * fps);
  const frames = [];
  for (let i = 0; i < n; i++) {
    frames.push(await poseAt(video, i / fps, detect, { hidden, onWait, step, wait }));
    onProgress((i + 1) / Math.max(1, n));
  }
  return frames;
}

// Seek to t, wait for the frame, detect. Time spent hidden does not use up the retries: a hidden page
// cannot decode at all, so wait for the screen and seek again.
async function poseAt(video, t, detect, { hidden, onWait, step, wait }) {
  let tries = 0;
  for (;;) {
    video.currentTime = t;
    let waited = 0;
    while ((video.seeking || video.readyState < 2) && waited < wait) { await sleep(step); waited += step; }
    if (!video.seeking && video.readyState >= 2) return detect(video);
    if (hidden()) {
      onWait();
      while (hidden()) await sleep(wait);
    } else if (++tries > 2) {
      return null;   // the decoder will not give this frame: leave a gap for the caller to fill
    }
  }
}
