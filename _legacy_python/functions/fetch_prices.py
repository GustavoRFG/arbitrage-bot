def fetch_prices(pair, gateio, coinex, tradeogre):
    """
    Fetches the best bid and ask prices for a trading pair from Gate.io, CoinEx, and tradeogre.
    """
    try:
        # Fetch order book from Gate.io
        gateio_order_book = gateio.fetch_order_book(pair)
        gateio_bid = gateio_order_book['bids'][0][0] if gateio_order_book['bids'] else None
        gateio_ask = gateio_order_book['asks'][0][0] if gateio_order_book['asks'] else None

        # Fetch order book from CoinEx
        coinex_order_book = coinex.fetch_order_book(pair)
        coinex_bid = coinex_order_book['bids'][0][0] if coinex_order_book['bids'] else None
        coinex_ask = coinex_order_book['asks'][0][0] if coinex_order_book['asks'] else None

        # Fetch order book from tradeogre
        tradeogre_order_book = tradeogre.fetch_order_book(pair)
        tradeogre_bid = tradeogre_order_book['bids'][0][0] if tradeogre_order_book['bids'] else None
        tradeogre_ask = tradeogre_order_book['asks'][0][0] if tradeogre_order_book['asks'] else None

        # Check if bid and ask prices are available
        if None in [gateio_bid, gateio_ask, coinex_bid, coinex_ask, tradeogre_bid, tradeogre_ask]:
            raise ValueError(f"Missing bid/ask prices for {pair}.")

        return {
            "gateio": {
                "buy": gateio_ask,  # Best ask price
                "sell": gateio_bid,  # Best bid price
            },
            "coinex": {
                "buy": coinex_ask,
                "sell": coinex_bid,
            },
            "tradeogre": {
                "buy": tradeogre_ask,
                "sell": tradeogre_bid,
            },
        }
    except Exception as e:
        print(f"Error fetching prices for {pair}: {e}")
        return None
