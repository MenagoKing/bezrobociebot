# SolDesk — architektura

Panel i silnik do prowadzenia **własnego** bota handlowego na Solanie (jeden użytkownik = właściciel),
z trybem symulacji (paper) jako domyślnym i trybem live przez agregator Jupiter.

## 1. Analiza wymagań → decyzje

| Wymaganie | Decyzja |
|---|---|
| Jeden użytkownik (właściciel), możliwość rozbudowy | Silnik bota jako klasa (`BotEngine`), koordynator zarządza jego cyklem życia. Nowe strategie = nowe implementacje interfejsu `Strategy`. |
| Handel na Solanie | Wykonanie bezpośrednio on-chain: Jupiter Swap API (quote → swap → podpis → RPC). Bez automatyzacji przeglądarki i bez logowania do platform — jest wolniejsza, krucha i niepotrzebna do handlu. Panel daje linki do tokena na Pump.fun / GMGN / DexScreener. |
| Bezpieczeństwo kapitału | Domyślnie `paper`. `live` wymaga: adresu portfela, zaszyfrowanego klucza, danych rynkowych `live` oraz wpisania frazy potwierdzającej przy starcie. Limity ryzyka egzekwowane przed każdym zakupem. |
| Konfiguracja bez edycji kodu | Wszystkie parametry w tabeli `settings` (walidacja zod), edytowalne z panelu; silnik czyta je przy każdym cyklu. Presety (handel, analiza). |
| Architektura zdarzeniowa, odporność | Typowana szyna zdarzeń w procesie; moduły izolowane (`safeRun`), błędy trafiają do monitora błędów zamiast zatrzymywać system. Stan w SQLite (WAL) — po restarcie sesja wraca jako *wstrzymana*. |
| Czas rzeczywisty w panelu | Server-Sent Events (`/api/stream`) — jednokierunkowe, z automatycznym wznawianiem; polecenia idą przez REST. |
| Praca 24/7 na serwerze | Docker (`restart: unless-stopped`) lub systemd, healthcheck, kopie zapasowe `VACUUM INTO`, logi z redakcją sekretów, rotacja logów. |

### Wiele sieci (Solana + EVM)

- Każdy token i sesja mają `chain` (`solana` albo klucz sieci EVM z DexScreener, np. `robinhood`) i `nativeSymbol`.
  Księga działa w walucie natywnej sieci sesji (pola `*Sol` = SOL/ETH/BNB), wyceny w USD liczone kursem tej waluty.
- `ChainRegistry` (`server/src/chains/`) odpowiada za różnice między sieciami: szacunek opłat, rezerwa na gaz, rent (tylko Solana).
- Rozpoznanie tokena: adres `0x…` → wszystkie włączone sieci EVM, wybór pary o największej płynności; base58 → Solana.
- Wykonanie: `PaperExecutor` (wszystkie sieci), `JupiterExecutor` (Solana), `EvmExecutor` (LI.FI + viem: wycena → kontrola
  allowlisty i kwoty → podpis lokalny → potwierdzenie → kwoty z różnic sald przed/po bloku; approve na dokładną kwotę).
- Konfiguracja sieci EVM w ustawieniach (sekcja `evm`): RPC, eksplorator, sieć GeckoTerminal, wycena waluty natywnej,
  allowlista kontraktów, opłaty i rezerwy — edytowalna z panelu (System → Sieci EVM).

## 2. Stack

- **Backend:** Node.js ≥ 24 uruchamia TypeScript natywnie (type stripping, bez kroku budowania), Fastify 5, `node:sqlite` (bez natywnych zależności), zod 4.
- **Frontend:** React 19 + Vite, lightweight-charts 5 (świece + wolumen + krzywa kapitału), własny ciemny motyw CSS.
- **Dane rynkowe:** DexScreener (cena, płynność, wolumen — co 2–3 s), GeckoTerminal (świece OHLCV — co ~20 s), symulator rynku do testów offline.

## 3. Komponenty

