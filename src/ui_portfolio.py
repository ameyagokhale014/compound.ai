# src/ui_portfolio.py
import streamlit as st
import pandas as pd

from .portfolio import upsert_position, delete_position, get_positions, get_lots, delete_lot
from .market import last_price, get_fundamentals


# ----------------------------
# Helpers: load symbols.csv
# ----------------------------
@st.cache_data(show_spinner=False)
def _load_symbols_csv():
    path = "data/symbols.csv"
    df = pd.read_csv(path)

    cols = {c.lower(): c for c in df.columns}
    sym_col = cols.get("symbol") or cols.get("ticker")
    name_col = cols.get("name")
    exch_col = cols.get("exchange") or cols.get("exchangeshortname") or cols.get("exchdisp")

    if not sym_col:
        raise ValueError(
            f"{path} must contain a 'Symbol' or 'Ticker' column. Found: {list(df.columns)}"
        )

    df["__symbol__"] = df[sym_col].astype(str).str.upper().str.strip()
    df["__name__"] = df[name_col].astype(str).str.strip() if name_col else ""
    df["__exch__"] = df[exch_col].astype(str).str.strip() if exch_col else ""

    df = df[df["__symbol__"] != ""].drop_duplicates(subset=["__symbol__"])

    # OPTIONAL filter (SMART): only filter if values look like "NasdaqGS/NasdaqCM/Nasdaq"
    # If your file uses codes like NMS/NGM/NCM, do NOT filter here.
    if exch_col:
        sample = " ".join(df["__exch__"].head(50).astype(str).tolist()).upper()
        if "NASDAQ" in sample:  # looks like NasdaqGS/NasdaqCM style
            df = df[df["__exch__"].str.upper().str.contains("NASDAQ", na=False)]

    def make_label(r):
        nm = r["__name__"]
        if nm:
            return f"{r['__symbol__']} — {nm}"
        return f"{r['__symbol__']}"

    df["__label__"] = df.apply(make_label, axis=1)

    labels = df["__label__"].tolist()
    label_to_symbol = dict(zip(df["__label__"], df["__symbol__"]))
    symbol_to_name = dict(zip(df["__symbol__"], df["__name__"]))

    return labels, label_to_symbol, symbol_to_name


