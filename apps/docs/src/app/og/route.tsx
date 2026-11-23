import { renderLabsOg } from "./labs-og";

export async function GET() {
  return renderLabsOg({ product: "wterm", title: "Terminal emulator for the web" });
}
