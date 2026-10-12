import React from "react";
import { createRoot } from "react-dom/client";
import SubmissionDemo from "./SubmissionDemo";
import "./submissionDemo.css";

const root = document.getElementById("root");
if (!root) throw new Error("The IntoFrame demo root element is missing.");

createRoot(root).render(
  <React.StrictMode>
    <SubmissionDemo />
  </React.StrictMode>,
);

