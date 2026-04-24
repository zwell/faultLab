import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

export default function Terminal({ scenarioId, commandBridgeRef, focusBridgeRef }) {
  const hostRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!hostRef.current || !scenarioId) return undefined;

    let disposed = false;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    let hasRequestedPrompt = false;

    const fitAddon = new FitAddon();
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: "Cascadia Code, Fira Code, Menlo, Consolas, monospace",
      theme: {
        background: "#020617",
        foreground: "#e2e8f0"
      }
    });

    term.loadAddon(fitAddon);
    term.open(hostRef.current);
    fitAddon.fit();

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";

    const sendResize = () => {
      const socket = socketRef.current;
      if (!socket) return;
      if (socket.readyState !== WebSocket.OPEN || !term.cols || !term.rows) return;
      socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    const isNearBottom = () => {
      const viewportRows = term.rows || 0;
      const cursorY = term.buffer.active.viewportY || 0;
      const baseY = term.buffer.active.baseY || 0;
      return baseY - cursorY <= Math.max(2, Math.floor(viewportRows * 0.1));
    };

    const connectSocket = () => {
      if (disposed) return;
      const socket = new WebSocket(`${protocol}://${window.location.host}/ws/terminal/${scenarioId}`);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (disposed) {
          socket.close();
          return;
        }
        const recovered = reconnectAttempts > 0;
        reconnectAttempts = 0;
        term.writeln(
          recovered
            ? "\r\n\x1b[32mTerminal reconnected.\x1b[0m"
            : "\x1b[32mConnected to terminal session.\x1b[0m"
        );
        term.writeln(`\x1b[90m[FaultLab] Scenario: ${scenarioId}\x1b[0m`);
        term.scrollToBottom();
        sendResize();
        if (!hasRequestedPrompt) {
          hasRequestedPrompt = true;
          // Trigger shell prompt render without running helper commands like pwd/ls.
          socket.send(JSON.stringify({ type: "input", data: "\n" }));
        }
      });

      socket.addEventListener("message", (event) => {
        const shouldFollow = isNearBottom();
        term.write(String(event.data || ""));
        if (shouldFollow) {
          term.scrollToBottom();
        }
      });

      socket.addEventListener("close", () => {
        if (disposed) return;
        const delay = Math.min(10000, 1000 * 2 ** Math.min(reconnectAttempts, 3));
        reconnectAttempts += 1;
        term.writeln(`\r\n\x1b[33mTerminal disconnected, reconnecting in ${Math.round(delay / 1000)}s...\x1b[0m`);
        term.scrollToBottom();
        reconnectTimer = window.setTimeout(connectSocket, delay);
      });
    };

    connectSocket();

    const disposable = term.onData((data) => {
      const socket = socketRef.current;
      if (!socket) return;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });

    const onResize = () => {
      fitAddon.fit();
      sendResize();
    };
    window.addEventListener("resize", onResize);

    let resizeObserver = null;
    if (window.ResizeObserver && hostRef.current) {
      resizeObserver = new window.ResizeObserver(() => {
        fitAddon.fit();
        sendResize();
      });
      resizeObserver.observe(hostRef.current);
    }

    if (commandBridgeRef) {
      commandBridgeRef.current = (command) => {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          throw new Error("终端连接未就绪，请稍后重试。");
        }
        if (typeof command === "string") {
          socket.send(JSON.stringify({ type: "input", data: `${command}\n` }));
          return;
        }
        if (command && command.type === "attach" && typeof command.containerName === "string") {
          socket.send(JSON.stringify({ type: "attach", containerName: command.containerName }));
        }
      };
    }
    if (focusBridgeRef) {
      focusBridgeRef.current = () => {
        term.focus();
      };
    }

    return () => {
      disposed = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      if (commandBridgeRef) commandBridgeRef.current = null;
      if (focusBridgeRef) focusBridgeRef.current = null;
      window.removeEventListener("resize", onResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      disposable.dispose();
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      term.dispose();
    };
  }, [scenarioId, commandBridgeRef, focusBridgeRef]);

  return <div ref={hostRef} className="h-full w-full overflow-hidden rounded-lg border border-slate-800" />;
}

