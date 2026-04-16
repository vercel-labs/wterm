import { WTerm } from "@wterm/dom";
import { BashShell } from "@wterm/just-bash";
import "@wterm/dom/css";

const container = document.getElementById("terminal")!;

const term = new WTerm(container);

term.init().then(() => {
  const shell = new BashShell({
    files: {
      "/home/user/README.md":
        "# wterm Vite Example\n\nThis terminal is running entirely in the browser.\n",
      "/home/user/hello.sh": '#!/bin/bash\necho "Hello from wterm!"\n',
    },
    greeting: "Welcome to wterm! Type 'help' to get started.",
  });

  shell.attach(term.write.bind(term));
  term.onData = (data: string) => shell.handleInput(data);
});
