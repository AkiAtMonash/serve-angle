// ここに貼る: Apps Script の /exec URL（例 https://script.google.com/macros/s/.../exec）
// 貼り替えるまで（空や「ここに貼る」のまま）は、これまでどおり画面の「DriveのURL」欄に入れた値を使う。
export const DRIVE_URL = "ここに貼る";

// 使うURLを決める。このファイルの値が優先で、URLらしくなければ画面で入れた値に回る。
export const chosenDriveUrl = typed => [DRIVE_URL, typed].map(s => String(s || "").trim()).find(s => s.startsWith("https://")) || "";
