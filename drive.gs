// Google Apps Script that receives each serve clip from the app and saves it in the "PJ_TennisServe"
// folder of My Drive (made on the first clip).
//
// Setup, once:
//   1. script.google.com → New project → replace Code.gs with this file → Save.
//   2. Deploy → New deployment → type: Web app. Execute as: Me. Who has access: Anyone → Deploy,
//      and allow the Drive access it asks for.
//   3. Copy the web app URL (ends in /exec) into "DriveのURL" on the app's home screen.
// The URL is the only key: anyone who has it can add files to that folder, so don't share it.

function doPost(e) {
  const { name, mime, data } = JSON.parse(e.postData.contents);
  const found = DriveApp.getFoldersByName("PJ_TennisServe");
  const folder = found.hasNext() ? found.next() : DriveApp.createFolder("PJ_TennisServe");
  // A retry after a lost reply must not make a second copy.
  if (!folder.getFilesByName(name).hasNext()) folder.createFile(Utilities.newBlob(Utilities.base64Decode(data), mime, name));
  return ContentService.createTextOutput("ok");
}
