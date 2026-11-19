import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App";
import "@/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// React 挂载成功后移除启动 splash（index.html 内联，深浅色自适应）
document.getElementById("splash")?.remove();
