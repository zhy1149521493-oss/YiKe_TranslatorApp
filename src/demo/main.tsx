import React from "react";
import { createRoot } from "react-dom/client";
import { DemoApp } from "./DemoApp";
import "./theme.css";
import "./layouts.css";
import "./settings.css";
import "./floating.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DemoApp />
  </React.StrictMode>,
);
