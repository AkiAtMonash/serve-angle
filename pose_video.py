# Pose on every 1/30 s of a video, for the "add a reference video" job the app sends to this PC.
# python pose_video.py IN.mp4 OUT.json [lite|full|heavy]
import json, os, sys, urllib.request
import cv2
import mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions

FPS = 30
MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_{n}/float16/latest/pose_landmarker_{n}.task"
DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".work")


def model_path(name):
    path = os.path.join(DIR, f"pose_{name}.task")
    if not os.path.exists(path):
        os.makedirs(DIR, exist_ok=True)
        urllib.request.urlretrieve(MODEL.format(n=name), path)
    return path


def main():
    src, out = sys.argv[1], sys.argv[2]
    name = sys.argv[3] if len(sys.argv) > 3 else "lite"
    lm = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model_path(name)),
        running_mode=vision.RunningMode.VIDEO, num_poses=1))
    cap = cv2.VideoCapture(src)
    cap.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)          # phone videos can carry a rotation flag
    fps = cap.get(cv2.CAP_PROP_FPS) or FPS
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frames, i = [], 0
    while True:
        ok, img = cap.read()
        if not ok:
            break
        t = i / fps
        if t + 1e-6 >= len(frames) / FPS:              # this frame is at or past the next 1/30 s sample
            r = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB)), int(t * 1000))
            frames.append([[p.x, p.y, p.z, p.visibility] for p in r.pose_landmarks[0]] if r.pose_landmarks else None)
        i += 1
    lm.close()
    cap.release()
    if frames and img is not None:
        height, width = img.shape[:2]
    json.dump({"fps": FPS, "sourceFps": fps, "width": width, "height": height, "frames": frames},
              open(out, "w", encoding="utf-8"))
    print(f"{len(frames)} frames", file=sys.stderr)


main()
