/**
 * Socket.io client — authenticated singleton.
 *
 * Call `initSocket(token)` with a Clerk session token before using.
 * The server also accepts cookie-based auth, but the explicit token
 * ensures the connection works even when cookies are restricted.
 */
import { io, type Socket } from "socket.io-client";

let _socket: Socket | null = null;

function getApiServerOrigin(): string {
  return window.location.origin;
}

/**
 * Initialize (or reconnect) the socket with a fresh Clerk session token.
 * Safe to call multiple times — recreates the socket only when necessary.
 */
export function initSocket(token: string | null): Socket {
  if (_socket?.connected) return _socket;

  // Disconnect stale socket before creating a new one
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }

  _socket = io(getApiServerOrigin(), {
    path: "/api-server/socket.io",
    withCredentials: true,
    auth: token ? { token } : {},
    transports: ["websocket", "polling"],
    autoConnect: true,
  });

  return _socket;
}

/**
 * Returns the current socket without creating a new one.
 * Returns null if initSocket has not been called yet.
 */
export function getSocket(): Socket | null {
  return _socket;
}

export function disconnectSocket(): void {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}
