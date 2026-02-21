import yfinance as yf

t = yf.Ticker("AMD")
h = t.history(period="5d", interval="1d")
print(h.tail())
print("fast_info:", getattr(t, "fast_info", None))