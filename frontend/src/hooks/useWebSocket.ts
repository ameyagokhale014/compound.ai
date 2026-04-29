import { useEffect, useRef, useCallback } from "react";

export interface ExtendedPrice {
  price: number;
  change: number;
  change_pct: number;
  session: "pre_market" | "post_market";
  reg_close: number | null;
}

type WsMessage = {
  type: "price_update";
  prices: Record<string, number>;
  extended: Record<string, ExtendedPrice>;
  session: "regular" | "pre_market" | "post_market" | "closed";
};

export function useWebSocket(
  onPriceUpdate: (prices: Record<string, number>) => void,
  onExtendedUpdate?: (extended: Record<string, ExtendedPrice>, session: string) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const cbRef    = useRef(onPriceUpdate);
  const extCbRef = useRef(onExtendedUpdate);
  cbRef.current    = onPriceUpdate;
  extCbRef.current = onExtendedUpdate;

  const connect = useCallback(() => {
    const ws = new WebSocket("ws://localhost:8000/ws");
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg: WsMessage = JSON.parse(e.data);
        if (msg.type === "price_update") {
          if (msg.prices && Object.keys(msg.prices).length > 0) {
            cbRef.current(msg.prices);
          }
          if (extCbRef.current && msg.extended && Object.keys(msg.extended).length > 0) {
            extCbRef.current(msg.extended, msg.session);
          }
        }
      } catch {}
    };

    ws.onclose = () => setTimeout(connect, 3000);
    return ws;
  }, []);

  useEffect(() => {
    const ws = connect();
    return () => ws.close();
  }, [connect]);
}
