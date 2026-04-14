"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import "@wterm/react/css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TerminalSquare, Loader2, LogOut } from "lucide-react";

type AuthMethod = "password" | "privateKey";
type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

interface ConnectionParams {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

export default function SSHClient() {
  const { ref, write } = useTerminal();
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [error, setError] = useState("");

  const [host, setHost] = useState("cmd.ai");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");

  // Restore saved username from localStorage after hydration —
  // synchronous setState is intentional to avoid a flash of empty input.
  useEffect(() => {
    const saved = localStorage.getItem("ssh:username");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setUsername(saved);
  }, []);
  const [authMethod, setAuthMethod] = useState<AuthMethod>("privateKey");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");

  const connect = useCallback(() => {
    if (!host || !username) return;

    setState("connecting");
    setError("");

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/api/ssh`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      const params: ConnectionParams = {
        host,
        port: parseInt(port, 10) || 22,
        username,
      };
      if (authMethod === "privateKey" && privateKey) {
        params.privateKey = privateKey;
      } else if (password) {
        params.password = password;
      }
      ws.send(JSON.stringify(params));
      localStorage.setItem("ssh:username", username);
      setState("connected");
    };

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        const text = new TextDecoder("latin1").decode(event.data);
        write(text);
      } else {
        const data = event.data as string;
        if (data.startsWith("{")) {
          try {
            const msg = JSON.parse(data);
            if (msg.error) {
              setError(msg.error);
              setState("error");
              return;
            }
          } catch {
            /* not JSON, treat as terminal data */
          }
        }
        write(data);
      }
    };

    ws.onclose = () => {
      setState((current) => {
        if (current === "connecting") {
          setError("Connection failed");
          return "error";
        }
        return "disconnected";
      });
      wsRef.current = null;
    };

    ws.onerror = () => {
      setError("WebSocket connection failed");
      setState("error");
    };
  }, [host, port, username, authMethod, password, privateKey, write]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setState("disconnected");
  }, []);

  const handleData = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    connect();
  };

  if (state === "connected") {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TerminalSquare className="size-4" />
            <span>
              {username}@{host}:{port}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={disconnect}>
            <LogOut className="size-4" />
            Disconnect
          </Button>
        </header>
        <main className="flex flex-1 items-stretch justify-center p-4">
          <Terminal
            ref={ref}
            cols={80}
            rows={24}
            wasmUrl="/wterm.wasm"
            onData={handleData}
            className="w-full max-w-[960px]"
          />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <div className="flex items-center justify-center gap-2">
            <TerminalSquare className="size-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">
              SSH Client
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Connect to a remote server via SSH
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="host">Host</Label>
              <Input
                id="host"
                placeholder="192.168.1.1"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              placeholder="root"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Authentication</Label>
            <Select
              value={authMethod}
              onValueChange={(v) => setAuthMethod(v as AuthMethod)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">Password</SelectItem>
                <SelectItem value="privateKey">Private Key</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {authMethod === "password" ? (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="privateKey">Private Key</Label>
              <Textarea
                id="privateKey"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n..."}
                rows={6}
                className="font-mono text-xs"
              />
            </div>
          )}

          {(state === "error" || error) && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={state === "connecting" || !host || !username}
          >
            {state === "connecting" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <TerminalSquare className="size-4" />
                Connect
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
