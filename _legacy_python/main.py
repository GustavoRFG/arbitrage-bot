import ccxt
from dotenv import load_dotenv
import os
import time  # Import necessário para controlar o intervalo
from functions.search_arbitrage import search_arbitrage

# Intervalo entre as verificações (em segundos)
INTERVALO = 100  # 300 segundos = 5 minutos

# Carrega variáveis do .env
load_dotenv()

# Configuração da API para Gate.io e Coinex
gateio = ccxt.gateio({
    'apiKey': os.getenv("API_Gate"),
    'secret': os.getenv("SECRET_Gate"),
})

gateio.options["createMarketBuyOrderRequiresPrice"] = False

coinex = ccxt.coinex({
    'apiKey': os.getenv("API_Coinex"),
    'secret': os.getenv("SECRET_Coinex"),
})
coinex.options["createMarketBuyOrderRequiresPrice"] = False

# Configuração da API para Tradeogre
tradeogre = ccxt.tradeogre({
    'apiKey': os.getenv("API_Tradeogre"),
    'secret': os.getenv("SECRET_Tradeogre"),
})
tradeogre.options["createMarketBuyOrderRequiresPrice"] = False


# Lista fixa das 15 maiores criptomoedas por market cap (excluindo Bitcoin e stablecoins)
top_cryptos = [
    "XRP/USDT",
    "ADA/USDT",
    "DOGE/USDT",
    "SOL/USDT",
    "MATIC/USDT",
    "DOT/USDT",
    "LTC/USDT",
    "TRX/USDT",
    "ATOM/USDT",
    "XLM/USDT",
    "APT/USDT"
]

# Quantidades correspondentes a US$10 para cada criptomoeda
amounts = {
    "XRP/USDT": 40,
    "ADA/USDT": 80,
    "DOGE/USDT": 300,
    "SOL/USDT": 1,
    "MATIC/USDT": 30,
    "DOT/USDT": 5,
    "LTC/USDT": 0.2,
    "TRX/USDT": 440,
    "ATOM/USDT": 3,
    "XLM/USDT": 200,
    "APT/USDT": 3
}

total_acoes = 0

def get_minimum_amount(exchange, pair, amount):
    market_info = exchange.load_markets()[pair]
    min_amount = market_info['limits']['amount']['min']
    return max(amount, min_amount)

# Filtra pares que existem em ambas as exchanges
def get_valid_pairs(top_cryptos):
    try:
        gateio_pairs = set(gateio.load_markets().keys())
        coinex_pairs = set(coinex.load_markets().keys())
        tradeogre_pairs = set(tradeogre.load_markets().keys())  # Adicionando Xeggex
        common_pairs = gateio_pairs.intersection(coinex_pairs, tradeogre_pairs)
        valid_pairs = [pair for pair in top_cryptos if pair in common_pairs]
        return valid_pairs
    except Exception as e:
        print(f"Erro ao buscar pares válidos: {e}")
        return []

# Obter pares válidos para arbitragem
valid_pairs = get_valid_pairs(top_cryptos)
print(f"Pares disponíveis para arbitragem: {valid_pairs}")

# Função para acompanhar e calcular lucratividade
def track_order(exchange, order_id):
    try:
        order = exchange.fetch_order(order_id)
        if order['status'] == 'closed':
            return order['cost'], order['amount'], order['price']  # Retorna custo total, quantidade e preço médio
        else:
            print(f"Ordem {order_id} ainda não foi concluída.")
            return None
    except Exception as e:
        print(f"Erro ao buscar informações da ordem {order_id}: {e}")
        return None
    
def obter_atualizacoes(gateio, coinex, balances, orders):
    """
    Obtém atualizações sobre saldos e ordens e retorna o status atual.
    """
    updates = []

    try:
        # Obter balanços das exchanges
        gateio_balance = gateio.fetch_balance()
        coinex_balance = coinex.fetch_balance()

        # Verificar saldo de USDT em ambas as exchanges
        gateio_usdt = gateio_balance['total'].get('USDT', 0)  # Retorna 0 se USDT não existir
        coinex_usdt = coinex_balance['total'].get('USDT', 0)

        updates.append("Saldos nas exchanges:")
        updates.append(f"  Gate.io: {gateio_usdt:.2f} USDT disponíveis")
        updates.append(f"  Coinex: {coinex_usdt:.2f} USDT disponíveis")
        updates.append(f"Quantidade total comprada: {total_acoes:.2f}")
       

    except Exception as e:
        updates.append(f"Erro ao obter balanços: {e}")

    try:
        # Adicionar informações de ordens se necessário
        if orders:
            updates.append("Últimas ordens executadas:")
            for order in orders:
                updates.append(f"  {order}")
        else:
            updates.append("Nenhuma ordem recente encontrada.")
    except Exception as e:
        updates.append(f"Erro ao processar ordens: {e}")

    return "\n".join(updates)


