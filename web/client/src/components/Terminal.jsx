import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

export default function Terminal({ scenarioId, commandBridgeRef }) {
  const hostRef = useRef(null);
  const terminalRef = useRef(null);
  const socketRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
    if (!hostRef.current || !scenarioId) return undefined;

    const fitAddon = new FitAddon();
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: "Cascadia Code, Fira Code, Menlo, Consolas, monospace",
      theme: {
        background: "#020617",
        foreground: "#e2e8f0"
      }
    });

    fitAddonRef.current = fitAddon;
    terminalRef.current = term;
    term.loadAddon(fitAddon);
    term.open(hostRef.current);
    fitAddon.fit();

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws/terminal/${scenarioId}`);
    socketRef.current = socket;

    const sendResize = () => {
      if (socket.readyState !== WebSocket.OPEN || !term.cols || !term.rows) return;
      socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    socket.addEventListener("open", () => {
      term.writeln("\x1b[32mConnected to terminal session.\x1b[0m");
      term.scrollToBottom();
      sendResize();
    });

    socket.addEventListener("message", (event) => {
      term.write(String(event.data || ""));
      term.scrollToBottom();
    });

    socket.addEventListener("close", () => {
      term.writeln("\r\n\x1b[31mTerminal disconnected.\x1b[0m");
      term.scrollToBottom();
    });

    const disposable = term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });

    const onResize = () => {
      fitAddon.fit();
      sendResize();
    };
    window.addEventListener("resize", onResize);

    if (commandBridgeRef) {
      commandBridgeRef.current = (command) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: "input", data: `${command}\n` }));
      };
    }

    return () => {
      if (commandBridgeRef) commandBridgeRef.current = null;
      window.removeEventListener("resize", onResize);
      disposable.dispose();
      socket.close();
      term.dispose();
    };
  }, [scenarioId, commandBridgeRef]);

  return <div ref={hostRef} className="h-full w-full overflow-hidden rounded-lg border border-slate-800" />;
}

