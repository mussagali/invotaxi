import { resolveWsOrigin } from './api';

type WebSocketMessageHandler = (data: any) => void;
type Status = 'connected' | 'connecting' | 'disconnected' | 'error';

class DispatchMapWebSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, WebSocketMessageHandler>();
  private status: Status = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private closedByClient = false;

  getConnectionStatus(): Status { return this.status; }
  getReconnectAttempts(): number { return this.reconnectAttempts; }
  get connected(): boolean { return this.ws?.readyState === WebSocket.OPEN; }

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    const token = localStorage.getItem('accessToken');
    if (!token) return Promise.reject(new Error('Сессия не авторизована'));
    this.closedByClient = false;
    this.status = 'connecting';
    return new Promise((resolve, reject) => {
      const url = `${resolveWsOrigin()}/api/v1/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      this.ws = ws;
      let opened = false;
      ws.onopen = () => { opened = true; this.status = 'connected'; this.reconnectAttempts = 0; resolve(); };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
          const payload = message.payload || {};
          if (message.type === 'driver.position') this.handlers.get('driver_location_update')?.({ ...payload, timestamp: payload.ts });
          else if (message.type === 'order.status_changed') this.handlers.get('order_update')?.({ ...payload, id: payload.order_id, status: payload.status === 'picked_up' ? 'ride_ongoing' : payload.status });
          else if (message.type === 'plan.published' || message.type === 'route.updated' || message.type === 'plan.draft_ready') this.handlers.get('order_update')?.(payload);
        } catch (error) { console.warn('Некорректное WebSocket-событие', error); }
      };
      ws.onerror = () => { this.status = 'error'; if (!opened) reject(new Error('WebSocket недоступен')); };
      ws.onclose = () => { this.status = 'disconnected'; this.ws = null; if (!this.closedByClient) this.scheduleReconnect(); };
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null || this.reconnectAttempts >= 10) { if (this.reconnectAttempts >= 10) this.status='error'; return; }
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => { this.reconnectTimer=null; void this.connect().catch(()=>undefined); }, Math.min(30000, 1000 * 2 ** Math.min(this.reconnectAttempts, 5)));
  }

  disconnect(): void {
    this.closedByClient = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close(1000, 'client close');
    this.ws = null;
    this.status = 'disconnected';
  }
  on(messageType: string, handler: WebSocketMessageHandler): void { this.handlers.set(messageType, handler); }
  off(messageType: string): void { this.handlers.delete(messageType); }
  send(type: string, data?: any): void { if (this.connected) this.ws!.send(JSON.stringify({type,...data})); }
}

let wsInstance: DispatchMapWebSocket | null = null;
export const getDispatchMapWebSocket = () => wsInstance ??= new DispatchMapWebSocket();

export const testWebSocketConnection = (): Promise<boolean> => {
  const token=localStorage.getItem('accessToken');
  if(!token) return Promise.resolve(false);
  return new Promise((resolve)=>{
    const ws=new WebSocket(`${resolveWsOrigin()}/api/v1/ws?token=${encodeURIComponent(token)}`);
    const timeout=window.setTimeout(()=>{ws.close();resolve(false);},5000);
    ws.onopen=()=>{window.clearTimeout(timeout);ws.close(1000);resolve(true);};
    ws.onerror=()=>{window.clearTimeout(timeout);resolve(false);};
  });
};

export default DispatchMapWebSocket;