# Função de execução de arbitragem
def execute_arbitrage(pair, gateio, coinex, tradeogre):
    """
    Executa a lógica de arbitragem para o par especificado.
    """
    amount = amounts.get(pair, 0)  # Obtém o amount correspondente ao par
    if amount == 0:
        print(f"Quantidade não definida para {pair}. Ignorando.")
        return

    result = search_arbitrage(pair, amount, gateio, coinex, tradeogre)
    if result is None:
        print(f"Não foi possível calcular a arbitragem para o par {pair}. Verifique os preços ou as conexões.")
        return

    profit, profit_1, profit_2, profit_3 = result
    print(f"Arbitragem calculada para {pair}:")
    print(f"Lucro estimado total: {profit:.2f} USDT")
    print(f"Lucro 1 (Comprar na Gate.io e vender na Coinex): {profit_1:.2f} USDT")
    print(f"Lucro 2 (Comprar na Coinex e vender na Gate.io): {profit_2:.2f} USDT")
    print(f"Lucro 3 (Comprar na Tradeogre e vender na Gate.io): {profit_3:.2f} USDT")

    if profit > 1:
        total_profit = 0  # Inicializa o lucro total para essa arbitragem

        if profit == profit_1:
            print(f"Executando arbitragem: Comprar na Gate.io e vender na Coinex.")
            try:
                # Buscar preços para ordens
                gateio_price = gateio.fetch_ticker(pair)['ask']  # Preço de compra na Gate.io
                coinex_price = coinex.fetch_ticker(pair)['bid']  # Preço de venda na Coinex

                # Criar ordens com preços definidos
                buy_order = gateio.create_market_buy_order(pair, amount)
                sell_order = coinex.create_limit_sell_order(pair, amount, coinex_price)

                # Acompanhar ordens
                buy_result = track_order(gateio, buy_order['id'])
                sell_result = track_order(coinex, sell_order['id'])

                if buy_result and sell_result:
                    buy_cost, _, buy_price = buy_result
                    sell_cost, _, sell_price = sell_result
                    partial_profit = sell_cost - buy_cost
                    total_profit += partial_profit
                    total_compras += 1
                    total_vendas += 1
                    print(f"Lucro parcial (USDT): {partial_profit:.2f} (Compra: {buy_price:.2f}, Venda: {sell_price:.2f})")

            except Exception as e:
                print(f"Erro ao executar arbitragem para {pair}: {e}")
        elif profit == profit_2:
            print(f"Executando arbitragem: Comprar na Coinex e vender na Gate.io")
        else:
            print(f"Executando arbitragem: Comprar na Coinex e vender na Gate.io.")
            try:
                # Buscar preços para ordens
                coinex_price = coinex.fetch_ticker(pair)['ask']  # Preço de compra na Coinex
                gateio_price = gateio.fetch_ticker(pair)['bid']  # Preço de venda na Gate.io

                # Criar ordens com preços definidos
                buy_order = coinex.create_market_buy_order(pair, amount)
                sell_order = gateio.create_limit_sell_order(pair, amount, gateio_price)

                # Acompanhar ordens
                buy_result = track_order(coinex, buy_order['id'])
                sell_result = track_order(gateio, sell_order['id'])

                if buy_result and sell_result:
                    buy_cost, _, buy_price = buy_result
                    sell_cost, _, sell_price = sell_result
                    partial_profit = sell_cost - buy_cost
                    total_profit += partial_profit
                    print(f"Lucro parcial (USDT): {partial_profit:.2f} (Compra: {buy_price:.2f}, Venda: {sell_price:.2f})")

            except Exception as e:
                print(f"Erro ao executar arbitragem para {pair}: {e}")
    elif profit == profit_3:
        print(f"Executando arbitragem: Comprar na Tradeogre e vender na Gate.io.")
        try:
            tradeogre_price = tradeogre.fetch_ticker(pair)['ask']  # Preço de compra na Tradeogre
            gateio_price = gateio.fetch_ticker(pair)['bid']  # Preço de venda na Gate.io

            buy_order = tradeogre.create_market_buy_order(pair, amount)
            sell_order = gateio.create_limit_sell_order(pair, amount, gateio_price)

            buy_result = track_order(tradeogre, buy_order['id'])
            sell_result = track_order(gateio, sell_order['id'])

            if buy_result and sell_result:
                buy_cost, _, buy_price = buy_result
                sell_cost, _, sell_price = sell_result
                partial_profit = sell_cost - buy_cost
                total_profit += partial_profit
                print(f"Lucro parcial (USDT): {partial_profit:.2f} (Compra: {buy_price:.2f}, Venda: {sell_price:.2f})")

        except Exception as e:
                print(f"Erro ao executar arbitragem para {pair}: {e}")
        
        print(f"Lucro total para {pair}: {total_profit:.2f} USDT")
    else:
        print(f"Sem oportunidade de lucro para {pair}.")




# Inicializar dicionários para saldos e ordens
balances = {
    "Gate.io": {"USDT": 0},
    "Coinex": {"USDT": 0},
    "Tradeogre": {"USDT": 0}
}
orders = {
    "Gate.io": [],
    "Coinex": [],
    "Tradeogre": []
}
# Loop infinito para execução periódica
# Loop infinito para execução periódica
while True:
    print("Iniciando nova verificação de arbitragem...")

    # Para cada par válido, execute a lógica de arbitragem
    for pair in valid_pairs:
        try:
            execute_arbitrage(pair, gateio, coinex, tradeogre)
            
            # Registrar as últimas ordens em cada exchange
            orders["Gate.io"].append(gateio.fetch_order_book(pair))
            orders["Coinex"].append(coinex.fetch_order_book(pair))
            orders["Tradeogre"].append(tradeogre.fetch_order_book(pair))
            
        except Exception as e:
            print(f"Erro ao executar arbitragem para {pair}: {e}")

    # Obter as atualizações para exibir no terminal
    status_message = obter_atualizacoes(gateio, coinex, balances, orders)
    print("\n--- STATUS ATUAL DO BOT ---")
    print(status_message)
    print(total_acoes)
    print("-----------------------------")

    # Esperar pelo próximo intervalo
    print(f"Aguardando {INTERVALO} segundos para a próxima verificação...")
    time.sleep(INTERVALO)