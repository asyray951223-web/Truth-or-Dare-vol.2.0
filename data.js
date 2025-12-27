// === 資料庫 (Data) ===
// 將資料掛載到 window 物件，以便在主程式中存取

window.defaultGameData = window.defaultGameData || {};

// 初始化自定義題庫結構
if (!window.defaultGameData.custom) {
  window.defaultGameData.custom = {
    truth: [],
    dare: [],
  };
}
