import { mount } from "svelte";
import "./style.css";
import "@wterm/svelte/css";
import App from "./App.svelte";

mount(App, {
  target: document.getElementById("app")!,
});
