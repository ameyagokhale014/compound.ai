import streamlit as st
import pandas as pd
from datetime import datetime
from .db import add_property, get_properties, delete_property

def calculate_amortization(principal, annual_interest_rate, months_passed):
    """Calculates the current principal balance after X months."""
    if months_passed <= 0:
        return principal
    
    monthly_rate = (annual_interest_rate / 100) / 12
    # Standard 30-year mortgage (360 months)
    total_months = 360
    
    # Calculate monthly P&I payment
    monthly_payment = principal * (monthly_rate * (1 + monthly_rate)**total_months) / ((1 + monthly_rate)**total_months - 1)
    
    current_balance = principal
    for _ in range(months_passed):
        interest_payment = current_balance * monthly_rate
        principal_payment = monthly_payment - interest_payment
        current_balance -= principal_payment
        
    return max(current_balance, 0)

def render_real_estate_page():
    st.title("🏡 Real Estate Investment Tracker")

    # --- Input Form ---
    with st.expander("➕ Add New Property", expanded=True):
        with st.form("property_form"):
            addr = st.text_input("Property Address")
            parcel = st.text_input("Parcel Number (Required)")
            
            col1, col2 = st.columns(2)
            with col1:
                price = st.number_input("Purchase Price ($)", min_value=0.0, step=1000.0)
                # Changed from slider to text/number input with validation
                dp_pct = st.number_input("Downpayment %", min_value=0.0, max_value=100.0, value=25.0, step=0.1)
            
            with col2:
                interest_rate = st.number_input("Mortgage Interest Rate (%)", min_value=0.0, value=5.6, step=0.1)
                purchase_date = st.date_input("Purchase Date", value=datetime.now())

            if st.form_submit_button("Save Property"):
                if addr and parcel and price > 0:
                    # Note: You may need to update your add_property DB function to include interest and date
                    # For now, we store them in session or use existing schema
                    add_property(addr, price, dp_pct, parcel)
                    st.success(f"Saved {addr}")
                    st.rerun()
                else:
                    st.error("Please fill in all required fields (Address, Parcel, Price).")

    # --- Portfolio Display ---
    props = get_properties()
    if not props:
        st.info("No properties found.")
        return

    for p in props:
        # id, address, purchase_price, dp_pct, parcel
        _, address, p_price, dp_pct, parcel = p
        
        with st.container(border=True):
            st.subheader(f"{address}")
            st.caption(f"Parcel ID: {parcel}")

            # 1. Valuation Input (Simulating "Up to date" market value)
            curr_val = st.number_input(f"Current Market Valuation ($) for {address}", 
                                      value=p_price, key=f"val_{address}")
            
            # 2. Time Logic
            # Note: In a production app, we would fetch 'purchase_date' and 'interest' from DB
            # Here we use the values from your example for the logic
            months_since_purchase = 5 # This would normally be calculated from purchase_date
            ir = 5.6 # This would normally be from DB
            
            # 3. Amortization Math
            initial_loan = p_price * (1 - (dp_pct / 100))
            remaining_loan = calculate_amortization(initial_loan, ir, months_since_purchase)
            
            total_equity = curr_val - remaining_loan
            ownership_pct = (total_equity / curr_val) * 100 if curr_val > 0 else 0
            
            # 4. Selling Fees (6%)
            selling_fees = curr_val * 0.06
            net_proceeds = total_equity - selling_fees

            # --- Metrics Display ---
            m1, m2, m3, m4 = st.columns(4)
            m1.metric("Current Equity", f"${total_equity:,.0f}")
            m2.metric("Ownership %", f"{ownership_pct:.1f}%")
            m3.metric("Remaining Loan", f"${remaining_loan:,.0f}")
            m4.metric("Net Cash if Sold", f"${net_proceeds:,.0f}")

            # Visualizing % of home paid off
            st.write(f"**Equity Progress (Targeting 100% Ownership)**")
            st.progress(min(max(ownership_pct/100, 0.0), 1.0))
            
            st.info(f"Principal paydown over {months_since_purchase} months added ${(initial_loan - remaining_loan):,.0f} to your equity.")
    
    for prop in get_properties():
    # Schema: id, address, price, dp_pct, parcel, interest, purchase_date
        prop_id, addr, p_price, dp_pct, parcel, interest, p_date = prop
        
        with st.container(border=True):
            # Create a header row with a delete button on the far right
            head_col, del_col = st.columns([0.9, 0.1])
            with head_col:
                st.subheader(addr)
            with del_col:
                # Using a trash icon if supported, or just an 'X'
                if st.button("🗑️", key=f"del_{prop_id}", help="Delete this property"):
                    delete_property(prop_id)
                    st.toast(f"Removed {addr}")
                    st.rerun()

            st.caption(f"Parcel: {parcel} | Purchased: {p_date}")