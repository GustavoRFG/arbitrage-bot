def calculate_fees(exchange, pair, amount, is_maker_order=False):
    """
    Calcula as taxas de trade e saque para a exchange e o par especificado.

    Args:
        exchange: Objeto da exchange (ccxt Exchange).
        pair: String do par de negociação (ex: "ETH/USDT").
        amount: Quantidade da moeda base (ex: quantidade de ETH).
        is_maker_order: Boolean indicando se a ordem é do tipo maker. Por padrão, assume taker.

    Returns:
        tuple: (trade_fee, withdrawal_fee) - Taxa de trade e taxa de saque.
    """
    try:
        # Obter informações de taxas de trading
        maker_fee = exchange.markets[pair].get('maker', 0.002)  # Taxa de maker padrão
        taker_fee = exchange.markets[pair].get('taker', 0.002)  # Taxa de taker padrão

        # Determinar a taxa de trading com base no tipo de ordem
        trade_fee = maker_fee * amount if is_maker_order else taker_fee * amount

        # Obter taxa de saque para a moeda base
        base_currency = pair.split('/')[0]
        withdrawal_fee = exchange.fees.get('funding', {}).get('withdraw', {}).get(base_currency, 0.001)

        # Certifique-se de que as taxas não são None
        trade_fee = trade_fee if trade_fee is not None else 0
        withdrawal_fee = withdrawal_fee if withdrawal_fee is not None else 0

        return trade_fee, withdrawal_fee

    except Exception as e:
        print(f"Erro ao calcular taxas para {pair}: {e}")
        return None, None