# ----------------------------
# UI
# ----------------------------
def render_portfolio_tab():
    import streamlit as st
    import pandas as pd

    st.subheader("Portfolio")

    # --- Load valid ticker universe from symbols.csv ---
    labels, label_to_symbol, symbol_to_name = _load_symbols_csv()

    # =========================================================
    # Helper: safe rounding for display
    # =========================================================
    def _round_df_numbers(d: pd.DataFrame) -> pd.DataFrame:
        if d is None or d.empty:
            return d
        num_cols = d.select_dtypes(include=["number"]).columns
        if len(num_cols) > 0:
            d[num_cols] = d[num_cols].round(2)
        return d

    # =========================================================
    # CASH helpers (CHANGE #1)
    # =========================================================
    CASH_DB_TICKER = "CASH"
    CASH_DISPLAY_TICKER = "CASH ($)"

    def _is_cash_ticker(t: str) -> bool:
        t = (t or "").upper().strip()
        return t == CASH_DB_TICKER or t == CASH_DISPLAY_TICKER or t.startswith("CASH")

    # =========================================================
    # 0) LOAD POSITIONS + BUILD COMPUTED DF (for metrics + table)
    # =========================================================
    rows = get_positions()

    if rows:
        df = pd.DataFrame(rows, columns=["Ticker", "Quantity", "Avg Price"])
        df["Ticker"] = df["Ticker"].astype(str).str.upper().str.strip()

        # ---- CASH special-case (for computations) ----
        cash_mask = df["Ticker"].apply(_is_cash_ticker)
        df.loc[cash_mask, "Ticker"] = CASH_DISPLAY_TICKER
        # For internal math, treat cash as $1 price so MV = Quantity
        df.loc[cash_mask, "Avg Price"] = 1.0

        # Last Price: stocks from market, cash fixed at 1
        df["Last Price"] = df["Ticker"].apply(lambda t: 1.0 if _is_cash_ticker(t) else last_price(t))

        # Core computed fields
        df["Cost Basis"] = df["Quantity"] * df["Avg Price"]
        df["Market Value"] = df["Quantity"] * df["Last Price"]

        # Gains: cash must always be 0
        df["Total $ Gain"] = df["Market Value"] - df["Cost Basis"]
        df["Total % Gain"] = (df["Total $ Gain"] / df["Cost Basis"]) * 100
        df.loc[df["Ticker"].apply(_is_cash_ticker), "Total $ Gain"] = 0.0
        df.loc[df["Ticker"].apply(_is_cash_ticker), "Total % Gain"] = 0.0

        # fundamentals
        fund_rows = []
        for t in df["Ticker"].tolist():
            if _is_cash_ticker(t):
                fund_rows.append(
                    {
                        "Forward PE": None,
                        "Forward PEG": None,
                        "Rev G 1Y %": None,
                        "Rev G 3Y %": None,
                        "Rev G 5Y %": None,
                        "OCF G 1Y %": None,
                        "OCF G 3Y %": None,
                        "OCF G 5Y %": None,
                        "FCF G 1Y %": None,
                        "FCF G 3Y %": None,
                        "FCF G 5Y %": None,
                        "Target 1Y": None,
                        "Target 3Y": None,
                        "Target 5Y": None,
                        "Fair Value": None,
                        "Price/Fair Value": None,
                        "Quick Ratio": None,
                        "Current Ratio": None,
                    }
                )
                continue

            f = get_fundamentals(t)
            fund_rows.append(
                {
                    "Forward PE": f.get("forward_pe"),
                    "Forward PEG": f.get("forward_peg"),
                    "Rev G 1Y %": (f.get("rev_g_1y") * 100) if f.get("rev_g_1y") is not None else None,
                    "Rev G 3Y %": (f.get("rev_g_3y") * 100) if f.get("rev_g_3y") is not None else None,
                    "Rev G 5Y %": (f.get("rev_g_5y") * 100) if f.get("rev_g_5y") is not None else None,
                    "OCF G 1Y %": (f.get("ocf_g_1y") * 100) if f.get("ocf_g_1y") is not None else None,
                    "OCF G 3Y %": (f.get("ocf_g_3y") * 100) if f.get("ocf_g_3y") is not None else None,
                    "OCF G 5Y %": (f.get("ocf_g_5y") * 100) if f.get("ocf_g_5y") is not None else None,
                    "FCF G 1Y %": (f.get("fcf_g_1y") * 100) if f.get("fcf_g_1y") is not None else None,
                    "FCF G 3Y %": (f.get("fcf_g_3y") * 100) if f.get("fcf_g_3y") is not None else None,
                    "FCF G 5Y %": (f.get("fcf_g_5y") * 100) if f.get("fcf_g_5y") is not None else None,
                    "Target 1Y": f.get("target_1y"),
                    "Target 3Y": f.get("target_3y"),
                    "Target 5Y": f.get("target_5y"),
                    "Fair Value": f.get("fair_value"),
                    "Price/Fair Value": f.get("price_by_fair_value"),
                    "Quick Ratio": f.get("quick_ratio"),
                    "Current Ratio": f.get("current_ratio"),
                }
            )

        fund_df = pd.DataFrame(fund_rows)
        df = pd.concat([df.reset_index(drop=True), fund_df.reset_index(drop=True)], axis=1)

        df = _round_df_numbers(df)

        total_mv = 0.0
        total_gain = 0.0
        total_pct_gain = 0.0
        positions_count = 0

        if rows:
            total_mv = float(df["Market Value"].sum())
            total_gain = float(df["Total $ Gain"].sum())
            total_cb = float(df["Cost Basis"].sum())

            total_pct_gain = (total_gain / total_cb * 100.0) if total_cb else 0.0
            df["% of Portfolio"] = (df["Market Value"] / total_mv * 100.0) if total_mv > 0 else 0.0

            positions_count = len(df)

        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Market Value ($)", f"{total_mv:,.2f}")
        c2.metric("Total % Gain", f"{total_pct_gain:,.2f}")
        c3.metric("Total $ Gain", f"{total_gain:,.2f}")
        c4.metric("Positions", positions_count)

        st.divider()
    else:
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Market Value ($)", "0.00")
        c2.metric("Total % Gain", "0.00")
        c3.metric("Total $ Gain", "0.00")
        c4.metric("Positions", 0)
        st.divider()

    # =========================================================
    # 1) ADD A POSITION (TOP)  (CHANGE #2: ensure heading renders once)
    # =========================================================
    colA, colB = st.columns(2)

    with colA:
        st.markdown("### Add a position")
        with st.form("add_position_form", clear_on_submit=True):
            picked_label = st.selectbox(
                "Search ticker",
                options=labels,
                index=None,
                placeholder="Start typing: aapl, google…",
            )

            selected_symbol = label_to_symbol[picked_label] if picked_label else None

            qty = st.number_input("Quantity", min_value=0.0, step=1.0)
            avg = st.number_input("Avg Buy Price", min_value=0.0, step=1.0)

            submitted = st.form_submit_button("Save")

        if submitted and selected_symbol and qty > 0:
            upsert_position(selected_symbol, float(qty), float(avg))
            st.success(f"Added {selected_symbol}")
            st.rerun()

    with colB:
        st.markdown("### Add Cash")

        with st.form("add_cash_form", clear_on_submit=True):
            cash_amount = st.number_input("USD Amount", min_value=0.0, step=100.0)
            submitted_cash = st.form_submit_button("Add Cash")

        if submitted_cash and cash_amount > 0:
            from src.portfolio import add_cash  # ensure function exists
            add_cash(float(cash_amount))
            st.success("Cash added to portfolio")
            st.rerun()

    st.divider()

    # =========================================================
    # 2) SINGLE TABLE ONLY: READ-ONLY + REMOVE SELECTED
    # =========================================================
    st.markdown("### Positions")

    if not rows:
        st.info("No positions yet.")
        return

    rows = get_positions()
    df = pd.DataFrame(rows, columns=["Ticker", "Quantity", "Avg Price"])
    df["Ticker"] = df["Ticker"].astype(str).str.upper().str.strip()

    # ---- CASH special-case (TABLE DF TOO) ----
    cash_mask = df["Ticker"].apply(_is_cash_ticker)
    df.loc[cash_mask, "Ticker"] = CASH_DISPLAY_TICKER
    df.loc[cash_mask, "Avg Price"] = 1.0

    # Last price: cash fixed at 1 (avoid last_price(CASH))
    df["Last Price"] = df["Ticker"].apply(lambda t: 1.0 if _is_cash_ticker(t) else last_price(t))

    df["Cost Basis"] = df["Quantity"] * df["Avg Price"]
    df["Market Value"] = df["Quantity"] * df["Last Price"]

    df["Total $ Gain"] = df["Market Value"] - df["Cost Basis"]
    df["Total % Gain"] = (df["Total $ Gain"] / df["Cost Basis"]) * 100
    df.loc[df["Ticker"].apply(_is_cash_ticker), "Total $ Gain"] = 0.0
    df.loc[df["Ticker"].apply(_is_cash_ticker), "Total % Gain"] = 0.0

    _total_mv = float(df["Market Value"].sum()) if not df.empty else 0.0
    df["% of Portfolio"] = (df["Market Value"] / _total_mv * 100.0) if _total_mv > 0 else 0.0

    # Fundamentals per ticker
    fund_rows = []
    for t in df["Ticker"].tolist():
        if _is_cash_ticker(t):
            fund_rows.append(
                {
                    "Forward PE": None,
                    "Forward PEG": None,
                    "Rev G 1Y %": None,
                    "Rev G 3Y %": None,
                    "OCF G 1Y %": None,
                    "OCF G 3Y %": None,
                    "FCF G 1Y %": None,
                    "FCF G 3Y %": None,
                    "Target 1Y": None,
                    "Target 3Y": None,
                    "Target 5Y": None,
                    "Fair Value": None,
                    "Price/Fair Value": None,
                    "Quick Ratio": None,
                    "Current Ratio": None,
                }
            )
            continue

        f = get_fundamentals(t)
        fund_rows.append(
            {
                "Forward PE": f.get("forward_pe"),
                "Forward PEG": f.get("forward_peg"),
                "Rev G 1Y %": (f.get("rev_g_1y") * 100) if f.get("rev_g_1y") is not None else None,
                "Rev G 3Y %": (f.get("rev_g_3y") * 100) if f.get("rev_g_3y") is not None else None,
                "OCF G 1Y %": (f.get("ocf_g_1y") * 100) if f.get("ocf_g_1y") is not None else None,
                "OCF G 3Y %": (f.get("ocf_g_3y") * 100) if f.get("ocf_g_3y") is not None else None,
                "FCF G 1Y %": (f.get("fcf_g_1y") * 100) if f.get("fcf_g_1y") is not None else None,
                "FCF G 3Y %": (f.get("fcf_g_3y") * 100) if f.get("fcf_g_3y") is not None else None,
                "Target 1Y": f.get("target_1y"),
                "Target 3Y": f.get("target_3y"),
                "Target 5Y": f.get("target_5y"),
                "Fair Value": f.get("fair_value"),
                "Price/Fair Value": f.get("price_by_fair_value"),
                "Quick Ratio": f.get("quick_ratio"),
                "Current Ratio": f.get("current_ratio"),
            }
        )

    fund_df = pd.DataFrame(fund_rows)
    df = pd.concat([df.reset_index(drop=True), fund_df.reset_index(drop=True)], axis=1)

    # --- Force 2 decimals everywhere numeric ---
    num_cols = df.select_dtypes(include=["number"]).columns
    df[num_cols] = df[num_cols].round(2)

    # --- Totals ---
    total_mv = float(df["Market Value"].sum()) if not df.empty else 0.0
    total_cb = float(df["Cost Basis"].sum()) if not df.empty else 0.0
    total_gain = float(df["Total $ Gain"].sum()) if not df.empty else 0.0
    total_pct_gain = (total_gain / total_cb * 100.0) if total_cb > 0 else 0.0

    # --- ONE TABLE ONLY ---
    df_view = df[
        [
            "Ticker",
            "Quantity",
            "Avg Price",
            "Last Price",
            "Cost Basis",
            "Market Value",
            "% of Portfolio",
            "Total $ Gain",
            "Total % Gain",
            "Forward PE",
            "Forward PEG",
            "Rev G 1Y %",
            "Rev G 3Y %",
            "OCF G 1Y %",
            "OCF G 3Y %",
            "FCF G 1Y %",
            "FCF G 3Y %",
            "Target 1Y",
            "Target 3Y",
            "Target 5Y",
            "Fair Value",
            "Price/Fair Value",
            "Quick Ratio",
            "Current Ratio",
        ]
    ].copy()

    # ---- CASH display requirements (blank other columns; MV = cash qty; gains = 0) ----
    cash_mask_view = df_view["Ticker"].apply(_is_cash_ticker)

    # Ensure MV equals the cash amount (Quantity)
    df_view.loc[cash_mask_view, "Market Value"] = pd.to_numeric(df_view.loc[cash_mask_view, "Quantity"], errors="coerce")

    # Set required zeros
    df_view.loc[cash_mask_view, "Total $ Gain"] = 0.0
    df_view.loc[cash_mask_view, "Total % Gain"] = 0.0

    # Blank all other columns for cash (keep only: Ticker, Quantity, Market Value, % of Portfolio, Total gains)
    keep_cash_cols = {"Ticker", "Quantity", "Market Value", "% of Portfolio", "Total $ Gain", "Total % Gain"}
    for c in df_view.columns:
        if c not in keep_cash_cols:
            df_view.loc[cash_mask_view, c] = None

    df_view.insert(0, "Select", False)

    # Build TOTAL row
    total_row = {col: None for col in df_view.columns}
    total_row["Ticker"] = "TOTAL"
    total_row["Cost Basis"] = round(total_cb, 2)
    total_row["Market Value"] = round(total_mv, 2)
    total_row["Total $ Gain"] = round(total_gain, 2)
    total_row["Total % Gain"] = round(total_pct_gain, 2)
    total_row["% of Portfolio"] = 100.0
    df_view = pd.concat([df_view, pd.DataFrame([total_row])], ignore_index=True)

    # Remove selected button
    _, action_c2 = st.columns([7, 3])
    with action_c2:
        remove_clicked = st.button("Remove selected", use_container_width=True)

    st.markdown(
        """
    <style>
    /* ===== Freeze header row ===== */
    div[data-testid="stDataEditor"] div[role="columnheader"]{
    position: sticky !important;
    top: 0 !important;
    background: white !important;
    z-index: 100 !important;
    }

    /* ===== Freeze Ticker column (2nd column: Select is 1st, Ticker is 2nd) ===== */
    /* Header cell */
    div[data-testid="stDataEditor"] div[role="columnheader"]:nth-child(2){
    position: sticky !important;
    left: 56px !important;
    background: white !important;
    z-index: 200 !important;
    }

    /* Body cells */
    div[data-testid="stDataEditor"] div[role="row"] div[role="gridcell"]:nth-child(2){
    position: sticky !important;
    left: 56px !important;
    background: white !important;
    z-index: 150 !important;
    box-shadow: 2px 0 6px -3px rgba(0,0,0,0.25);
    }
    </style>
    """,
        unsafe_allow_html=True,
    )

    edited = st.data_editor(
        df_view,
        use_container_width=True,
        hide_index=True,
        key="positions_table",
        disabled=[c for c in df_view.columns if c != "Select"],
        column_config={
            "Select": st.column_config.CheckboxColumn(""),
            "Ticker": st.column_config.TextColumn("Ticker", disabled=True),
            **{
                col: st.column_config.NumberColumn(col, format="%.2f", disabled=True)
                for col in df_view.columns
                if col not in ["Select", "Ticker"]
            },
        },
    )

    if remove_clicked:
        to_remove = edited.loc[edited["Select"] == True, "Ticker"].tolist()
        to_remove = [t for t in to_remove if str(t).upper() != "TOTAL"]

        if not to_remove:
            st.warning("Select at least one ticker row to remove.")
        else:
            for t in to_remove:
                delete_position(t)
            st.success(f"Removed: {', '.join(to_remove)}")
            st.rerun()

    # =========================================================
    # PIE CHART: % of Portfolio (below Positions table)
    # =========================================================
    st.markdown("### % of Portfolio")

    pie_df = df_view.copy()
    pie_df["Ticker"] = pie_df["Ticker"].astype(str)
    pie_df = pie_df[pie_df["Ticker"].str.upper() != "TOTAL"]

    pie_df["Market Value"] = pd.to_numeric(pie_df["Market Value"], errors="coerce").fillna(0.0)

    total_mv_for_pie = float(pie_df["Market Value"].sum())
    if total_mv_for_pie <= 0:
        st.info("No portfolio weights to display yet.")
    else:
        pie_df["% of Portfolio"] = (pie_df["Market Value"] / total_mv_for_pie) * 100.0
        pie_df["% of Portfolio"] = pie_df["% of Portfolio"].round(2)
        pie_df = pie_df[pie_df["% of Portfolio"] > 0]

    import matplotlib.pyplot as plt
    import numpy as np

    fig, ax = plt.subplots(figsize=(5, 5))

    values = pie_df["% of Portfolio"].values
    labels = pie_df["Ticker"].values

    def autopct_format(pct):
        return f"{pct:.2f}%" if pct > 6 else ""

    wedges, _, autotexts = ax.pie(
        values,
        labels=None,
        autopct=autopct_format,
        startangle=90,
        textprops={"fontsize": 8},
    )
    ax.axis("equal")

    small_threshold = 6.0
    min_dy = 0.08

    left = []
    right = []

    for i, w in enumerate(wedges):
        pct = float(values[i])
        ang = (w.theta2 + w.theta1) / 2.0
        x = np.cos(np.deg2rad(ang))
        y = np.sin(np.deg2rad(ang))

        if pct <= small_threshold:
            item = {"i": i, "x": x, "y": y, "pct": pct, "label": labels[i]}
            if x >= 0:
                right.append(item)
            else:
                left.append(item)
        else:
            ax.text(1.05 * x, 1.05 * y, labels[i], ha="center", va="center", fontsize=9)

    def _spread(items, side_sign):
        if not items:
            return

        items.sort(key=lambda d: d["y"], reverse=True)

        for k in range(1, len(items)):
            if items[k - 1]["y"] - items[k]["y"] < min_dy:
                items[k]["y"] = items[k - 1]["y"] - min_dy

        for d in items:
            d["y"] = max(min(d["y"], 1.1), -1.1)

        for d in items:
            i = d["i"]
            text_x = 1.25 * side_sign
            text_y = 1.25 * d["y"]

            mid_ang = (wedges[i].theta2 + wedges[i].theta1) / 2.0
            anchor = (np.cos(np.deg2rad(mid_ang)), np.sin(np.deg2rad(mid_ang)))

            ax.annotate(
                f'{d["label"]} ({d["pct"]:.2f}%)',
                xy=anchor,
                xytext=(text_x, text_y),
                ha="left" if side_sign > 0 else "right",
                va="center",
                fontsize=7,
                arrowprops=dict(arrowstyle="-", lw=0.7),
            )

    _spread(left, side_sign=-1)
    _spread(right, side_sign=+1)

    st.pyplot(fig, use_container_width=False)

    # =========================================================
    # 3) LOTS (BUYS) SECTION
    # =========================================================
    st.divider()
    st.markdown("### Lots (buys)")

    tickers_in_portfolio = sorted({str(t).upper().strip() for t in df["Ticker"].tolist()})
    if not tickers_in_portfolio:
        st.info("No lots yet.")
        return

    view_ticker = st.selectbox("View buys for ticker", tickers_in_portfolio, key="lots_ticker_pick")
    lots_rows = get_lots(view_ticker)

    if not lots_rows:
        st.info("No lots found for this ticker.")
        return

    if isinstance(lots_rows[0], dict):
        lots_df = pd.DataFrame(lots_rows)
        rename_map = {}
        if "id" in lots_df.columns:
            rename_map["id"] = "Lot ID"
        if "lot_id" in lots_df.columns:
            rename_map["lot_id"] = "Lot ID"
        if "ticker" in lots_df.columns:
            rename_map["ticker"] = "Ticker"
        if "quantity" in lots_df.columns:
            rename_map["quantity"] = "Quantity"
        if "qty" in lots_df.columns:
            rename_map["qty"] = "Quantity"
        if "price" in lots_df.columns:
            rename_map["price"] = "Price"
        if "avg_price" in lots_df.columns:
            rename_map["avg_price"] = "Price"
        if "bought_at" in lots_df.columns:
            rename_map["bought_at"] = "Bought At"
        if "created_at" in lots_df.columns:
            rename_map["created_at"] = "Bought At"
        lots_df = lots_df.rename(columns=rename_map)
    else:
        lots_df = pd.DataFrame(lots_rows, columns=["Lot ID", "Ticker", "Quantity", "Price", "Bought At"])

    keep_cols = [c for c in ["Lot ID", "Ticker", "Quantity", "Price", "Bought At"] if c in lots_df.columns]
    lots_df = lots_df[keep_cols].copy()

    lots_df = _round_df_numbers(lots_df)

    st.dataframe(
        lots_df,
        use_container_width=True,
        hide_index=True,
        column_config={
            "Quantity": st.column_config.NumberColumn("Quantity", format="%.2f"),
            "Price": st.column_config.NumberColumn("Price", format="%.2f"),
        },
    )