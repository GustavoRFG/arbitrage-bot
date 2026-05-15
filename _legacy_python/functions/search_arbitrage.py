from functions.fetch_prices import fetch_prices
from functions.calculate_fees import calculate_fees

def search_arbitrage(pair, amount, gateio, coinex, tradeogre):
    """
    Calcula se há oportunidade de arbitragem entre Gate.io, CoinEx e Xeggex.
    """
    prices = fetch_prices(pair, gateio, coinex, tradeogre)
    if not prices:
        print(f"Não foi possível buscar preços para {pair}.")
        return None

    # Preços
    gateio_buy = prices["gateio"]["buy"]
    coinex_sell = prices["coinex"]["sell"]
    tradeogre_sell = prices["tradeogre"]["sell"]
    gateio_sell = prices["gateio"]["sell"]
    coinex_buy = prices["coinex"]["buy"]
    tradeogre_buy = prices["tradeogre"]["buy"]

    # Taxas
    gateio_trade_fee, gateio_withdrawal_fee = calculate_fees(gateio, pair, amount)
    coinex_trade_fee, coinex_withdrawal_fee = calculate_fees(coinex, pair, amount)
    tradeogre_trade_fee, tradeogre_withdrawal_fee = calculate_fees(tradeogre, pair, amount)

    # Validar taxas para evitar None
    if None in [gateio_trade_fee, gateio_withdrawal_fee, coinex_trade_fee, coinex_withdrawal_fee,
                tradeogre_trade_fee, tradeogre_withdrawal_fee]:
        print(f"Taxas inválidas para {pair}. Verifique a função calculate_fees.")
        return None

    # Lucro para diferentes combinações de arbitragem
    profit_1 = (coinex_sell - gateio_buy) * amount - (gateio_trade_fee + coinex_trade_fee + gateio_withdrawal_fee)
    profit_2 = (gateio_sell - coinex_buy) * amount - (coinex_trade_fee + gateio_trade_fee + coinex_withdrawal_fee)
    profit_3 = (tradeogre_sell - gateio_buy) * amount - (gateio_trade_fee + tradeogre_trade_fee + gateio_withdrawal_fee)
    profit_4 = (gateio_sell - tradeogre_buy) * amount - (tradeogre_trade_fee + gateio_trade_fee + tradeogre_withdrawal_fee)

    # Exibir lucros calculados
    print(f"Arbitragem calculada para {pair}:")
    print(f"Lucro estimado (Gate.io -> CoinEx): {profit_1:.2f} USDT")
    print(f"Lucro estimado (CoinEx -> Gate.io): {profit_2:.2f} USDT")
    print(f"Lucro estimado (Gate.io -> Tradeogre): {profit_3:.2f} USDT")
    print(f"Lucro estimado (Tradeogre -> Gate.io): {profit_4:.2f} USDT")

    return profit_1, profit_2, profit_3, profit_4
