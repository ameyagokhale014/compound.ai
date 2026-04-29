import { useEffect, useRef, useCallback } from "react";

type PriceUpdate = { type: "price_update"; prices: Record<string, number> };

export function useWebSocket(onPriceUpdate: (prices: Record<string, number>) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const cbRef = useRef(onPriceUpdate);
  cbRef.current = onPriceUpdate;

  const connect = useCallback(() => {
    const ws = new WebSocket("ws://localhost:8000/ws");
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg: PriceUpdate = JSON.parse(e.data);
        if (msg.type === "price_update") cbRef.current(msg.prices);
      } catch {}
    };

    ws.onclose = () => {
      setTimeout(connect, 3000);
    };

    return ws;
  }, []);

  useEffect(() => {
    const ws = connect();
    return () => ws.close();
  }, [connect]);
}
