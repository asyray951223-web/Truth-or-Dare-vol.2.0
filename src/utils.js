// PWA Service Worker Registration
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .then((registration) => {
        console.log(
          "ServiceWorker registration successful with scope: ",
          registration.scope
        );
      })
      .catch((err) => {
        console.log("ServiceWorker registration failed: ", err);
      });
  });
}

// LocalStorage 輔助函式：讀取存檔
window.getSavedState = (key, defaultValue) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
};

window.defaultPlayers = [
  {
    id: "p1",
    name: "默認玩家1",
    weight: 5,
    score: 0,
    history: { truth: 0, dare: 0, punishment: 0 },
  },
  {
    id: "p2",
    name: "默認玩家2",
    weight: 5,
    score: 0,
    history: { truth: 0, dare: 0, punishment: 0 },
  },
  {
    id: "p3",
    name: "默認玩家3",
    weight: 5,
    score: 0,
    history: { truth: 0, dare: 0, punishment: 0 },
  },
];