```
                ┌──────────────────────── Panel (React, przeglądarka admina) ───────────────────────┐
                │ Overview · Session · Trading · Market · Positions · Stats · Account · System           │
                └───────────────▲ SSE (zdarzenia)                         │ REST (polecenia, konfiguracja)
                                │                                         ▼
┌───────────────────────────────┴─────────────────────────────────────────────────────────────────┐
│ API (Fastify): tylko localhost (bez hasła), walidacja, statyczne pliki panelu                    │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ EventBus ◄──────────────────────────────── wszystkie moduły publikują / subskrybują ──────────► │
│                                                                                                  │
│ Coordinator ── RiskManager            BotEngine ── StateMachine ── Strategy                      │
│   │ start/pause/resume/stop/E-stop       │ ocena wejść/wyjść co N s                               │
│   │ odzyskiwanie po restarcie            ▼                                                        │
│   │                                  OrderQueue (trwała, szeregowa, retry) ── Executor            │
│   │                                                                   ├─ PaperExecutor (symulacja)│
│   │                                                                   └─ JupiterExecutor (live)   │
│ MarketService ── Provider (DexScreener+Gecko | Simulated) ── CandleSeries ── Analyzer             │
│ WalletMonitor (RPC)   StatsService   HealthMonitor   ErrorMonitor   Backup                        │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Repository ── SQLite (WAL)                Vault (AES-256-GCM, klucz główny poza bazą)             │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 4. Schemat bazy danych (SQLite)

| Tabela | Najważniejsze kolumny |
|---|---|
| `settings` | `section` PK, `data` JSON, `updated_at` |
| `presets` | `id`, `kind` (`trading`/`analysis`), `name`, `data` JSON |
| `account` | `id=1`, `name`, `email`, `platform`, `wallet_address` |
| `secrets` | `name` PK, `ciphertext` (iv‖tag‖dane, base64), `updated_at` |
| `sessions` | `id`, token (adres, nazwa, symbol, para, decimals), `mode`, `data_source`, `status`, `started_at`, `ended_at`, `start_capital_sol/usd`, `start_sol_usd`, `paper_balance_sol`, `rent_paid_sol`, `config_snapshot`, `summary` |
| `positions` | `id`, `session_id`, `status`, `opened_at`, `closed_at`, `amount`, `decimals`, `entry_price_sol/usd`, `cost_sol`, `peak_price_sol`, `exit_price_sol/usd`, `proceeds_sol`, `realized_pnl_sol/usd`, `fees_sol`, `exit_reason` |
| `trades` | `id`, `session_id`, `position_id`, `side`, `ts`, `price_sol/usd`, `amount`, `value_sol/usd`, `fee_sol`, `network_fee_sol`, `sol_usd`, `tx_signature`, `mode`, `reason` |
| `orders` | kolejka: `id`, `session_id`, `side`, `value_sol`, `position_id`, `reason`, `status` (`pending/executing/filled/failed/cancelled`), `attempts`, `next_attempt_at`, `error`, `tx_signature`, `trade_id` |
| `equity_snapshots` | `session_id`, `ts`, `balance_sol`, `positions_value_sol`, `equity_sol`, `equity_usd`, `sol_usd` |
| `callout_templates`, `callouts` | nieużywane — zostały po usuniętym Callout Managerze (migracja 1 bez zmian) |
| `errors` | `id`, `ts`, `level`, `source`, `message`, `context`, `acknowledged` |
| `admin`, `auth_sessions` | nieużywane — zostały po usuniętym logowaniu (migracja bez zmian) |

## 5. Komunikacja

- **W procesie:** `EventBus` (typowane zdarzenia): `market.tick`, `market.analysis`, `market.feed`, `bot.state`,
  `order.updated`, `trade.executed`, `position.updated`, `session.updated`, `risk.breach`,
  `wallet.updated`, `stats.updated`, `system.health`, `error`, `settings.updated`.
- **Panel ← serwer:** SSE przekazuje wybrane zdarzenia (tick rynku dławiony do ~1/s).
- **Panel → serwer:** REST z ciasteczkiem sesji (`HttpOnly`, `SameSite=Strict`) i nagłówkiem `X-Requested-With`.

## 6. Maszyna stanów bota

```
OFFLINE ─start─► IDLE ─sesja─► WATCHING ◄────────────────────────────┐
                                  │ sygnał wejścia / polecenie          │ sprzedano ostatnią pozycję
                                  ▼                                     │
                           AWAITING_TASK ─► BUYING ─► HOLDING ─► AWAITING_TASK ─► SELLING ─┘
                                  ▲                      │  (kolejna transza: HOLDING → AWAITING_TASK → BUYING)
   PAUSED ◄── pause (z każdego aktywnego) ── resume ──► WATCHING/HOLDING
   ERROR  ◄── błąd wykonania / feedu po wyczerpaniu prób ── auto-recovery po N s ──► WATCHING/HOLDING
   każdy stan ─stop/E-stop─► IDLE ─► OFFLINE
```

Przejścia są zdefiniowane w tabeli (`server/src/engine/stateMachine.ts`); niedozwolone przejście jest logowane jako błąd.

## 7. Koordynator

- **Cykl sesji:** walidacja → rozpoznanie tokena → zapis sesji z migawką konfiguracji → start feedu → start silnika.
- **Ryzyko (przed każdym zakupem):** min/max kwota, saldo minus rezerwa SOL, maks. kapitał w pozycjach (USD i % kapitału),
  maks. liczba pozycji, cooldown, limit transakcji na sesję/godzinę, min. płynność.
- **Wiele portfeli:** pozycje i zlecenia mają `wallet_id` (0 = główny portfel, >0 = `trading_wallets`). Przed zakupem
  `RiskManager.checkBuyOnWallets` wybiera portfel z wolnym miejscem w limicie `maxPositionsPerWallet` (otwarte pozycje +
  kupna w kolejce), najmniej zajęty najpierw, i sprawdza saldo tego portfela. Sprzedaż podpisuje klucz portfela pozycji.
- **Ryzyko (ciągłe):** limit straty sesji (USD/%), limit kosztów → `pause` lub `stop + likwidacja` (konfigurowalne).
- **Awaryjne zatrzymanie:** natychmiast blokuje nowe zakupy, anuluje kolejkę, opcjonalnie sprzedaje wszystko z pominięciem min. czasu trzymania.
- **Odzyskiwanie:** po restarcie aktywna sesja wraca jako `paused`; zlecenia przerwane w trakcie są uzgadniane (live: status podpisu w RPC).

## 8. Struktura katalogów

```
shared/            typy i stałe wspólne dla serwera i panelu
server/src/
  config/          env, schematy ustawień (zod) i wartości domyślne
  core/            eventBus, logger (redakcja), safeRun
  db/              połączenie, migracje, repozytorium
  security/        vault (AES-GCM)
  market/          providery, świece, analizator, MarketService
  solana/          base58, RPC, podpis ed25519, transakcje
  execution/       PaperExecutor, JupiterExecutor
  engine/          maszyna stanów, strategia, kolejka zleceń, BotEngine
  coordinator/     Coordinator, RiskManager
  services/        wallet, statystyki, health, backup
  api/             serwer HTTP, SSE, trasy
server/test/       testy (node:test)
web/src/           panel React (pages/, components/)
deploy/            systemd, Caddy (HTTPS), skrypt kopii
```
